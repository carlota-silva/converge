# 0003 — Deferred tombstone compaction

Status: proposed

## Context

Deleted characters stay in the RGA as tombstones forever. Without them a later
concurrent insert could not resolve its origin. A long-lived document therefore
grows monotonically with edit volume, not content size.

## Decision

Do not compact yet. When we do, require a coordinator that (a) proves all known
replicas have observed the deletion, then (b) rewrites the log into a snapshot
with tombstones dropped and origins rewritten to surviving predecessors.

## Consequences

- Storage grows with churn. Acceptable while documents are small and the
  benchmark tracks it.
- Compaction will need a membership view, which this design does not have yet.
