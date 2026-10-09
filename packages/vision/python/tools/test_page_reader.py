"""Unit tests for the agent page reader.

Builds small PDFs in memory so the tests pin the behaviours the estimating
agent relies on: sheets drawn sideways come back upright, images are sized to
the requested edge, text keeps its position, and tiles address the same frame
the overview image uses.

Run with:
    python -m unittest tools.test_page_reader
"""
from __future__ import annotations

import base64
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from tools.page_reader import read_page, LAYOUT_MAX_EDGE, TABLE_MAX_PATHS, TABLE_MAX_SEGMENTS


def _sideways_sheet(path: str) -> None:
    """A letter page whose drawing and notes run top-to-bottom, like a CAD
    landscape layout printed onto a portrait page."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Two boxes standing in for views, far apart so they cluster separately.
    page.draw_rect(fitz.Rect(80, 80, 260, 360), color=(0, 0, 0), width=2)
    page.draw_rect(fitz.Rect(360, 420, 540, 720), color=(0, 0, 0), width=2)
    # Rotated notes (text direction pointing down the page).
    page.insert_text((300, 120), "BASE PLATE (1) ANCHOR", fontsize=10, rotate=270)
    page.insert_text((320, 120), "PLATFORM FRAMING", fontsize=14, rotate=270)
    doc.save(path)
    doc.close()


class PageReaderTest(unittest.TestCase):
    def setUp(self) -> None:
        handle, self.path = tempfile.mkstemp(suffix=".pdf")
        os.close(handle)
        _sideways_sheet(self.path)

    def tearDown(self) -> None:
        os.unlink(self.path)

    def test_overview_turns_sideways_sheet_upright(self) -> None:
        result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview", "maxEdge": 1000})
        self.assertTrue(result["success"], result)
        self.assertIn(result["rotation"], (90, 270))
        # Upright landscape: wider than tall, long edge exactly the requested size.
        self.assertGreater(result["width"], result["height"])
        self.assertEqual(max(result["width"], result["height"]), 1000)
        self.assertEqual(result["pageSizeInches"], {"width": 11.0, "height": 8.5})

    def test_text_lines_keep_exact_text_and_positions(self) -> None:
        result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        texts = [line["text"] for line in result["textLines"]]
        self.assertIn("BASE PLATE (1) ANCHOR", texts)
        for line in result["textLines"]:
            for frame in ("bbox", "pageBbox"):
                box = line[frame]
                self.assertGreaterEqual(box["x"], 0)
                self.assertLessEqual(box["x"] + box["width"], 1.0001)

    def test_regions_come_from_geometry_not_fixed_zones(self) -> None:
        result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        views = [region for region in result["regions"] if region["kind"] == "view"]
        self.assertGreaterEqual(len(views), 2)
        for region in views:
            self.assertIn("pageBbox", region)
            self.assertTrue(region["id"].startswith("R"))

    def test_tile_reads_a_grid_cell_at_higher_resolution(self) -> None:
        overview = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview", "maxEdge": 600})
        tile_id = overview["grid"]["tiles"][0]["id"]
        tile = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "tile", "tile": tile_id, "maxEdge": 600})
        self.assertTrue(tile["success"], tile)
        self.assertGreater(tile["dpi"], overview["dpi"])
        png = base64.b64decode(tile["image"].split(",", 1)[1])
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_bad_requests_fail_with_codes(self) -> None:
        self.assertEqual(read_page({"pdfPath": self.path, "pageNumber": 9})["code"], "page_out_of_range")
        self.assertEqual(read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "tile"})["code"], "missing_region")
        self.assertEqual(
            read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "tile", "tile": "r9c9"})["code"],
            "unknown_tile",
        )

    def test_dense_cad_geometry_keeps_image_without_table_discovery(self) -> None:
        # The incident sheet had 313,386 paths and no text. Even a sheet with
        # real notes must remain readable when vector table analysis is skipped.
        with patch.object(fitz.Page, "get_cdrawings", return_value=[{"items": []}] * (TABLE_MAX_PATHS + 1)), \
                patch.object(fitz.Page, "find_tables", side_effect=AssertionError("dense paths must not reach table analysis")) as tables:
            result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        self.assertTrue(result["success"])
        self.assertTrue(result["image"].startswith("data:image/png;base64,"))
        self.assertTrue(result["grid"]["tiles"])
        self.assertTrue(result["regions"])
        self.assertIn("BASE PLATE (1) ANCHOR", [line["text"] for line in result["textLines"]])
        self.assertIn("table detection skipped", result["analysisWarnings"][0])
        tables.assert_not_called()

    def test_many_segments_in_one_path_also_skip_table_analysis(self) -> None:
        with patch.object(fitz.Page, "get_cdrawings", return_value=[{"items": [None] * (TABLE_MAX_SEGMENTS + 1)}]), \
                patch.object(fitz.Page, "find_tables") as tables:
            result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        self.assertTrue(result["success"])
        tables.assert_not_called()

    def test_optional_table_failure_preserves_the_drawing(self) -> None:
        with patch.object(fitz.Page, "find_tables", side_effect=RuntimeError("broken table metadata")):
            result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        self.assertTrue(result["success"])
        self.assertIn("broken table metadata", result["analysisWarnings"][0])
        self.assertTrue(result["grid"]["tiles"])

    def test_small_sheet_still_discovers_tables(self) -> None:
        table = type("Table", (), {"bbox": (80, 80, 260, 360)})()
        with patch.object(fitz.Page, "find_tables", return_value=type("Tables", (), {"tables": [table]})()) as tables:
            result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview"})
        tables.assert_called_once()
        self.assertTrue(any(region["kind"] == "table" for region in result["regions"]))

    def test_large_sheet_layout_raster_is_bounded(self) -> None:
        doc = fitz.open()
        page = doc.new_page(width=2384, height=3370)
        page.draw_rect(fitz.Rect(80, 80, 1000, 1200))
        doc.save(self.path)
        doc.close()
        original = fitz.Page.get_pixmap
        sizes = []

        def record_pixmap(page, *args, **kwargs):
            pix = original(page, *args, **kwargs)
            sizes.append((pix.width, pix.height))
            return pix

        with patch.object(fitz.Page, "get_pixmap", record_pixmap):
            result = read_page({"pdfPath": self.path, "pageNumber": 1, "mode": "overview", "maxEdge": 1000})
        self.assertTrue(result["success"])
        self.assertEqual(len(sizes), 2, "overview and optional geometry each render once")
        self.assertLessEqual(max(sizes[1]), LAYOUT_MAX_EDGE + 1)


if __name__ == "__main__":
    unittest.main()
