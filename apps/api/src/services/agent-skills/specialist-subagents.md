---
name: specialist-subagents
description: Optionally delegate a dense sheet, disputed count or independent remeasurement to a focused specialist.
---

When the runtime supports subagents, a focused assignment can resolve a dense sheet, disputed count or a specific uncertainty.
Give the specialist the source IDs, requested scope, exclusions and unit/calibration context it needs. One lead agent remains responsible for the estimate.
An independent remeasurement can be saved in a clearly named comparison group, unlinked from priced rows until deliberately selected.
Keep comparison pickups separate from human takeoff and from the priced selection. A comparison does not authorize replacing existing work.
Compare physical instances, scope, calibration and units when quantities differ; repeated views and overlapping groups often explain a discrepancy.
Delegation and independent comparison are optional aids, not prerequisites for an estimate.

## Independent draft review

A fresh specialist context can review a saved draft against six dimensions: quantity spot-checks, scope coverage against documents, traceability, labour basis share, pricing integrity and commercial clarity. Give it the project/revision IDs and source scope; it can read the draft and original sources and return evidence, proposed changes and uncertainty. The lead estimator can then revise the draft.

`requestEstimateReview({})` provides the same optional path on runtimes without native specialists. It returns a reviewId; `requestEstimateReview({reviewId})` reads findings without launching another review. Reviews are advisory and leave the estimate unchanged.
