#!/usr/bin/env python3
"""
Render a PDF page to a PNG image, optionally cropping to a region.
Invoked via stdin JSON (--json flag) by the TypeScript runner.

Input (stdin JSON):
{
  "pdfPath": "/absolute/path/to.pdf",
  "pageNumber": 1,                    // 1-based
  "dpi": 150,                         // render resolution (default 150)
  "region": {                          // optional crop region
    "x": 100, "y": 200,
    "width": 300, "height": 250,
    "imageWidth": 1200,               // canvas dimensions for coordinate scaling
    "imageHeight": 900
  }
}

Output (stdout JSON):
{
  "success": true,
  "image": "data:image/png;base64,...",
  "width": 1200,
  "height": 900,
  "pageWidth": 612.0,
  "pageHeight": 792.0,
  "pageCount": 5
}
"""
import sys
import json
import os
import base64
import fitz  # PyMuPDF

MAX_DIMENSION = 8000  # pixels


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)

        pdf_path = payload.get("pdfPath")
        if not pdf_path or not os.path.exists(pdf_path):
            print(json.dumps({"success": False, "error": f"PDF not found: {pdf_path}"}))
            sys.exit(1)

        page_number = int(payload.get("pageNumber", 1))
        dpi = float(payload.get("dpi", 150))
        region = payload.get("region")

        doc = fitz.open(pdf_path, filetype="pdf")
        page_count = doc.page_count

        if page_number < 1 or page_number > page_count:
            print(json.dumps({"success": False, "error": f"Page {page_number} out of range (1-{page_count})"}))
            sys.exit(1)

        page = doc.load_page(page_number - 1)  # 0-based

        # Calculate zoom from DPI (PDF standard is 72 DPI)
        zoom = dpi / 72.0

        # Cap zoom to stay under MAX_DIMENSION
        if page.rect.width * zoom > MAX_DIMENSION:
            zoom = MAX_DIMENSION / page.rect.width
        if page.rect.height * zoom > MAX_DIMENSION:
            zoom = min(zoom, MAX_DIMENSION / page.rect.height)

        matrix = fitz.Matrix(zoom, zoom)

        if region:
            # Convert canvas coordinates to PDF coordinates
            img_w = region.get("imageWidth", 0)
            img_h = region.get("imageHeight", 0)

            if img_w > 0 and img_h > 0:
                scale_x = page.rect.width / img_w
                scale_y = page.rect.height / img_h
            else:
                scale_x = 1.0
                scale_y = 1.0

            rx = region["x"] * scale_x
            ry = region["y"] * scale_y
            rw = region["width"] * scale_x
            rh = region["height"] * scale_y

            clip = fitz.Rect(rx, ry, rx + rw, ry + rh)

            # For region crops, use higher zoom for detail
            region_zoom = min(dpi * 2 / 72.0, MAX_DIMENSION / max(rw, 1), MAX_DIMENSION / max(rh, 1))
            matrix = fitz.Matrix(region_zoom, region_zoom)

            pix = page.get_pixmap(matrix=matrix, clip=clip)
        else:
            pix = page.get_pixmap(matrix=matrix)

        png_bytes = pix.tobytes("png")
        data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("utf-8")

        result = {
            "success": True,
            "image": data_url,
            "width": pix.width,
            "height": pix.height,
            "pageWidth": page.rect.width,
            "pageHeight": page.rect.height,
            "pageCount": page_count,
        }

        doc.close()
        print(json.dumps(result))

    except Exception as e:
        import traceback
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
