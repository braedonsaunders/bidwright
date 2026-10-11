"""Spatial deduplication after mapping tiled detections into a page frame."""
import math


def dedupe_detections(matches, min_distance_frac=0.3):
    kept = []
    for match in sorted(matches, key=lambda m: -m.get("confidence", 0)):
        duplicate = False
        for previous in kept:
            if (match.get("documentId"), match.get("pageNumber"), match.get("templateId")) != (previous.get("documentId"), previous.get("pageNumber"), previous.get("templateId")):
                continue
            if match.get("id") and match["id"] == previous.get("id"):
                duplicate = True
                break
            x, y, w, h = (match[k] for k in ("x", "y", "w", "h"))
            a, b, c, d = (previous[k] for k in ("x", "y", "w", "h"))
            overlap = max(0, min(x+w, a+c)-max(x, a))*max(0, min(y+h, b+d)-max(y, b))
            union = w*h+c*d-overlap
            distance = math.hypot(x+w/2-a-c/2, y+h/2-b-d/2)
            # IoU and relative center distance are invariant under DPI conversion.
            if (union > 0 and overlap/union >= .5) or distance < min(max(w, h), max(c, d))*min_distance_frac:
                duplicate = True
                break
        if not duplicate:
            kept.append(match)
    return kept
