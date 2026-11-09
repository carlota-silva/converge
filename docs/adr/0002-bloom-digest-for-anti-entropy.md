# 0002 — Exact reconciliation, with Bloom digests as hints

Status: revised (2026-11-09)

## Context

A vector clock with dense per-actor counters tells us exactly how many
operations from **each** actor a replica has applied. Two offline replicas
edit under different actor IDs, so their divergent branches remain visible.

Bloom filters are useful approximate membership summaries but can yield false
positives. An earlier version of this prototype treated a Bloom positive as
proof that a peer had an operation. That could permanently omit an update.

## Decision

Use contiguous vector clocks to select operations for transmission. Enforce
per-actor counter continuity and causal dependencies in `Replica`.

Bloom digests are still exchanged as experimental metadata and validated, but
never exclude operations needed by the receiving peer. Future Bloom-based
optimisation requires an exact fallback or an acknowledgement protocol.

## Consequences

- Correctness does not depend on Bloom filter false-positive rates.
- Operations for actors behind the peer clock are transferred, in bounded
  batches with repeated rounds.
- A very large history may take many rounds; this reference transport currently
  caps sync rounds and has no production-scale pagination or compression.
