import sys
from pathlib import Path
import fitz
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from pdf_takeoff import run
from dedupe_detections import dedupe_detections


@pytest.fixture
def drawing(tmp_path):
    path = tmp_path / "synthetic.pdf"
    with fitz.open() as doc:
        page = doc.new_page(width=300, height=200)
        page.draw_line((20, 100), (220, 100))
        page.draw_line((120, 100), (120, 160))
        page.draw_line((20, 95), (20, 105))
        page.draw_line((220, 95), (220, 105))
        page.insert_text((95, 90), "10 m")
        doc.save(path)
    return str(path)


def test_snap_trace_and_dimension_ratio(drawing):
    result = run({"pdfPath": drawing, "operation": "snap", "points": [{"x": 121, "y": 99}, {"x": 280, "y": 20}], "tolerance": 3})
    assert result["points"][0] == {"x": 120, "y": 100}
    assert result["snaps"][0]["distance"] == pytest.approx(2**.5)
    assert result["unsnappedVertices"] == [1]
    traced = run({"pdfPath": drawing, "operation": "trace", "seed": {"x": 60, "y": 100}})
    assert {"x": 120, "y": 100} in traced["branchPoints"]
    length = sum(((p[1]["x"]-p[0]["x"])**2+(p[1]["y"]-p[0]["y"])**2)**.5 for p in traced["paths"])
    assert length == pytest.approx(280)
    scale = run({"pdfPath": drawing, "operation": "scale"})["dimensions"]
    assert scale["clusters"][0]["ratio"] == pytest.approx(10 / (200*.0254/72))


def test_overlay_and_intrinsic_rotation(drawing):
    output = run({"pdfPath": drawing, "operation": "overlay", "maxEdge": 512, "pickups": [{"id": "pickup-test", "annotationType": "count", "points": [{"x": 30, "y": 40}]}]})
    assert output["nativeImage"] != output["overlayImage"]
    assert max(output["width"], output["height"]) <= 512
    with fitz.open(drawing) as doc:
        doc[0].set_rotation(90)
        doc.save(drawing + ".rotated.pdf")
    result = run({"pdfPath": drawing + ".rotated.pdf", "operation": "snap", "points": [{"x": 101, "y": 121}]})
    assert result["points"][0] == {"x": 100, "y": 120}


def test_dedupe_tile_overlap_preserves_pages_and_adjacent_symbols():
    matches = [dict(x=10, y=20, w=10, h=10, confidence=.9, pageNumber=1), dict(x=11, y=20, w=10, h=10, confidence=.8, pageNumber=1), dict(x=21, y=20, w=10, h=10, confidence=.8, pageNumber=1), dict(x=10, y=20, w=10, h=10, confidence=.8, pageNumber=2)]
    assert len(dedupe_detections(matches)) == 3


def test_dense_page_returns_fact_quickly_without_partial_trace(tmp_path):
    import time
    path = tmp_path / "dense.pdf"
    with fitz.open() as doc:
        page = doc.new_page(width=1000, height=1000)
        shape = page.new_shape()
        for i in range(20000):
            y = i / 20
            shape.draw_line((0, y), (1000, y))
        shape.finish()
        shape.commit()
        doc.save(path)
    started = time.monotonic()
    result = run({"pdfPath": str(path), "operation": "trace", "seed": {"x": 50, "y": 50}})
    assert time.monotonic() - started < 5
    assert "too_dense" in result["facts"]
    assert result["paths"] == []
    snapped = run({"pdfPath": str(path), "operation": "snap", "points": [{"x": 50, "y": 50}]})
    assert "too_dense" in snapped["facts"]
    assert snapped["unsnappedVertices"] == [0]


def test_crossings_do_not_connect_but_t_junctions_do(tmp_path):
    path = tmp_path / "crossings.pdf"
    with fitz.open() as doc:
        page = doc.new_page(width=300, height=200)
        page.draw_line((20, 100), (220, 100))
        page.draw_line((120, 20), (120, 180))
        page.draw_line((70, 100), (70, 150))
        doc.save(path)
    result = run({"pdfPath": str(path), "operation": "trace", "seed": {"x": 40, "y": 100}})
    length = sum(((p[1]["x"]-p[0]["x"])**2+(p[1]["y"]-p[0]["y"])**2)**.5 for p in result["paths"])
    assert length == pytest.approx(250)
    assert result["crossings"] == [{"x": 120, "y": 100}]
    assert {"x": 70, "y": 100} in result["branchPoints"]


def test_info_does_not_extract_vectors_and_view_points_transform_once(drawing, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("info extracted vectors")
    monkeypatch.setattr(fitz.Page, "get_drawings", forbidden)
    monkeypatch.setattr(fitz.Page, "get_cdrawings", forbidden)
    result = run({"pdfPath": drawing, "operation": "info", "coordinateSpace": "view-normalized", "view": {"rotation": 90, "bbox": {"x": .1, "y": .2, "width": .5, "height": .4}}, "points": [{"x": .25, "y": .5}]})
    assert result["points"][0]["x"] == pytest.approx(120)
    assert result["points"][0]["y"] == pytest.approx(155)
