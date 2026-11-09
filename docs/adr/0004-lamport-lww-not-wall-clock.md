# 0004 — Lamport LWW registers, not wall clock

Status: accepted

## Context

"Last write wins" needs an ordering on writes. Wall clocks are intuitive and
wrong: skew lets a stale write overwrite a fresh one, and a device with a bad
clock wins forever.

## Decision

Order by Lamport counter, then actor id. Wall-clock time is metadata for display
only and never participates in merge.

## Consequences

- Merge is deterministic and skew-immune.
- A write that happens later but was made without observing the earlier one can
  lose. This is correct for LWW and is why the register is only used for
  metadata, never for the text body.

## Implementation note (2026-11-09)

Actor-local sequence counters are **not** Lamport timestamps. The prototype
now includes a separate logical `lamport` field in every operation and
advances it after observing applied remote operations. This preserves causal
order for LWW register updates across actors.
