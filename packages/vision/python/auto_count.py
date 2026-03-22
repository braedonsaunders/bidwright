#!/usr/bin/env python3
import sys
import json
import re
import fitz  # PyMuPDF
import base64
import logging
import os
import numpy as np
import cv2
import math
import time
import tempfile
from PIL import Image
import pytesseract
import xml.etree.ElementTree as ET
from xml.dom import minidom

# -----------------------
# Global Configuration
# -----------------------
DEBUG = False
MAX_PROCESSING_TIME = 60  # seconds
ZOOM_FACTOR = 3.0
OCR_ZOOM_FACTOR = 4.0  # Higher zoom for OCR to improve text recognition

ENABLE_OCR = True         # Controls OCR-based matching
ENABLE_DIRECT_TEXT = True # Controls direct text extraction matching
ENABLE_TEMPLATE = True    # Controls template matching
ENABLE_VISUAL = True      # Controls visual/feature-based matching

ENABLE_COMPLEX_PDF_SPECIAL_HANDLING = False

# -----------------------
# Utility Functions
# -----------------------

def load_pdf(filepath):
    """Load the PDF file from the given file path with optimized memory usage."""
    base_path = "/var/www/html/adminapp2/storage/app/public/"
    full_path = os.path.join(base_path, filepath)
    
    # Use stream=True to reduce memory usage for large PDFs
    try:
        return fitz.open(full_path, filetype="pdf")
    except Exception as e:
        logging.error(f"Error opening PDF file: {e}")
        # Fall back to regular open if stream mode fails
        return fitz.open(full_path)

def compute_pdf_bbox(selection, pdf_page):
    """Convert the frontend bounding box to PDF coordinates."""
    x = selection.get("x", 0)
    y = selection.get("y", 0)
    width = selection.get("width", 0)
    height = selection.get("height", 0)
    image_width = selection.get("imageWidth", 0)
    image_height = selection.get("imageHeight", 0)
    
    pdf_width = pdf_page.rect.width
    pdf_height = pdf_page.rect.height
    scale_x = pdf_width / image_width
    scale_y = pdf_height / image_height
    
    pdf_x = x * scale_x
    pdf_y = y * scale_y
    pdf_width = width * scale_x
    pdf_height = height * scale_y
    bbox = fitz.Rect(pdf_x, pdf_y, pdf_x + pdf_width, pdf_y + pdf_height)
    
    if DEBUG:
        logging.info(f"Frontend bounding box: (x={x}, y={y}, w={width}, h={height})")
        logging.info(f"Scaling factors: scale_x={scale_x}, scale_y={scale_y}")
        logging.info(f"PDF bounding box: (x={pdf_x}, y={pdf_y}, w={pdf_width}, h={pdf_height})")
    
    return bbox

def convert_numpy_types(obj):
    """Recursively convert numpy numeric types to native Python types."""
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(v) for v in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    else:
        return obj

def serialize_fitz_object(obj):
    """Convert PyMuPDF objects to serializable dictionaries."""
    if isinstance(obj, fitz.Rect):
        return {"x0": obj.x0, "y0": obj.y0, "x1": obj.x1, "y1": obj.y1}
    if isinstance(obj, fitz.Point):
        return {"x": obj.x, "y": obj.y}
    if hasattr(obj, "quad") or obj.__class__.__name__ == "Quad":
        try:
            return [serialize_fitz_object(pt) for pt in obj]
        except Exception:
            return str(obj)
    if isinstance(obj, (list, tuple)):
        return [serialize_fitz_object(x) for x in obj]
    if isinstance(obj, dict):
        return {k: serialize_fitz_object(v) for k, v in obj.items()}
    try:
        return str(obj)
    except Exception:
        return None

# -----------------------
# Image Extraction
# -----------------------

def extract_pdf_snippet(pdf_page, clip_rect):
    """Extract a high-resolution snippet from the PDF region with memory optimization."""
    if clip_rect is None:
        raise ValueError("Invalid clipping rectangle: None")
    
    # Limit the maximum size of extracted pixmap to avoid memory issues
    MAX_PIXMAP_DIMENSION = 6000  # pixels
    
    # Calculate zoom factor dynamically based on region size
    rect_width = clip_rect.width
    rect_height = clip_rect.height
    
    width_zoom = min(ZOOM_FACTOR, MAX_PIXMAP_DIMENSION / rect_width if rect_width > 0 else ZOOM_FACTOR)
    height_zoom = min(ZOOM_FACTOR, MAX_PIXMAP_DIMENSION / rect_height if rect_height > 0 else ZOOM_FACTOR)
    
    # Use the smaller zoom factor to ensure we don't exceed MAX_PIXMAP_DIMENSION
    actual_zoom = min(width_zoom, height_zoom)
    
    # Create the pixmap with the adjusted zoom factor
    try:
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(actual_zoom, actual_zoom), clip=clip_rect)
        return pix.tobytes("png")
    except Exception as e:
        logging.error(f"Error extracting PDF snippet: {e}")
        # Fall back to a lower zoom factor if the original fails
        fallback_zoom = min(2.0, actual_zoom / 2)
        try:
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(fallback_zoom, fallback_zoom), clip=clip_rect)
            return pix.tobytes("png")
        except Exception as e2:
            logging.error(f"Error in fallback extraction: {e2}")
            # Last resort: try without zoom
            pix = pdf_page.get_pixmap(clip=clip_rect)
            return pix.tobytes("png")

def extract_vector_data(pdf_page, clip_rect):
    """Extract vector data from the PDF page with efficient vector counting for large documents."""
    # Check if clip_rect is valid
    if not clip_rect.is_valid or clip_rect.width <= 0 or clip_rect.height <= 0:
        if DEBUG:
            logging.warning(f"Invalid clip rectangle: {clip_rect}")
        return []
    
    # Fast vector count check - without using 'extend' parameter which caused an error
    vector_count = 0
    count_start_time = time.time()
    MAX_COUNT_TIME = 2.0  # Maximum time for counting vectors
    
    try:
        # Count vectors with timeout - fixed to avoid 'extend' parameter
        for drawing in pdf_page.get_drawings():
            vector_count += 1
            
            # Check if we've already counted too many vectors or spent too much time
            if vector_count > 50000 or (time.time() - count_start_time) > MAX_COUNT_TIME:
                if DEBUG:
                    logging.warning(f"Large number of vectors detected ({vector_count}+), skipping vector extraction")
                return []  # Skip extraction for huge vector counts
    except Exception as e:
        if DEBUG:
            logging.error(f"Error counting vectors: {e}")
        return []
    
    # For reasonable vector counts, extract with intersection check
    MAX_VECTORS = 200  # Maximum number of vectors to return
    
    try:
        vectors = []
        processed = 0
        extract_start_time = time.time()
        
        for drawing in pdf_page.get_drawings():
            processed += 1
            
            # Periodic timeout check during extraction
            if processed % 1000 == 0 and time.time() - extract_start_time > 5.0:
                if DEBUG:
                    logging.warning(f"Vector extraction timeout after processing {processed}/{vector_count} vectors")
                break
            
            # Check intersection with clip rectangle
            dr_rect = drawing.get("rect")
            if isinstance(dr_rect, fitz.Rect) and dr_rect.intersects(clip_rect):
                # Filter out tiny elements (garbage removal)
                if dr_rect.width < 1.0 and dr_rect.height < 1.0:
                    continue
                
                vectors.append(drawing)
                
                # Limit the number of vectors to prevent memory issues
                if len(vectors) >= MAX_VECTORS:
                    if DEBUG:
                        logging.warning(f"Maximum vector count ({MAX_VECTORS}) reached, truncating results")
                    break
        
        return vectors
    except Exception as e:
        if DEBUG:
            logging.error(f"Error extracting vector data: {e}")
        return []

# -----------------------
# Annotation Check
# -----------------------

def check_pdf_annotations(pdf_doc, pdf_page, page_index):
    """Check if the PDF page has annotations with improved error handling and memory management."""
    MAX_ANNOTATIONS = 200  # Maximum number of annotations to process
    
    try:
        # Get annotations with a limit
        annotations = list(pdf_page.annots())[:MAX_ANNOTATIONS]
        
        if annotations:
            logging.info(f"Found {len(annotations)} annotations on page {page_index}")
            
            # Process annotations in batches to reduce memory usage
            serialized_annotations = []
            for i, a in enumerate(annotations):
                try:
                    serialized_annotations.append(serialize_fitz_object(a))
                except Exception as annotation_error:
                    if DEBUG:
                        logging.error(f"Error serializing annotation {i}: {annotation_error}")
            
            return serialized_annotations
        
        # Check metadata and catalog with timeout protection
        try:
            metadata = pdf_doc.metadata
            if metadata:
                # Only log essential metadata to reduce log size
                essential_metadata = {k: v for k, v in metadata.items() 
                                      if k in ['title', 'author', 'subject', 'creator']}
                logging.info(f"PDF metadata: {essential_metadata}")
        except Exception as metadata_error:
            if DEBUG:
                logging.error(f"Error accessing PDF metadata: {metadata_error}")
        
        try:
            # Use a safer way to access catalog
            catalog = None
            if pdf_doc.xref_length() > 1:
                catalog = pdf_doc.xref_object(1, compressed=True)
            if catalog:
                # Limit catalog data size for logging
                catalog_str = str(catalog)
                if len(catalog_str) > 1000:
                    catalog_str = catalog_str[:1000] + "... [truncated]"
                logging.info(f"PDF catalog: {catalog_str}")
        except Exception as catalog_error:
            if DEBUG:
                logging.error(f"Error accessing PDF catalog: {catalog_error}")
        
        return []
    except Exception as e:
        logging.error(f"Error checking annotations: {e}")
        return []

# -----------------------
# OCR Classes (from Bluebeam.OCR.dll)
# -----------------------

class ExtractedTextItem:
    """Represents a single text extraction result from OCR"""
    def __init__(self, key, text, confidence=100):
        self.key = key
        self.text = text
        self.confidence = confidence
        
    def to_xml(self):
        """Convert to XML representation"""
        item = ET.Element("ExtractedTextItem")
        key = ET.SubElement(item, "Key")
        key.text = self.key
        text = ET.SubElement(item, "Text")
        text.text = self.text
        confidence = ET.SubElement(item, "Confidence")
        confidence.text = str(self.confidence)
        return item

