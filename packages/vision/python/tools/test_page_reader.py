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

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from tools.page_reader import read_page


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


if __name__ == "__main__":
    unittest.main()
