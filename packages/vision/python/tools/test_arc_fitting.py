"""Unit tests for the bezier-to-arc fitter.

The vector pipeline relies on `_fit_arc_to_cubic` to recover circular-arc
primitives from cubic-bezier segments emitted by CAD tools. Test coverage
focuses on the geometric correctness of the fit and the rejection of
non-circular curves (S-shapes, near-lines, off-radius bumps).

Run with:
    python -m unittest tools.test_arc_fitting
"""
from __future__ import annotations

import math
import unittest

from tools.analyze_geometry import _fit_arc_to_cubic, _fit_circle_through_three


# The classic kappa for approximating a quarter-circle with a cubic bezier.
KAPPA = 0.5522847498307933


class FitCircleThroughThreeTests(unittest.TestCase):
    def test_three_unit_circle_points_recovers_unit_circle(self) -> None:
        result = _fit_circle_through_three((1.0, 0.0), (0.0, 1.0), (-1.0, 0.0))
        self.assertIsNotNone(result)
        assert result is not None  # for type narrowing
        (cx, cy), r = result
        self.assertAlmostEqual(cx, 0.0, places=9)
        self.assertAlmostEqual(cy, 0.0, places=9)
        self.assertAlmostEqual(r, 1.0, places=9)

    def test_translated_circle_is_recovered(self) -> None:
        # Circle of radius 5 centered at (10, -3).
        cx_in, cy_in, r_in = 10.0, -3.0, 5.0
        p0 = (cx_in + r_in, cy_in)
        p1 = (cx_in, cy_in + r_in)
        p2 = (cx_in - r_in, cy_in)
        result = _fit_circle_through_three(p0, p1, p2)
        self.assertIsNotNone(result)
        assert result is not None
        (cx, cy), r = result
        self.assertAlmostEqual(cx, cx_in, places=9)
        self.assertAlmostEqual(cy, cy_in, places=9)
        self.assertAlmostEqual(r, r_in, places=9)

    def test_collinear_points_return_none(self) -> None:
        self.assertIsNone(
            _fit_circle_through_three((0.0, 0.0), (1.0, 0.0), (2.0, 0.0))
        )


class FitArcToCubicTests(unittest.TestCase):
    def test_unit_quarter_circle_fits(self) -> None:
        # Standard quarter-arc bezier: (1,0) → (0,1) curving outward,
        # control points placed along the tangents at distance R*kappa.
        p0 = (1.0, 0.0)
        p1 = (1.0, KAPPA)
        p2 = (KAPPA, 1.0)
        p3 = (0.0, 1.0)
        result = _fit_arc_to_cubic(p0, p1, p2, p3)
        self.assertIsNotNone(result)
        assert result is not None
        (cx, cy), r, start, end = result
        self.assertAlmostEqual(cx, 0.0, places=2)
        self.assertAlmostEqual(cy, 0.0, places=2)
        self.assertAlmostEqual(r, 1.0, places=2)
        # Start at (1,0) → angle 0; end at (0,1) → angle π/2.
        self.assertAlmostEqual(start, 0.0, places=3)
        self.assertAlmostEqual(end, math.pi / 2, places=3)

    def test_quarter_arc_with_offset_origin_fits(self) -> None:
        # Same quarter-arc but translated by (50, -20). Center should
        # follow the translation.
        ox, oy = 50.0, -20.0
        p0 = (ox + 1.0, oy + 0.0)
        p1 = (ox + 1.0, oy + KAPPA)
        p2 = (ox + KAPPA, oy + 1.0)
        p3 = (ox + 0.0, oy + 1.0)
        result = _fit_arc_to_cubic(p0, p1, p2, p3)
        self.assertIsNotNone(result)
        assert result is not None
        (cx, cy), r, _, _ = result
        self.assertAlmostEqual(cx, ox, places=2)
        self.assertAlmostEqual(cy, oy, places=2)
        self.assertAlmostEqual(r, 1.0, places=2)

    def test_large_radius_quarter_arc_fits(self) -> None:
        # Radius 250 quarter-arc → should still fit. Catches absolute-tol
        # bugs in the tolerance check.
        r_in = 250.0
        p0 = (r_in, 0.0)
        p1 = (r_in, r_in * KAPPA)
        p2 = (r_in * KAPPA, r_in)
        p3 = (0.0, r_in)
        result = _fit_arc_to_cubic(p0, p1, p2, p3)
        self.assertIsNotNone(result)
        assert result is not None
        (_, _), r, _, _ = result
        self.assertAlmostEqual(r, r_in, delta=r_in * 0.01)

    def test_straight_line_rejected(self) -> None:
        # A horizontal line dressed up as a cubic.
        result = _fit_arc_to_cubic(
            (0.0, 0.0), (10.0, 0.0), (20.0, 0.0), (30.0, 0.0)
        )
        self.assertIsNone(result)

    def test_s_curve_rejected(self) -> None:
        # Inflection cubic: control points pull opposite ways. Not
        # representable as a single circle.
        result = _fit_arc_to_cubic(
            (0.0, 0.0), (5.0, 10.0), (10.0, -10.0), (15.0, 0.0)
        )
        self.assertIsNone(result)

    def test_arc_with_5_percent_off_control_point_still_fits(self) -> None:
        # Push one control out by 5% — still within tol_ratio=0.05 default.
        p0 = (1.0, 0.0)
        p1 = (1.05, KAPPA)  # 5% radial excursion
        p2 = (KAPPA, 1.0)
        p3 = (0.0, 1.0)
        result = _fit_arc_to_cubic(p0, p1, p2, p3, tol_ratio=0.08)
        self.assertIsNotNone(result)

    def test_asymmetric_perturbation_breaks_circular_fit(self) -> None:
        # Push only p1 outward by 30%. The asymmetry means the curve's
        # t=0.5 midpoint shifts, but t=0.25 lands closer to original
        # geometry, so the candidate circle (fit through p0, mid, p3)
        # won't accommodate t=0.25 within tolerance. Fitter should refuse.
        p0 = (1.0, 0.0)
        p1 = (1.3, KAPPA * 1.3)  # only p1 is perturbed
        p2 = (KAPPA, 1.0)
        p3 = (0.0, 1.0)
        result = _fit_arc_to_cubic(p0, p1, p2, p3, tol_ratio=0.02)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