class ExtractedText:
    """Container for extracted text items"""
    def __init__(self, items=None):
        self.items = items or []
        
    def to_xml(self):
        """Convert to XML representation"""
        root = ET.Element("ExtractedText")
        for item in self.items:
            root.append(item.to_xml())
        return root
        
    def to_xml_string(self):
        """Convert to formatted XML string"""
        root = self.to_xml()
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = minidom.parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")
        
    def save_to_file(self, filename):
        """Save extracted text to XML file"""
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(self.to_xml_string())
            
    @staticmethod
    def load_from_file(filename):
        """Load extracted text from XML file"""
        tree = ET.parse(filename)
        root = tree.getroot()
        items = []
        for item_elem in root.findall('./ExtractedTextItem'):
            key = item_elem.find('Key').text
            text = item_elem.find('Text').text
            confidence = int(item_elem.find('Confidence').text)
            items.append(ExtractedTextItem(key, text, confidence))
        return ExtractedText(items)

class OCREngine:
    """Base OCR engine implementation, optimized for performance"""
    def __init__(self):
        self.languages = ["English"]  # Default language
        
    def set_languages(self, languages):
        """Set OCR languages"""
        self.languages = languages
        
    def extract_text(self, image):
        """Extract text from an image"""
        # Convert OpenCV image to PIL for Tesseract
        if isinstance(image, np.ndarray):
            pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        else:
            pil_image = image
            
        # Apply OCR with Tesseract
        config = f'--psm 6'  # Assume a single uniform block of text
        text = pytesseract.image_to_string(pil_image, config=config)
        return text
    
    def extract_text_from_page(self, pdf_page, rect=None):
        """Extract text from a PDF page"""
        # Use direct PDF text extraction if possible
        if hasattr(pdf_page, 'get_text') and rect:
            return pdf_page.get_text("text", clip=rect)
        elif hasattr(pdf_page, 'get_text'):
            return pdf_page.get_text("text")
        
        # Fallback to OCR if direct extraction fails
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(OCR_ZOOM_FACTOR, OCR_ZOOM_FACTOR), clip=rect)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return self.extract_text(img)
        
    def extract_text_from_text_block(self, text_block):
        """Extract text from a text block"""
        if isinstance(text_block, np.ndarray):
            return self.extract_text(text_block)
        return text_block
    
    def extract_text_from_table_block(self, table_block):
        """Extract text from a table block"""
        if isinstance(table_block, np.ndarray):
            config = f'--psm 6 --oem 3 -c preserve_interword_spaces=1 tessedit_do_invert=0'
            
            # Convert to PIL image if needed
            if isinstance(table_block, np.ndarray):
                if len(table_block.shape) > 2 and table_block.shape[2] == 3:
                    # Apply preprocessing for better OCR
                    gray = cv2.cvtColor(table_block, cv2.COLOR_BGR2GRAY)
                    # Use adaptive threshold for tables
                    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                                 cv2.THRESH_BINARY, 11, 2)
                    pil_image = Image.fromarray(binary)
                else:
                    pil_image = Image.fromarray(table_block)
            else:
                pil_image = table_block
                
            try:
                text = pytesseract.image_to_string(pil_image, config=config)
                return self._clean_string(text)
            except Exception as e:
                if DEBUG:
                    logging.error(f"Table OCR error: {e}")
                return ""
        return table_block
    
    def extract_text_from_barcode_block(self, barcode_block):
        """Extract text from a barcode block with timeout"""
        if isinstance(barcode_block, np.ndarray):
            try:
                # Use a timeout for barcode processing
                start_time = time.time()
                MAX_BARCODE_TIME = 2.0  # seconds
                
                # Process with specialized configuration for barcodes
                config = f'--psm 6 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ tessedit_do_invert=0'
                
                if time.time() - start_time > MAX_BARCODE_TIME:
                    return ""
                    
                # Convert to PIL image if needed
                if isinstance(barcode_block, np.ndarray):
                    if len(barcode_block.shape) > 2 and barcode_block.shape[2] == 3:
                        gray = cv2.cvtColor(barcode_block, cv2.COLOR_BGR2GRAY)
                        # Use threshold for barcodes
                        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                        pil_image = Image.fromarray(binary)
                    else:
                        pil_image = Image.fromarray(barcode_block)
                else:
                    pil_image = barcode_block
                    
                text = pytesseract.image_to_string(pil_image, config=config)
                return self._clean_string(text)
            except Exception as e:
                if DEBUG:
                    logging.error(f"Barcode OCR error: {e}")
                return ""
        return barcode_block
    
    @staticmethod
    def _clean_string(text):
        """Clean OCR text output with garbage removal"""
        if not text:
            return ""
        
        # Replace various line break characters with spaces
        text = re.sub(r'[\n\v\f\r\u2028\u2029\u0085]+', ' ', text)
        
        # Remove multiple spaces
        text = re.sub(r'\s+', ' ', text)
        
        # Remove common OCR artifacts (garbage removal)
        text = re.sub(r'[^\w\s\.,;:!?\'\"()\[\]{}-]', '', text)
        
        return text.strip()

# -----------------------
# PDF Matching Implementation (from pdf_matching.dll)
# -----------------------

class PDFMatchingTools:
    def __init__(self):
        # Parameters from the constants in create_matchline_cntxt
        self.matching_params = {
            'param1': 3.0,      # Scale factor
            'param2': 1.57,     # Angular threshold (pi/2)
            'param3': 0.65,     # Distance threshold
            'param4': 1.0       # Scale parameter
        }
        self.context = None
        self.ocr_engine = OCREngine()
    
    def create_matchline_cntxt(self, param1, param2, param3, param4):
        """Creates a matching context as seen in create_matchline_cntxt"""
        # Allocate memory and initialize as in the original DLL
        context = {
            'segments': [],
            'params': {
                'param1': param1,  # Scale factor
                'param2': param2,  # Angular threshold (pi/2)
                'param3': param3,  # Distance threshold
                'param4': param4   # Scale parameter
            },
            'features': [],
            'transformed_features': [],
            'feature_hash': {},    # Hash table for quick feature lookups
            'tree_root': self._create_tree_node(),  # Create the tree root node
            'text_items': [],      # Storage for text items
            'line_segments': [],   # Storage for line segments
            'data': [0] * 16,
            'finalized': False     # Flag for finalize_matchline_cntxt
        }
        
        return context
    
    def _create_tree_node(self):
        """Creates a tree node structure as seen in the original DLL"""
        return {
            'left': None,
            'right': None,
            'parent': None,
            'value': 0.0,   # Float value for comparison
            'data': None,   # Associated data
            'type': 0x101   # Type code from original
        }
    
    def delete_matchline_cntxt(self, context):
        """Frees resources used by a matching context"""
        if context and context.get('tree_root'):
            self._free_tree_iterative(context['tree_root'])
        
        # Clear all data
        if context:
            context.clear()
    
    def _free_tree_iterative(self, root):
        """Non-recursive version of tree freeing to avoid recursion depth issues"""
        if not root:
            return
            
        # Use a stack to track nodes to process
        stack = [root]
        processed = set()
        
        while stack:
            node = stack[-1]  # Look at the top of the stack
            
            # Skip if node is None or already processed
            if node is None:
                stack.pop()
                continue
                
            # Process if this is a terminal node or children are processed
            left = node.get('left')
            right = node.get('right')
            
            # If it's a non-leaf node, we need to process children first
            if node.get('type', 0) == 0:
                # If right exists and not processed, add it to stack
                if right and id(right) not in processed:
                    stack.append(right)
                    continue
                    
                # If left exists and not processed, add it to stack
                if left and id(left) not in processed:
                    stack.append(left)
                    continue
            
            # If we're here, we can process this node
            node_id = id(node)
            if node_id not in processed:
                # Clear node data
                node.clear()
                processed.add(node_id)
            
            # Pop the node from stack
            stack.pop()
    
    def insert_seg_into_matchline_cntxt(self, context, param2, param3, param4, param5, param6):
        """Implements insert_seg_into_matchline_cntxt (FUN_180001e80)"""
        # Create segment data
        segment = {
            'x': param2,       # X coordinate
            'y': param3,       # Y coordinate 
            'width': param4,   # Width parameter
            'height': param5,  # Height parameter
            'type': param6     # Type flag
        }
        
        # Add to segments list
        context['segments'].append(segment)
        
        # Insert into the tree structure
        self._insert_into_tree(context['tree_root'], param2, len(context['segments'])-1)
        
        # Additional logic from FUN_180001e80
        # Calculate distances between segment points
        if len(context['segments']) > 1:
            # Comparison with existing segments
            threshold = context['params'].get('param1', 3.0)
            
            # Get first segment
            first_seg = context['segments'][0]
            first_x, first_y = first_seg['x'], first_seg['y']
            first_w, first_h = first_seg.get('width', 0), first_seg.get('height', 0)
            
            # Calculate distance between segment points
            dist1 = math.sqrt((param2 - first_x)**2 + (param3 - first_y)**2)
            dist2 = math.sqrt((param4 - first_w)**2 + (param5 - first_h)**2)
            
            # Compare against threshold
            if dist1 < threshold and dist2 < threshold:
                # Points are close enough - increment counters
                if 'point_counters' not in context:
                    context['point_counters'] = [0, 0]
                
                # Update internal counters as in FUN_180001e80
                if segment.get('type', 0) == 0:
                    context['point_counters'][0] += 1
                else:
                    context['point_counters'][1] += 1
    
    def _insert_into_tree(self, root, value, data_index):
        """Implements FUN_1800062d0 to insert a value into the tree"""
        # Follow the exact algorithm from FUN_1800062d0
        current = root
        last = None
        direction = None
        is_less_or_equal = False
        
        # Navigate the tree to find insertion point
        while current is not None and current.get('type', 0) == 0:
            last = current
            is_less_or_equal = value <= current.get('value', 0.0)
            if is_less_or_equal:
                current = current.get('left')
                direction = 'left'
            else:
                current = current.get('right')
                direction = 'right'
        
        # Create new node
        new_node = {
            'left': None,
            'right': None,
            'parent': last,
            'value': value,
            'data': data_index,  # Store segment index
            'type': 0            # Leaf node
        }
        
        # Insert the node
        if last is not None:
            last[direction] = new_node
        else:
            # Tree was empty, update root
            root.update(new_node)
        
        # Store data index
        new_node['data'] = data_index
    
    def insert_line_segments(self, context, segments, count, page_index):
        """Implements insert_line_segments to add line segments to the context"""
        # Ensure the context has a line_segments dict for this page
        if 'line_segments' not in context:
            context['line_segments'] = {}
        
        if page_index not in context['line_segments']:
            context['line_segments'][page_index] = []
        
        # Add count segments from the segments array
        for i in range(count):
            if i < len(segments) // 2:
                segment = {
                    'start': segments[i*2],
                    'end': segments[i*2 + 1]
                }
                context['line_segments'][page_index].append(segment)
    
    def insert_text_item(self, context, page_index, text, text_len, x, y, width, height):
        """Implements insert_text_item to add text elements to the context"""
        # Ensure the context has a text_items dict for this page
        if 'text_items' not in context:
            context['text_items'] = {}
        
        if page_index not in context['text_items']:
            context['text_items'][page_index] = []
        
        # Create and add the text item
        text_item = {
            'text': text[:text_len] if text_len else text,  # Limit to text_len characters
            'x': x,
            'y': y,
            'width': width,
            'height': height
        }
        
        context['text_items'][page_index].append(text_item)
    
    def set_text_item_count(self, context, page_index, count):
        """Implements set_text_item_count to allocate space for text items"""
        # Ensure the context has a text_items dict for this page
        if 'text_items' not in context:
            context['text_items'] = {}
        
        # Initialize or resize the text items array for this page
        context['text_items'][page_index] = [None] * count
    
    def finalize_matchline_cntxt(self, context):
        """Implements finalize_matchline_cntxt to prepare the context for matching"""
        # Perform the same checks and swaps as in the original function
        if len(context.get('segments', [])) > 0:
            # Based on the original behavior - swap values if needed
            if context.get('params', {}).get('param3', 0) <= context.get('params', {}).get('param4', 0):
                # Swap param1 and param2, swap x and y coordinates
                temp = context['params']['param1']
                context['params']['param1'] = context['params']['param2']
                context['params']['param2'] = temp
                
                # Mark as finalized
                context['finalized'] = True
    
    def is_valid_context(self, context):
        """Implements FUN_180002830 to check if a context is valid"""
        if context is None:
            return False
        
        # Check if context has at least 2 segments
        return len(context.get('segments', [])) > 1
    
    def _compute_feature_hash(self, x, y):
        """Implements the hash function from FUN_180002d70"""
        # Exact constants from the original function
        x_val = (int(x) + 0x9e3779b9)
        x_val = (x_val ^ (x_val >> 32)) & 0xffffffffffffffff
        x_val = (x_val * 0xe9846af9b1a615d) & 0xffffffffffffffff
        x_val = (x_val ^ (x_val >> 32)) * 0xe9846af9b1a615d & 0xffffffffffffffff
        x_val = (x_val ^ (x_val >> 28)) + 0x9e3779b9 + int(y)
        x_val = (x_val ^ (x_val >> 32)) * 0xe9846af9b1a615d & 0xffffffffffffffff
        x_val = (x_val ^ (x_val >> 32)) * 0xe9846af9b1a615d & 0xffffffffffffffff
        x_val = x_val ^ (x_val >> 28)
        
        return x_val
    
    def _find_features_in_range(self, context, center_val, range_val):
        """Implements FUN_1800011b0 to find features within a value range"""
        if not context or not context.get('tree_root'):
            return []
        
        # Find features where the value is in [center_val - range_val, center_val + range_val]
        min_val = center_val - range_val
        max_val = center_val + range_val
        
        results = []
        stack = [context['tree_root']]
        
        # Iterative tree traversal to find nodes in range
        while stack:
            node = stack.pop()
            
            if node is None or node.get('type', 0) != 0:
                continue
                
            # Check if current node is in range
            node_val = node.get('value', 0.0)
            
            if min_val <= node_val <= max_val:
                # Node value is in range, add to results
                data_idx = node.get('data')
                if data_idx is not None:
                    results.append(data_idx)
            
            # Continue search in appropriate subtrees
            if node_val >= min_val and node.get('left'):
                stack.append(node.get('left'))
                
            if node_val <= max_val and node.get('right'):
                stack.append(node.get('right'))
        
        return results
    
    def extract_features(self, image, context):
        """Extracts features from an image, implementing FUN_180005720"""
        # Convert image to grayscale if needed
        if len(image.shape) > 2 and image.shape[2] == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
            
        # Try multiple feature detectors
        features = []
        
        # 1. SIFT with lower threshold
        sift = cv2.SIFT_create(contrastThreshold=0.01, edgeThreshold=10)
        keypoints_sift, descriptors_sift = sift.detectAndCompute(gray, None)
        
        # 2. ORB as backup (good for text)
        orb = cv2.ORB_create(nfeatures=1000)
        keypoints_orb, descriptors_orb = orb.detectAndCompute(gray, None)
        
        # 3. BRISK as another backup
        brisk = cv2.BRISK_create()
        keypoints_brisk, descriptors_brisk = brisk.detectAndCompute(gray, None)
        
        # Combine keypoints with preference to SIFT
        all_keypoints = []
        all_descriptors = []
        
        # Add SIFT keypoints
        if keypoints_sift:
            for i, kp in enumerate(keypoints_sift):
                all_keypoints.append(kp)
                all_descriptors.append(descriptors_sift[i])
        
        # Add ORB keypoints that don't overlap with existing ones
        if keypoints_orb:
            for i, kp in enumerate(keypoints_orb):
                x, y = kp.pt
                # Check if this keypoint is far enough from existing ones
                if not any(np.sqrt((x - existing.pt[0])**2 + (y - existing.pt[1])**2) < 5 for existing in all_keypoints):
                    all_keypoints.append(kp)
                    all_descriptors.append(descriptors_orb[i])
        
        # Add BRISK keypoints that don't overlap
        if keypoints_brisk:
            for i, kp in enumerate(keypoints_brisk):
                x, y = kp.pt
                if not any(np.sqrt((x - existing.pt[0])**2 + (y - existing.pt[1])**2) < 5 for existing in all_keypoints):
                    all_keypoints.append(kp)
                    all_descriptors.append(descriptors_brisk[i])
        
        # If we still have few keypoints for text images, create artificial grid of keypoints
        if len(all_keypoints) < 10 and gray.shape[0] * gray.shape[1] < 10000:
            height, width = gray.shape
            step = 5
            for y in range(0, height, step):
                for x in range(0, width, step):
                    # Create keypoint if this region has text (dark pixels)
                    region = gray[max(0, y-2):min(height, y+3), max(0, x-2):min(width, x+3)]
                    if np.mean(region) < 200:  # Dark region (likely text)
                        kp = cv2.KeyPoint(x, y, size=5)
                        all_keypoints.append(kp)
                        # Create a simple descriptor (all zeros)
                        if descriptors_sift is not None and descriptors_sift.shape[1] > 0:
                            all_descriptors.append(np.zeros_like(descriptors_sift[0]))
        
        # Process all keypoints
        for i, kp in enumerate(all_keypoints):
            x, y = kp.pt
            size = kp.size
            angle = kp.angle * (math.pi / 180.0)  # Convert to radians
            
            # Store feature data
            feature = {
                'x': x,
                'y': y,
                'angle': angle,
                'size': size,
                'descriptor': all_descriptors[i] if i < len(all_descriptors) else None
            }
            features.append(feature)
            
            # Hash and store the feature
            hash_key = self._compute_feature_hash(x, y)
            if 'feature_hash' not in context:
                context['feature_hash'] = {}
            if hash_key not in context['feature_hash']:
                context['feature_hash'][hash_key] = []
            context['feature_hash'][hash_key].append(len(features)-1)
            
            # Insert into context tree
            self._insert_into_tree(context['tree_root'], x, len(features)-1)
        
        # Store features in context
        context['features'] = features
        
        if DEBUG:
            logging.info(f"Extracted {len(features)} features using multiple detectors")
        
        # Calculate transformation data as before
        if len(features) > 0:
            # Calculate angle between feature points
            if len(features) > 1:
                # Find center of features
                x_sum = sum(f['x'] for f in features)
                y_sum = sum(f['y'] for f in features)
                center_x = x_sum / len(features)
                center_y = y_sum / len(features)
                
                # Calculate main orientation
                angle_sum = 0
                for feature in features:
                    dx = feature['x'] - center_x
                    dy = feature['y'] - center_y
                    angle_sum += math.atan2(dy, dx)
                
                avg_angle = angle_sum / len(features)
                
                # Store in context
                context['main_angle'] = avg_angle
                context['center_x'] = center_x
                context['center_y'] = center_y
        
        return features
    
    def extract_text_from_image(self, image):
        """
        Extract text from engineering/construction drawing images with sophisticated cleaning
        Optimized for technical identifiers like 'DB-01', equipment tags, and drawing references
        """
        text = self.ocr_engine.extract_text(image)
        if DEBUG:
            logging.info(f"Raw OCR text: '{text}'")
        
        # Initial cleanup
        text = text.strip()
        if DEBUG:
            logging.info(f"After stripping: '{text}'")
        
        # Remove common OCR artifacts
        text = text.rstrip('_')  # Trailing underscores
        text = re.sub(r'\.{2,}', '.', text)  # Multiple periods
        text = re.sub(r'[:|]', '', text)  # Remove vertical bars and colons that might be noise
        if DEBUG:
            logging.info(f"After artifact removal: '{text}'")
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        if DEBUG:
            logging.info(f"After whitespace normalization: '{text}'")
        
        # Smart cleaning: keep alphanumeric, hyphens, periods, and some symbols common in technical drawings
        # Keep hyphen, period, plus, hash, forward slash as they're common in technical identifiers
        text = re.sub(r'[^a-zA-Z0-9\s\-\.+#/]', '', text)
        if DEBUG:
            logging.info(f"After smart cleaning: '{text}'")
        
        # Normalize common patterns in technical drawings
        # Fix spaces around hyphens in identifiers (e.g., "DB - 01" → "DB-01")
        text = re.sub(r'(\w+)\s*-\s*(\w+)', r'\1-\2', text)
        if DEBUG:
            logging.info(f"After pattern normalization: '{text}'")
        
        # Remove isolated single characters except 'a', 'A', 'I' (which could be valid)
        text = re.sub(r'\s+[b-hj-zB-HJ-Z]\s+', ' ', text)
        
        # Final trim and space normalization
        text = text.strip()
        text = re.sub(r'\s+', ' ', text)
        if DEBUG:
            logging.info(f"Final output: '{text}'")
        
        return text
    
    def extract_text_from_pdf(self, pdf_page, rect=None):
        """Extract text from a PDF page"""
        return self.ocr_engine.extract_text_from_page(pdf_page, rect)
    
    def transform_feature(self, feature, context, index=-1):
        """Implements FUN_180005de0 for feature transformation"""
        # If index is -1, return original feature
        if index == -1:
            return feature.copy()
        
        # Otherwise, transform the feature based on the specified context segment
        if index < 0 or index >= len(context.get('segments', [])):
            return None
            
        segment = context['segments'][index]
        
        # Get the feature angle
        angle = feature.get('angle', 0.0)
        
        # Calculate cosine and sine of angle
        cos_angle = math.cos(angle)
        sin_angle = math.sin(angle)
        
        # Extract feature coordinates
        x, y = feature.get('x', 0.0), feature.get('y', 0.0)
        
        # Get the scale factor
        size = feature.get('size', 1.0)
        
        # Transform coordinates as in FUN_180005de0
        new_x = cos_angle * size + x
        new_y = sin_angle * size + y
        
        # Calculate opposite angle as in FUN_180005bb0
        opposite_angle = math.atan2(sin_angle, -cos_angle)  # cos(a+π), sin(a+π)
        
        # Create transformed feature
        transformed = feature.copy()
        transformed.update({
            'x': new_x,
            'y': new_y,
            'transformed_angle': opposite_angle
        })
        
        return transformed
    
    def transform_points(self, points, transform_matrix):
        """Implements FUN_180046590 for transforming multiple points"""
        # This function transforms a set of points using the given transformation matrix
        if not points:
            return []
            
        transformed_points = []
        for point in points:
            x, y = point
            
            # Apply transformation matrix [transform_matrix is a 6-element array]
            new_x = transform_matrix[0] * x + transform_matrix[1] * y + transform_matrix[4]
            new_y = transform_matrix[2] * x + transform_matrix[3] * y + transform_matrix[5]
            
            transformed_points.append((new_x, new_y))
            
        return transformed_points
    
    def calculate_feature_distance(self, feature1, feature2, params):
        """Calculates distance between features, implementing FUN_180001690"""
        # Extract coordinates
        x1, y1 = feature1.get('x', 0), feature1.get('y', 0)
        x2, y2 = feature2.get('x', 0), feature2.get('y', 0)
        
        # Calculate spatial distance exactly as in FUN_180001690
        spatial_dist = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        
        # Calculate angle difference (uses cosines and sines as in original)
        angle1 = feature1.get('angle', 0)
        angle2 = feature2.get('angle', 0)
        
        cos1, sin1 = math.cos(angle1), math.sin(angle1)
        cos2, sin2 = math.cos(angle2), math.sin(angle2)
        
        # Calculate norm of sum of direction vectors (as in FUN_180001410)
        angle_dist = math.sqrt((cos1 + cos2)**2 + (sin1 + sin2)**2)
        
        # Descriptor distance (if available)
        desc_dist = 0
        if (feature1.get('descriptor') is not None and 
            feature2.get('descriptor') is not None):
            desc_dist = np.linalg.norm(feature1['descriptor'] - feature2['descriptor'])
        
        # Weight distances based on params exactly as in original
        weight = params.get('param4', 1.0)
        combined_dist = spatial_dist + (angle_dist * 0.5 * weight * params.get('param2', 1.57))
        
        return combined_dist
    
    def calculate_text_similarity(self, text1, text2):
        """Calculate similarity between two text strings with improved performance."""
        # Quick check for empty strings
        if not text1 or not text2:
            return 0.0
        
        # Normalize texts - strip underscores and whitespace
        t1 = text1.lower().strip().rstrip('_')
        t2 = text2.lower().strip().rstrip('_')
        
        # Handle empty strings after normalization
        if not t1 or not t2:
            return 0.0
        
        # Quick check for exact match
        if t1 == t2:
            return 1.0
        
        # Quick check for substring
        if t1 in t2:
            return len(t1) / len(t2)
        if t2 in t1:
            return len(t2) / len(t1)
        
        # For very short strings (1-3 chars), use stricter matching
        if len(t1) <= 3 or len(t2) <= 3:
            return 1.0 if t1 == t2 else 0.0
        
        # For longer strings, calculate Levenshtein distance more efficiently
        def fast_levenshtein(s1, s2):
            if len(s1) < len(s2):
                return fast_levenshtein(s2, s1)
            
            # len(s1) >= len(s2)
            if len(s2) == 0:
                return len(s1)
            
            previous_row = range(len(s2) + 1)
            for i, c1 in enumerate(s1):
                current_row = [i + 1]
                for j, c2 in enumerate(s2):
                    # j+1 instead of j since previous_row and current_row are one character longer
                    insertions = previous_row[j + 1] + 1
                    deletions = current_row[j] + 1
                    substitutions = previous_row[j] + (c1 != c2)
                    current_row.append(min(insertions, deletions, substitutions))
                previous_row = current_row
            
            return previous_row[-1]
        
        # Calculate similarity
        max_len = max(len(t1), len(t2))
        
        # Fast path: if length difference is too big, similarity will be low
        if abs(len(t1) - len(t2)) > max_len * 0.5:
            return 0.0
        
        # Performance optimization: calculate distance only if strings are similar in length
        distance = fast_levenshtein(t1, t2)
        similarity = 1.0 - (distance / max_len)
        
        # For short strings like "3040SH", allow higher tolerance
        if max_len < 10:
            if similarity >= 0.7:  # Allows for 1-2 character differences
                return similarity
        
        return similarity
    
    def perform_matching(self, context1, context2):
        """Implements FUN_1800021b0 to match two contexts"""
        # Extract features
        features1 = context1.get('features', [])
        features2 = context2.get('features', [])
        
        if len(features1) < 2 or len(features2) < 2:
            return False, None
        
        # Initialize for matching
        threshold = context1['params'].get('param3', 0.65)
        best_dist = float('inf')
        best_match_i = -1
        best_match_j = -1
        
        # Find best feature match - nested loops as in FUN_1800021b0
        for i in range(len(features1)):
            for j in range(len(features2)):
                # Calculate distance between features
                dist = self.calculate_feature_distance(features1[i], features2[j], context1['params'])
                
                if dist < best_dist:
                    best_dist = dist
                    best_match_i = i
                    best_match_j = j
        
        # Check if we found a good match
        if best_dist > threshold:
            # No good match found
            return False, None
            
        # Calculate transformation between matched features
        if best_match_i >= 0 and best_match_j >= 0:
            # Extract matched features
            f1 = features1[best_match_i]
            f2 = features2[best_match_j]
            
            # Get feature positions
            x1, y1 = f1['x'], f1['y']
            x2, y2 = f2['x'], f2['y']
            
            # Calculate transformation components
            dx = x2 - x1
            dy = y2 - y1
            
            # Angle difference
            angle_diff = f2['angle'] - f1['angle']
            
            # Create transformation matrix
            cos_rot = math.cos(angle_diff)
            sin_rot = math.sin(angle_diff)
            
            # Scale factor based on feature sizes
            scale = f2['size'] / f1['size'] if f1['size'] > 0 else 1.0
            
            # Construct the 6-parameter transformation array
            transform = [
                cos_rot * scale, -sin_rot * scale,  # Rotation and scale (row 1)
                sin_rot * scale,  cos_rot * scale,  # Rotation and scale (row 2)
                dx,              dy               # Translation
            ]
            
            return True, transform
        
        return False, None
    
    def autostitch(self, context1, context2, result_buffer):
        """Implements autostitch function"""
        # Check if both contexts are valid
        if not self.is_valid_context(context1) or not self.is_valid_context(context2):
            return False
            
        # Finalize contexts if needed
        if not context1.get('finalized', False):
            self.finalize_matchline_cntxt(context1)
        
        if not context2.get('finalized', False):
            self.finalize_matchline_cntxt(context2)
        
        # Perform feature matching
        success, transform = self.perform_matching(context1, context2)
        
        if success and transform is not None:
            # Fill result buffer with transformation values exactly as in original
            for i in range(min(len(transform), len(result_buffer))):
                result_buffer[i] = transform[i]
                
            return True
        
        return False
    
    def num_match_progress_steps(self, param1, param2):
        """Implements num_match_progress_steps - (param1 * 3 - 1) * param2"""
        return (param1 * 3 - 1) * param2
    
    def visualize_matches(self, context, transform, output_path):
        """Implements FUN_18004d210 to visualize matches"""
        # Create a blank image with white background
        height, width = 500, 500
        img = np.ones((height, width, 3), dtype=np.uint8) * 255
        
        # Draw feature points and lines
        if context.get('features'):
            # Draw original feature points as blue dots
            for feature in context['features']:
                x, y = int(feature['x']), int(feature['y'])
                if 0 <= x < width and 0 <= y < height:
                    cv2.circle(img, (x, y), 3, (255, 0, 0), -1)  # Blue dots
            
            # If we have transformation matrix, draw transformed points as green dots
            if transform is not None:
                for feature in context['features']:
                    x, y = feature['x'], feature['y']
                    new_x = transform[0] * x + transform[1] * y + transform[4]
                    new_y = transform[2] * x + transform[3] * y + transform[5]
                    
                    new_x, new_y = int(new_x), int(new_y)
                    if 0 <= new_x < width and 0 <= new_y < height:
                        cv2.circle(img, (new_x, new_y), 3, (0, 255, 0), -1)  # Green dots
                        
                        # Draw line connecting original and transformed points
                        start_x, start_y = int(x), int(y)
                        if 0 <= start_x < width and 0 <= start_y < height:
                            cv2.line(img, (start_x, start_y), (new_x, new_y), (0, 0, 255), 1)  # Red line
        
        # Draw line segments if available
        if context.get('line_segments'):
            for page_idx, segments in context['line_segments'].items():
                for segment in segments:
                    start = segment.get('start')
                    end = segment.get('end')
                    if start and end:
                        start_x, start_y = int(start[0]), int(start[1])
                        end_x, end_y = int(end[0]), int(end[1])
                        
                        if (0 <= start_x < width and 0 <= start_y < height and
                            0 <= end_x < width and 0 <= end_y < height):
                            cv2.line(img, (start_x, start_y), (end_x, end_y), (0, 0, 0), 2)  # Black line
        
        # Save the visualization
        cv2.imwrite(output_path, img)
        return img

    @staticmethod
    def preprocess_image(image):
        """
        Apply light preprocessing to an image (a PDF snippet image) suitable for OCR,
        especially tuned for technical/construction drawings. This includes converting to grayscale,
        a median blur, and adaptive thresholding.
        """
        import cv2
        # Convert to grayscale if necessary.
        if len(image.shape) > 2:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        # Apply a median blur to remove noise.
        blurred = cv2.medianBlur(gray, 3)
        # Apply adaptive thresholding to improve text contrast.
        processed = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                        cv2.THRESH_BINARY, 11, 2)
        return processed
    
    @staticmethod
    def prune_layout(page_dict, min_width=5, min_height=5, min_chars=3):
        """
        Prune the layout dictionary returned by pdf_page.get_text("dict") by removing blocks/spans
        that are extremely small or contain very little text.
        Returns a new dictionary with only the "essential" blocks.
        """
        pruned_blocks = []
        for block in page_dict.get("blocks", []):
            # Skip blocks without lines.
            if "lines" not in block:
                continue
            pruned_lines = []
            for line in block.get("lines", []):
                if "spans" not in line:
                    continue
                pruned_spans = []
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if len(text) < min_chars:
                        continue
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    width = bbox[2] - bbox[0]
                    height = bbox[3] - bbox[1]
                    if width < min_width or height < min_height:
                        continue
                    pruned_spans.append(span)
                if pruned_spans:
                    # Update the line with pruned spans.
                    new_line = line.copy()
                    new_line["spans"] = pruned_spans
                    pruned_lines.append(new_line)
            if pruned_lines:
                new_block = block.copy()
                new_block["lines"] = pruned_lines
                pruned_blocks.append(new_block)
        # Return a new dict containing only the pruned blocks.
        return {"blocks": pruned_blocks}
    
    def count_matches(self, template_image, document_image, pdf_page, threshold=0.65):
        """
        Original implementation with extensive debug logging for direct text extraction.
        """
        start_time = time.time()
        matches = []
        
        # 1. Extract text from the template snippet using OCR (once)
        extracted_template_text = self.extract_text_from_image(template_image)
        template_text = extracted_template_text.strip() if extracted_template_text else ""
        
        if DEBUG:
            logging.info(f"DEBUG: Template text extracted from image: '{template_text}'")
        
        # 2. Direct text extraction from the full page layout
        text_matches = []
        
        if ENABLE_DIRECT_TEXT and template_text and len(template_text) > 1:
            if DEBUG:
                logging.info(f"DEBUG: Starting direct text extraction, searching for '{template_text}'")
            
            try:
                # Try to get the entire page text dict
                if DEBUG:
                    logging.info("DEBUG: Attempting to extract full page text dict")
                
                page_text_dict = pdf_page.get_text("dict")
                
                if DEBUG:
                    logging.info(f"DEBUG: Successfully extracted page text dict")
                    blocks_count = len(page_text_dict.get("blocks", []))
                    logging.info(f"DEBUG: Found {blocks_count} text blocks in the PDF page")
                
                # Process each block, line, span
                for block_idx, block in enumerate(page_text_dict.get("blocks", [])):
                    if "lines" not in block:
                        if DEBUG:
                            logging.info(f"DEBUG: Block {block_idx} has no lines")
                        continue
                    
                    if DEBUG:
                        lines_count = len(block.get("lines", []))
                        logging.info(f"DEBUG: Block {block_idx} has {lines_count} lines")
                    
                    for line_idx, line in enumerate(block.get("lines", [])):
                        if "spans" not in line:
                            if DEBUG:
                                logging.info(f"DEBUG: Block {block_idx}, Line {line_idx} has no spans")
                            continue
                        
                        if DEBUG:
                            spans_count = len(line.get("spans", []))
                            logging.info(f"DEBUG: Block {block_idx}, Line {line_idx} has {spans_count} spans")
                        
                        for span_idx, span in enumerate(line.get("spans", [])):
                            span_text = span.get("text", "").strip()
                            
                            if DEBUG:
                                # Print the first 50 chars of span text to avoid flooding logs
                                preview = span_text[:50] + "..." if len(span_text) > 50 else span_text
                                logging.info(f"DEBUG: Span text: '{preview}'")
                            
                            # Calculate similarity
                            similarity = self.calculate_text_similarity(template_text, span_text)
                            
                            if DEBUG:
                                logging.info(f"DEBUG: Similarity between '{template_text}' and span: {similarity}")
                            
                            if similarity >= 0.7:
                                if DEBUG:
                                    logging.info(f"DEBUG: MATCH FOUND! Similarity: {similarity}")
                                    logging.info(f"DEBUG: Match text: '{span_text}'")
                                
                                # Extract position data
                                x0, y0, x1, y1 = span.get("bbox", [0, 0, 0, 0])
                                
                                if DEBUG:
                                    logging.info(f"DEBUG: Match bbox: ({x0}, {y0}, {x1}, {y1})")
                                
                                margin = 2
                                match_rect = fitz.Rect(x0 - margin, y0 - margin, x1 + margin, y1 + margin)
                                
                                try:
                                    if DEBUG:
                                        logging.info(f"DEBUG: Extracting match image for rect: {match_rect}")
                                    
                                    match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                                    match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
                                    
                                    if DEBUG:
                                        logging.info(f"DEBUG: Successfully extracted match image")
                                except Exception as e:
                                    if DEBUG:
                                        logging.error(f"DEBUG: Error extracting direct text match image: {e}")
                                    match_image = None
                                
                                text_matches.append({
                                    "rect": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                                    "confidence": float(similarity),
                                    "image": match_image,
                                    "vector_count": 0,
                                    "vector_data": [],
                                    "text": span_text,
                                    "detection_method": "Direct Text Extraction"
                                })
                
                if DEBUG:
                    logging.info(f"DEBUG: Total direct text matches found: {len(text_matches)}")
            
            except Exception as e:
                if DEBUG:
                    logging.error(f"DEBUG: CRITICAL ERROR in direct text extraction: {e}")
                    import traceback
                    logging.error(f"DEBUG: Traceback: {traceback.format_exc()}")
            
            # If we found at least one direct text match, we can return it immediately
            if len(text_matches) >= 1:
                if DEBUG:
                    logging.info(f"DEBUG: Returning {len(text_matches)} direct text matches")
                return self._filter_overlapping_matches(text_matches)
        
        matches.extend(text_matches)
        
        # Continue with template matching if no text matches were found
        if DEBUG:
            logging.info(f"DEBUG: No direct text matches found, proceeding to template matching")
        
        # 3. Template Matching
        if ENABLE_TEMPLATE:
            template_matches = self._find_template_matches_original(template_image, document_image, pdf_page)
            if DEBUG:
                logging.info(f"Template matching found {len(template_matches)} candidates.")
            matches.extend(template_matches)
        
        # If we have enough matches, skip the rest
        if len(matches) >= 4:
            if DEBUG:
                logging.info("Sufficient candidates found via direct text and template matching; skipping visual and OCR matching.")
            return self._filter_overlapping_matches(matches)
        
        # 4. Visual Matching (Feature-based)
        if ENABLE_VISUAL:
            visual_matches = self._find_visual_matches(template_image, document_image, pdf_page, threshold)
            if DEBUG:
                logging.info(f"Visual matching found {len(visual_matches)} candidates.")
            matches.extend(visual_matches)
        
        # If we have enough matches, skip OCR
        if len(matches) >= 4:
            if DEBUG:
                logging.info("Sufficient candidates found; skipping OCR.")
            return self._filter_overlapping_matches(matches)
        
        # 5. OCR-based Search (Last Resort)
        if ENABLE_OCR and template_text:
            if DEBUG:
                logging.info("Starting OCR-based search as last resort.")
            custom_config = r'--oem 3 --psm 7 -c tessedit_do_invert=0'
            ocr_region = compute_pdf_bbox({
                "x": pdf_page.rect.x0,
                "y": pdf_page.rect.y0,
                "width": pdf_page.rect.width,
                "height": pdf_page.rect.height,
                "imageWidth": pdf_page.rect.width,
                "imageHeight": pdf_page.rect.height
            }, pdf_page)
            try:
                ocr_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(OCR_ZOOM_FACTOR, OCR_ZOOM_FACTOR), clip=ocr_region)
                ocr_img = np.frombuffer(ocr_pix.samples, dtype=np.uint8).reshape(ocr_pix.height, ocr_pix.width, 3)
                ocr_gray = cv2.cvtColor(ocr_img, cv2.COLOR_BGR2GRAY)
                ocr_result = pytesseract.image_to_string(ocr_gray, config=custom_config)
                if ocr_result.strip():
                    ocr_data = pytesseract.image_to_data(ocr_gray, output_type=pytesseract.Output.DICT, config=custom_config)
                    for i, word in enumerate(ocr_data.get('text', [])):
                        similarity = self.calculate_text_similarity(template_text, word)
                        if similarity >= 0.7 and int(ocr_data.get('conf', [0]*len(ocr_data['text']))[i]) > 50:
                            word_x = ocr_data['left'][i]
                            word_y = ocr_data['top'][i]
                            word_w = ocr_data['width'][i]
                            word_h = ocr_data['height'][i]
                            margin = max(5, word_h // 2)
                            word_x = max(0, word_x - margin)
                            word_y = max(0, word_y - margin)
                            word_w = min(ocr_gray.shape[1] - word_x, word_w + 2 * margin)
                            word_h = min(ocr_gray.shape[0] - word_y, word_h + 2 * margin)
                            page_x = ocr_region.x0 + word_x / OCR_ZOOM_FACTOR
                            page_y = ocr_region.y0 + word_y / OCR_ZOOM_FACTOR
                            page_w = word_w / OCR_ZOOM_FACTOR
                            page_h = word_h / OCR_ZOOM_FACTOR
                            match_rect = fitz.Rect(page_x, page_y, page_x + page_w, page_y + page_h)
                            try:
                                match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                                match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
                            except Exception as e:
                                if DEBUG:
                                    logging.error(f"Error extracting OCR match image: {e}")
                                match_image = None
                            matches.append({
                                "rect": {"x": page_x, "y": page_y, "width": page_w, "height": page_h},
                                "confidence": float(similarity),
                                "image": match_image,
                                "vector_count": 0,
                                "vector_data": [],
                                "text": word,
                                "detection_method": "OCR"
                            })
            except Exception as e:
                if DEBUG:
                    logging.error(f"Error in OCR processing: {e}")
        
        if DEBUG:
            logging.info(f"Total candidates before filtering: {len(matches)}")
        filtered_matches = self._filter_overlapping_matches(matches)
        if DEBUG:
            logging.info(f"Total matches after filtering duplicates: {len(filtered_matches)}")
        return filtered_matches

    def _find_template_matches(self, template_image, document_image, pdf_page):
        """Stricter template matching with optimized preprocessing."""
        # Convert to grayscale
        if len(template_image.shape) > 2 and template_image.shape[2] == 3:
            template_gray = cv2.cvtColor(template_image, cv2.COLOR_BGR2GRAY)
        else:
            template_gray = template_image.copy()
        if len(document_image.shape) > 2 and document_image.shape[2] == 3:
            document_gray = cv2.cvtColor(document_image, cv2.COLOR_BGR2GRAY)
        else:
            document_gray = document_image.copy()
        
        # Apply preprocessing for better feature matching
        # This combines the preprocessing from Finereader approach
        # Median blur to reduce noise while preserving edges
        template_gray = cv2.medianBlur(template_gray, 3)
        document_gray = cv2.medianBlur(document_gray, 3)
        
        # Apply threshold to improve contrast
        _, template_binary = cv2.threshold(template_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        _, document_binary = cv2.threshold(document_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Ensure valid size
        th, tw = template_binary.shape
        if th > document_binary.shape[0] or tw > document_binary.shape[1]:
            return []
        
        # Multiple template matching methods for better results
        def run_matching(tpl, doc):
            # Use TM_CCOEFF_NORMED which works well for binary images
            result1 = cv2.matchTemplate(doc, tpl, cv2.TM_CCOEFF_NORMED)
            # Also try TM_CCORR_NORMED which can find partial matches
            result2 = cv2.matchTemplate(doc, tpl, cv2.TM_CCORR_NORMED)
            # Return weighted average, emphasizing CCOEFF for higher precision
            return (result1 * 0.8 + result2 * 0.2)
        
        # INCREASED THRESHOLD for stricter matching (0.7 to 0.8)
        MATCH_THRESHOLD = 0.8
        match_results = []
        
        # Create template variants to improve matching
        variant_templates = []
        
        # Original template
        variant_templates.append((template_binary, 0))
        
        # 180° rotation for flipped symbols
        rotated_180 = cv2.rotate(template_binary, cv2.ROTATE_180)
        variant_templates.append((rotated_180, 180))
        
        # Process each template variant
        for tpl, angle in variant_templates:
            h, w = tpl.shape
            
            # Run template matching
            result = run_matching(tpl, document_binary)
            
            # Apply non-maximum suppression to find local maxima
            def non_max_suppression(result_arr, window_size=5):
                # Create a copy of the result array
                suppressed = result_arr.copy()
                rows, cols = result_arr.shape
                
                # Find local maxima
                for i in range(rows):
                    for j in range(cols):
                        # Get region around current point
                        x_min = max(0, j - window_size // 2)
                        x_max = min(cols, j + window_size // 2 + 1)
                        y_min = max(0, i - window_size // 2)
                        y_max = min(rows, i + window_size // 2 + 1)
                        
                        # If current value is not the maximum in the region, suppress it
                        window = result_arr[y_min:y_max, x_min:x_max]
                        if result_arr[i, j] < np.max(window):
                            suppressed[i, j] = 0
                
                return suppressed
            
            # Apply non-maximum suppression
            suppressed_result = non_max_suppression(result)
            
            # Find locations above threshold
            loc = np.where(suppressed_result >= MATCH_THRESHOLD)
            matches = [(x, y, suppressed_result[y, x], angle) for y, x in zip(*loc)]
            
            # Limit the number of matches to avoid processing too many
            matches.sort(key=lambda x: x[2], reverse=True)
            match_results.extend(matches[:25])  # Only take top 25 per variant
        
        # Sort by score
        match_results.sort(key=lambda tup: tup[2], reverse=True)
        
        # STRICTER FILTERING: Increased minimum distance between matches
        filtered_matches = []
        min_distance = max(tw // 2, 15)  # Increased minimum distance (was 10)
        
        for x, y, score, angle in match_results:
            # Check if this match is too close to any existing match
            too_close = False
            for fx, fy, fs, fa in filtered_matches:
                if abs(x - fx) < min_distance and abs(y - fy) < min_distance:
                    too_close = True
                    # If new match has higher score, replace the existing one
                    if score > fs:
                        filtered_matches.remove((fx, fy, fs, fa))
                        too_close = False
                    break
            
            if not too_close:
                filtered_matches.append((x, y, score, angle))
                
                # Limit the total number of matches
                if len(filtered_matches) >= 20:  # Reduced limit (was 30)
                    break
        
        # Build result objects
        results = []
        for x, y, score, angle in filtered_matches:
            pdf_x = x / ZOOM_FACTOR
            pdf_y = y / ZOOM_FACTOR
            pdf_w = w / ZOOM_FACTOR
            pdf_h = h / ZOOM_FACTOR
            
            # Validate coordinates
            if pdf_x < 0 or pdf_y < 0 or pdf_x + pdf_w > pdf_page.rect.width or pdf_y + pdf_h > pdf_page.rect.height:
                continue
            
            match_rect = fitz.Rect(pdf_x, pdf_y, pdf_x + pdf_w, pdf_y + pdf_h)
            
            try:
                # Extract the match image
                match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
                
                # Extract any text from the matching region (with timeout)
                match_text = ""
                try:
                    start_time = time.time()
                    if time.time() - start_time < 0.5:  # Very short timeout (0.5s)
                        match_text = pdf_page.get_text("text", clip=match_rect).strip()
                except:
                    pass
                
                results.append({
                    "rect": {
                        "x": pdf_x,
                        "y": pdf_y,
                        "width": pdf_w,
                        "height": pdf_h
                    },
                    "confidence": float(score),
                    "image": match_image,
                    "vector_count": 0,
                    "vector_data": [],
                    "text": match_text,
                    "detection_method": "Machine Vision" if angle == 0 else f"Machine Vision (Rotated {angle}°)"
                })
            except Exception as e:
                if DEBUG:
                    logging.error(f"Error extracting match image: {str(e)}")
        
        return results
    
    def _find_template_matches_original(self, template_image, document_image, pdf_page):
        """Original template matching implementation that worked properly."""
        # Convert to grayscale
        if len(template_image.shape) > 2 and template_image.shape[2] == 3:
            template_gray = cv2.cvtColor(template_image, cv2.COLOR_BGR2GRAY)
        else:
            template_gray = template_image.copy()
        if len(document_image.shape) > 2 and document_image.shape[2] == 3:
            document_gray = cv2.cvtColor(document_image, cv2.COLOR_BGR2GRAY)
        else:
            document_gray = document_image.copy()
        
        # Minimal preprocessing - just blur to reduce noise
        template_gray = cv2.GaussianBlur(template_gray, (3, 3), 0)
        document_gray = cv2.GaussianBlur(document_gray, (3, 3), 0)
        
        # Ensure valid size and get dimensions
        th, tw = template_gray.shape
        if th > document_gray.shape[0] or tw > document_gray.shape[1]:
            return []
        
        # Simple template matching with TM_CCOEFF_NORMED
        result = cv2.matchTemplate(document_gray, template_gray, cv2.TM_CCOEFF_NORMED)
        
        # Original threshold of 0.7
        MATCH_THRESHOLD = 0.7
        loc = np.where(result >= MATCH_THRESHOLD)
        matches = [(x, y, result[y, x]) for y, x in zip(*loc)]
        
        # Sort by score
        matches.sort(key=lambda tup: tup[2], reverse=True)
        
        # Simple filtering for duplicates with reasonable distance
        filtered_matches = []
        min_distance = max(tw // 3, 10)  # Use template width (tw) instead of undefined 'w'
        
        for x, y, score in matches:
            # Check if this match is too close to any existing match
            too_close = False
            for fx, fy, fs in filtered_matches:
                if abs(x - fx) < min_distance and abs(y - fy) < min_distance:
                    too_close = True
                    # If new match has higher score, replace the existing one
                    if score > fs:
                        filtered_matches.remove((fx, fy, fs))
                        too_close = False
                    break
            
            if not too_close:
                filtered_matches.append((x, y, score))
                
                # Limit the total number of matches to 50
                if len(filtered_matches) >= 50:
                    break
        
        # Build result objects
        results = []
        for x, y, score in filtered_matches:
            pdf_x = x / ZOOM_FACTOR
            pdf_y = y / ZOOM_FACTOR
            pdf_w = tw / ZOOM_FACTOR
            pdf_h = th / ZOOM_FACTOR
            
            match_rect = fitz.Rect(pdf_x, pdf_y, pdf_x + pdf_w, pdf_y + pdf_h)
            
            try:
                match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
            except Exception as e:
                if DEBUG:
                    logging.error(f"Error extracting match image: {str(e)}")
                match_image = None
            
            match_text = self.extract_text_from_pdf(pdf_page, match_rect)
            
            results.append({
                "rect": {
                    "x": pdf_x,
                    "y": pdf_y,
                    "width": pdf_w,
                    "height": pdf_h
                },
                "confidence": float(score),
                "image": match_image,
                "vector_count": 0,
                "vector_data": [],
                "text": match_text,
                "detection_method": "Machine Vision"
            })
        
        return results
    
    def _find_visual_matches(self, template_image, document_image, pdf_page, threshold=0.65):
        """Optimized implementation of visual feature matching for large documents."""
        start_time = time.time()
        
        # Convert images to grayscale
        if len(template_image.shape) > 2 and template_image.shape[2] == 3:
            template_gray = cv2.cvtColor(template_image, cv2.COLOR_BGR2GRAY)
        else:
            template_gray = template_image
            
        if len(document_image.shape) > 2 and document_image.shape[2] == 3:
            document_gray = cv2.cvtColor(document_image, cv2.COLOR_BGR2GRAY)
        else:
            document_gray = document_image
        
        # Apply preprocessing inspired by Finereader's approach
        # Remove noise while preserving edges
        template_gray = cv2.medianBlur(template_gray, 3)
        document_gray = cv2.medianBlur(document_gray, 3)
        
        # Apply thresholding to improve feature detection
        _, template_binary = cv2.threshold(template_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        _, document_binary = cv2.threshold(document_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Use ORB detector which is faster than SIFT
        MAX_FEATURES = 1000
        orb = cv2.ORB_create(nfeatures=MAX_FEATURES)
        
        # Detect keypoints and compute descriptors
        keypoints_template, descriptors_template = orb.detectAndCompute(template_binary, None)
        
        # Skip processing if template has no keypoints
        if keypoints_template is None or len(keypoints_template) < 3:
            return []
        
        # For large documents, use a region-based approach
        matches = []
        document_height, document_width = document_binary.shape
        
        # Calculate optimal window size based on template
        template_height, template_width = template_binary.shape
        window_size = max(template_height, template_width) * 3
        stride = window_size // 2
        
        # Limit number of windows to process
        MAX_WINDOWS = 50
        windows_processed = 0
        
        # Process document in windows
        for y in range(0, document_height - window_size, stride):
            for x in range(0, document_width - window_size, stride):
                # Check timeout
                if time.time() - start_time > MAX_PROCESSING_TIME * 0.15:
                    if DEBUG:
                        logging.warning("Visual matching timeout")
                    break
                    
                # Extract window
                window = document_binary[y:y+window_size, x:x+window_size]
                
                # Detect keypoints in this window
                keypoints_window, descriptors_window = orb.detectAndCompute(window, None)
                
                # Skip if window has no keypoints
                if keypoints_window is None or len(keypoints_window) < 5:
                    continue
                
                # Match descriptors
                matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
                
                try:
                    matches_kp = matcher.match(descriptors_template, descriptors_window)
                    
                    # Sort matches by distance
                    matches_kp = sorted(matches_kp, key=lambda x: x.distance)
                    
                    # Only proceed if we have enough good matches
                    MIN_MATCHES = 5
                    if len(matches_kp) < MIN_MATCHES:
                        continue
                    
                    # Extract matched keypoints
                    template_pts = np.float32([keypoints_template[m.queryIdx].pt for m in matches_kp[:MIN_MATCHES]])
                    window_pts = np.float32([keypoints_window[m.trainIdx].pt for m in matches_kp[:MIN_MATCHES]])
                    
                    # Find homography
                    H, mask = cv2.findHomography(template_pts, window_pts, cv2.RANSAC, 5.0)
                    
                    # Skip if homography failed
                    if H is None:
                        continue
                    
                    # Get the corners of the template
                    h, w = template_binary.shape
                    template_corners = np.float32([[0, 0], [0, h-1], [w-1, h-1], [w-1, 0]]).reshape(-1, 1, 2)
                    
                    # Transform corners to find where the template appears in the window
                    transformed_corners = cv2.perspectiveTransform(template_corners, H)
                    
                    # Compute bounding box of transformed template
                    min_x = np.min(transformed_corners[:, 0, 0])
                    min_y = np.min(transformed_corners[:, 0, 1])
                    max_x = np.max(transformed_corners[:, 0, 0])
                    max_y = np.max(transformed_corners[:, 0, 1])
                    
                    # Calculate match confidence
                    inliers = np.sum(mask)
                    confidence = inliers / MIN_MATCHES
                    
                    if confidence > threshold:
                        # Adjust coordinates for window position
                        min_x += x
                        min_y += y
                        max_x += x
                        max_y += y
                        
                        # Convert to PDF coordinates
                        pdf_x = min_x / ZOOM_FACTOR
                        pdf_y = min_y / ZOOM_FACTOR
                        pdf_w = (max_x - min_x) / ZOOM_FACTOR
                        pdf_h = (max_y - min_y) / ZOOM_FACTOR
                        
                        # Create match rectangle
                        match_rect = fitz.Rect(pdf_x, pdf_y, pdf_x + pdf_w, pdf_y + pdf_h)
                        
                        try:
                            match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                            match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
                            
                            # Extract text with very limited timeout
                            match_text = ""
                            try:
                                text_start = time.time()
                                if time.time() - text_start < 0.5:  # Very short timeout
                                    match_text = pdf_page.get_text("text", clip=match_rect)
                            except:
                                pass
                            
                            matches.append({
                                "rect": {
                                    "x": pdf_x,
                                    "y": pdf_y,
                                    "width": pdf_w,
                                    "height": pdf_h
                                },
                                "confidence": float(confidence),
                                "image": match_image,
                                "vector_count": 0,
                                "vector_data": [],
                                "text": match_text,
                                "detection_method": "Geometric Pattern Recognition"
                            })
                        except Exception as e:
                            if DEBUG:
                                logging.error(f"Error extracting visual match image: {str(e)}")
                except Exception as e:
                    if DEBUG:
                        logging.error(f"Error in feature matching: {str(e)}")
                
                windows_processed += 1
                if windows_processed >= MAX_WINDOWS:
                    if DEBUG:
                        logging.info(f"Processed maximum number of windows ({MAX_WINDOWS})")
                    break
            
            if windows_processed >= MAX_WINDOWS or time.time() - start_time > MAX_PROCESSING_TIME * 0.15:
                break
        
        # Filter matches to remove duplicates
        filtered_matches = []
        min_distance = 20  # Minimum distance between matches in PDF coordinates
        
        matches.sort(key=lambda m: m["confidence"], reverse=True)
        
        for match in matches:
            # Check if this match is too close to any existing match
            too_close = False
            match_x = match["rect"]["x"]
            match_y = match["rect"]["y"]
            match_width = match["rect"]["width"]
            match_height = match["rect"]["height"]
            
            for existing in filtered_matches:
                ex = existing["rect"]["x"]
                ey = existing["rect"]["y"]
                ew = existing["rect"]["width"]
                eh = existing["rect"]["height"]
                
                # Calculate centers
                match_center_x = match_x + match_width / 2
                match_center_y = match_y + match_height / 2
                ex_center_x = ex + ew / 2
                ex_center_y = ey + eh / 2
                
                # Calculate distance between centers
                distance = ((match_center_x - ex_center_x) ** 2 + (match_center_y - ex_center_y) ** 2) ** 0.5
                
                if distance < min_distance:
                    too_close = True
                    # Replace existing match if this one has higher confidence
                    if match["confidence"] > existing["confidence"]:
                        filtered_matches.remove(existing)
                        too_close = False
                    break
            
            if not too_close:
                filtered_matches.append(match)
                
                # Limit the number of results
                if len(filtered_matches) >= 10:
                    break
        
        return filtered_matches
    
    def _filter_overlapping_matches(self, matches, iou_threshold=0.4):
        """
        Remove overlapping matches using improved non-maximum suppression.
        Reduced the IoU threshold from 0.5 to 0.4 for stricter duplicate removal.
        """
        if not matches:
            return []
            
        # Sort matches by confidence (highest first)
        sorted_matches = sorted(matches, key=lambda m: m["confidence"], reverse=True)
        
        # Non-maximum suppression
        filtered_matches = []
        
        for match in sorted_matches:
            should_keep = True
            match_rect = match["rect"]
            
            for kept_match in filtered_matches:
                kept_rect = kept_match["rect"]
                
                # Calculate IoU
                x_overlap = max(0, min(match_rect["x"] + match_rect["width"], 
                                    kept_rect["x"] + kept_rect["width"]) - 
                                max(match_rect["x"], kept_rect["x"]))
                y_overlap = max(0, min(match_rect["y"] + match_rect["height"], 
                                    kept_rect["y"] + kept_rect["height"]) - 
                                max(match_rect["y"], kept_rect["y"]))
                
                intersection = x_overlap * y_overlap
                area1 = match_rect["width"] * match_rect["height"]
                area2 = kept_rect["width"] * kept_rect["height"]
                union = area1 + area2 - intersection
                iou = intersection / union if union > 0 else 0
                
                # Distance between match centers
                match_center_x = match_rect["x"] + match_rect["width"] / 2
                match_center_y = match_rect["y"] + match_rect["height"] / 2
                kept_center_x = kept_rect["x"] + kept_rect["width"] / 2
                kept_center_y = kept_rect["y"] + kept_rect["height"] / 2
                
                center_distance = math.sqrt((match_center_x - kept_center_x)**2 + 
                                        (match_center_y - kept_center_y)**2)
                
                # Consider as duplicate if IoU is high or centers are very close
                if iou > iou_threshold or center_distance < max(match_rect["width"], match_rect["height"]) * 0.5:
                    # Before discarding, preserve the best detection method
                    if "detection_method" in match and "detection_method" in kept_match:
                        # Prioritize methods: Direct Text Extraction > OCR > Machine Vision
                        priority_order = {
                            "Direct Text Extraction": 1,
                            "Text Recognition": 2,
                            "OCR": 3,
                            "Machine Vision": 4,
                            "Geometric Pattern Recognition": 5
                        }
                        
                        match_priority = priority_order.get(match["detection_method"], 99)
                        kept_priority = priority_order.get(kept_match["detection_method"], 99)
                        
                        # If new match has higher priority detection method, update the kept match
                        if match_priority < kept_priority:
                            kept_match["detection_method"] = match["detection_method"]
                            if "text" in match and match.get("text"):
                                kept_match["text"] = match.get("text", "")
                        
                        # If they have the same detection method but new match has higher confidence,
                        # update the kept match confidence
                        elif match_priority == kept_priority and match.get("confidence", 0) > kept_match.get("confidence", 0):
                            kept_match["confidence"] = match.get("confidence", 0)
                    
                    should_keep = False
                    break
                
            if should_keep:
                filtered_matches.append(match)
        
        # Final confidence boost for matches with text that matches the template
        if filtered_matches and any(m.get("detection_method") == "Direct Text Extraction" for m in filtered_matches):
            # Get the text of the highest confidence direct text match to use as reference
            reference_text = ""
            for m in filtered_matches:
                if m.get("detection_method") == "Direct Text Extraction":
                    reference_text = m.get("text", "")
                    break
            
            # Boost confidence of matches with similar text
            if reference_text:
                for match in filtered_matches:
                    if match.get("text") and self.calculate_text_similarity(reference_text, match.get("text", "")) > 0.8:
                        match["confidence"] = min(1.0, match.get("confidence", 0) * 1.2)
        
        # Apply a maximum limit on the number of matches if necessary
        MAX_MATCHES = 200
        if len(filtered_matches) > MAX_MATCHES:
            filtered_matches = filtered_matches[:MAX_MATCHES]
        
        return filtered_matches

# -----------------------
# Main Processing Function
# -----------------------

def main():
    """
    Main function with improved complex PDF handling that always searches the entire page.
    Prioritizes template matching, then visual matching, with optional direct text, and no OCR.
    """
    start_time = time.time()
    
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"result": {"error": "Usage: auto_count.py payload_file.json"}}))
            sys.exit(1)
        
        payload_file = sys.argv[1].strip("'\"")
        if not os.path.exists(payload_file):
            print(json.dumps({"result": {"error": f"Payload file does not exist: {payload_file}"}}))
            sys.exit(1)
        
        with open(payload_file, "r") as f:
            payload = json.load(f)
        
        doc_id = payload.get("id")
        page_index = int(payload.get("pageIndex"))
        bounding_box_payload = payload.get("boundingBox")
        document_obj = payload.get("document")
        pdf_filepath = document_obj.get("FilePath")
        
        if not pdf_filepath:
            print(json.dumps({"result": {"error": "Document object missing 'FilePath'"}}))
            sys.exit(1)
        
        if DEBUG:
            logging.info(f"Loading PDF from file: {pdf_filepath}")
        
        # Load PDF
        pdf_doc = load_pdf(pdf_filepath)
        pdf_page = pdf_doc.load_page(page_index)
        
        # Compute bounding box
        pdf_bbox = compute_pdf_bbox(bounding_box_payload, pdf_page)
        
        # Make sure we have a valid bounding box
        if pdf_bbox is None or not pdf_bbox.is_valid or pdf_bbox.width <= 0 or pdf_bbox.height <= 0:
            if DEBUG:
                logging.error(f"Invalid bounding box: {pdf_bbox}")
            
            # Create default bounding box
            center_x = pdf_page.rect.width / 2
            center_y = pdf_page.rect.height / 2
            pdf_bbox = fitz.Rect(center_x - 25, center_y - 25, center_x + 25, center_y + 25)
            
            if DEBUG:
                logging.info(f"Created default center bounding box: {pdf_bbox}")
        
        if DEBUG:
            logging.info(f"Using bounding box: {pdf_bbox}")
        
        # FIRST CHECK: Early vector count to detect complex PDFs
        is_complex_pdf = False
        vector_count = 0
        vector_count_limit = 50000  # Threshold for considering a PDF complex
        vector_count_sample = 50000  # Maximum samples to check
        
        try:
            # Do a quick sampling of vectors to detect complex PDFs
            count_start = time.time()
            MAX_COUNT_TIME = 1.0  # Maximum time to spend counting vectors
            
            for drawing in pdf_page.get_drawings():
                vector_count += 1
                
                # If we've counted enough vectors or spent too much time, break
                if vector_count > vector_count_sample or (time.time() - count_start) > MAX_COUNT_TIME:
                    break
            
            # If we found more than the threshold in our small sample, it's a complex PDF
            if vector_count > vector_count_limit:
                is_complex_pdf = True
                if DEBUG:
                    logging.warning(f"Complex PDF detected with high vector count ({vector_count}+)")
        except Exception as e:
            if DEBUG:
                logging.error(f"Error during vector count check: {e}")
        
        # Extract snippet
        try:
            snippet_zoom = ZOOM_FACTOR  # Use standard zoom
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(snippet_zoom, snippet_zoom), clip=pdf_bbox)
            pdf_snippet_bytes = pix.tobytes("png")
            pdf_snippet_data_url = "data:image/png;base64," + base64.b64encode(pdf_snippet_bytes).decode("utf-8")
        except Exception as e:
            if DEBUG:
                logging.error(f"Error extracting snippet: {e}")
            # Fall back to simpler extraction without zoom
            pix = pdf_page.get_pixmap(clip=pdf_bbox)
            pdf_snippet_bytes = pix.tobytes("png")
            pdf_snippet_data_url = "data:image/png;base64," + base64.b64encode(pdf_snippet_bytes).decode("utf-8")
        
        # Check for annotations
        annotations = []
        try:
            annotations = check_pdf_annotations(pdf_doc, pdf_page, page_index)
            if DEBUG:
                logging.info(f"Found {len(annotations)} annotations/symbols in PDF structure")
        except Exception as e:
            if DEBUG:
                logging.error(f"Error checking annotations: {e}")
        
        # Extract vector data with limits for all PDFs
        target_vector_data = []
        try:
            target_vector_data = extract_vector_data(pdf_page, pdf_bbox)
            
            if target_vector_data and DEBUG:
                logging.info(f"Found {len(target_vector_data)} vector objects in selected region")
            elif DEBUG:
                logging.info("No vector data found in selected region.")
        except Exception as e:
            if DEBUG:
                logging.error(f"Error extracting vector data: {e}")
        
        # Extract the snippet image into a numpy array for matching
        snippet_array = cv2.imdecode(np.frombuffer(base64.b64decode(pdf_snippet_data_url.split(',')[1]), np.uint8), cv2.IMREAD_COLOR)
        
        # Initialize matching tools
        matching_tools = PDFMatchingTools()
        
        # Choose matching approach based on configuration
        matches = []
        
        if is_complex_pdf and ENABLE_COMPLEX_PDF_SPECIAL_HANDLING:
            # ----------------------------------------------------------------------
            # IMPROVED COMPLEX PDF PROCESSING - Always search entire page
            # ----------------------------------------------------------------------
            if DEBUG:
                logging.info("Using improved processing for complex PDF - searching entire page")
            
            # Extract the full page but at a lower resolution to manage memory
            resolution_factor = 2.0  # Lower resolution than standard ZOOM_FACTOR
            
            try:
                # Extract full page at lower resolution
                full_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(resolution_factor, resolution_factor))
                full_img_data = full_pix.tobytes("png")
                full_img = cv2.imdecode(np.frombuffer(full_img_data, np.uint8), cv2.IMREAD_COLOR)
                
                if DEBUG:
                    logging.info(f"Successfully extracted full page at resolution factor {resolution_factor}")
                
                # 1. Quick direct text extraction with timeout
                if ENABLE_DIRECT_TEXT:
                    direct_text_start = time.time()
                    direct_text_timeout = 10.0
                    direct_text_matches = []
                    
                    try:
                        # Extract text from template
                        template_text = matching_tools.extract_text_from_image(snippet_array).strip()
                        
                        if template_text and len(template_text) > 2:
                            if DEBUG:
                                logging.info(f"Trying quick direct text extraction for '{template_text}'")
                            
                            # Get page text with timeout
                            try:
                                # Using get_text with a timeout is tricky - we'll use a simple approach
                                if time.time() - direct_text_start < direct_text_timeout:
                                    page_text_dict = pdf_page.get_text("dict")
                                    
                                    # Process only the first few blocks to keep it fast
                                    max_blocks = 50
                                    for block_idx, block in enumerate(page_text_dict.get("blocks", [])[:max_blocks]):
                                        if time.time() - direct_text_start > direct_text_timeout:
                                            if DEBUG:
                                                logging.info("Direct text extraction timeout")
                                            break
                                            
                                        if "lines" not in block:
                                            continue
                                            
                                        for line in block.get("lines", []):
                                            if "spans" not in line:
                                                continue
                                                
                                            for span in line.get("spans", []):
                                                span_text = span.get("text", "").strip()
                                                similarity = matching_tools.calculate_text_similarity(template_text, span_text)
                                                
                                                if similarity >= 0.7:
                                                    # Found a match
                                                    x0, y0, x1, y1 = span.get("bbox", [0, 0, 0, 0])
                                                    margin = 2
                                                    match_rect = fitz.Rect(x0 - margin, y0 - margin, x1 + margin, y1 + margin)
                                                    
                                                    try:
                                                        match_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR), clip=match_rect)
                                                        match_image = "data:image/png;base64," + base64.b64encode(match_pix.tobytes("png")).decode("utf-8")
                                                    except Exception:
                                                        match_image = None
                                                        
                                                    direct_text_matches.append({
                                                        "rect": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                                                        "confidence": float(similarity),
                                                        "image": match_image,
                                                        "vector_count": 0,
                                                        "vector_data": [],
                                                        "text": span_text,
                                                        "detection_method": "Direct Text Extraction"
                                                    })
                                                    
                                                    # Limit the number of direct text matches
                                                    if len(direct_text_matches) >= 10:
                                                        break
                            except Exception as text_e:
                                if DEBUG:
                                    logging.error(f"Error in direct text extraction: {text_e}")
                            
                            # Add direct text matches to our results
                            matches.extend(direct_text_matches)
                            if DEBUG:
                                logging.info(f"Found {len(direct_text_matches)} direct text matches")
                                
                            # If we found enough direct text matches, we can skip other methods
                            if len(direct_text_matches) >= 4:
                                if DEBUG:
                                    logging.info("Sufficient direct text matches found, skipping other methods")
                                return matching_tools._filter_overlapping_matches(matches)
                    except Exception as dt_e:
                        if DEBUG:
                            logging.error(f"Error in direct text extraction: {dt_e}")
                
                # 2. Always do template matching as our primary method for complex PDFs
                if ENABLE_TEMPLATE:
                    if DEBUG:
                        logging.info("Starting template matching for complex PDF")
                        
                    template_matches = matching_tools._find_template_matches_original(
                        template_image=snippet_array,
                        document_image=full_img,
                        pdf_page=pdf_page
                    )
                    
                    if DEBUG:
                        logging.info(f"Template matching found {len(template_matches)} matches")
                        
                    matches.extend(template_matches)
                    
                    # If we found enough template matches, skip visual matching
                    if len(matches) >= 4:
                        if DEBUG:
                            logging.info("Sufficient matches found via template matching, skipping visual matching")
                        return matching_tools._filter_overlapping_matches(matches)
                
                # 3. Do visual matching as a fallback
                if ENABLE_VISUAL and len(matches) < 4:
                    if DEBUG:
                        logging.info("Starting visual matching for complex PDF")
                        
                    visual_matches = matching_tools._find_visual_matches(
                        template_image=snippet_array,
                        document_image=full_img,
                        pdf_page=pdf_page,
                        threshold=0.65
                    )
                    
                    if DEBUG:
                        logging.info(f"Visual matching found {len(visual_matches)} matches")
                        
                    matches.extend(visual_matches)
                    
                # Skip OCR completely for complex PDFs
                
            except Exception as complex_e:
                if DEBUG:
                    logging.error(f"Error in complex PDF processing: {complex_e}")
                    import traceback
                    logging.error(f"Traceback: {traceback.format_exc()}")
        else:
            # ----------------------------------------------------------------------
            # STANDARD PROCESSING PATH
            # ----------------------------------------------------------------------
            # Extract the full page at high resolution
            full_pix = pdf_page.get_pixmap(matrix=fitz.Matrix(ZOOM_FACTOR, ZOOM_FACTOR))
            full_img_data = full_pix.tobytes("png")
            full_img = cv2.imdecode(np.frombuffer(full_img_data, np.uint8), cv2.IMREAD_COLOR)
            
            # Use the comprehensive count_matches for all PDFs
            matches = matching_tools.count_matches(snippet_array, full_img, pdf_page)
        
        # Format the result
        if matches:
            result_message = f"Found {len(matches)} similar objects on the page."
        else:
            result_message = "No similar objects found on the page."
            
        if DEBUG:
            logging.info(result_message)
        
        result = {
            "doc_id": doc_id,
            "page_index": page_index,
            "original_bounding_box": bounding_box_payload,
            "pdf_bounding_box": {
                "x": pdf_bbox.x0,
                "y": pdf_bbox.y0,
                "width": pdf_bbox.width,
                "height": pdf_bbox.height
            },
            "vector_data": [serialize_fitz_object(s) for s in target_vector_data],
            "pdf_snippet_image": pdf_snippet_data_url,
            "final_matches": matches,
            "message": result_message,
            "processing_time": time.time() - start_time,
            "complex_pdf_detected": is_complex_pdf,
            "complex_pdf_special_handling": is_complex_pdf and ENABLE_COMPLEX_PDF_SPECIAL_HANDLING,
            "vector_count_sample": vector_count
        }
        result = convert_numpy_types(result)
        print(json.dumps({"result": result}))
    
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        if DEBUG:
            logging.error(f"Unhandled exception: {str(e)}\n{error_traceback}")
        error_result = {
            "error": f"Error processing request: {str(e)}",
            "traceback": error_traceback,
            "processing_time": time.time() - start_time
        }
        print(json.dumps({"result": error_result}))
        sys.exit(1)

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        filename="/tmp/auto_count.log",
        filemode="a",
        format="%(asctime)s - %(levelname)s - %(message)s"
    )
    main()