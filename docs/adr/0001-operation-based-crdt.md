# 0001 — Operation-based CRDT, not state-based

Status: accepted

## Context

State-based CRDTs merge by joining whole states: simple, but the payload grows
with document size and every sync ships everything. Operation-based CRDTs ship
only new operations but require exactly-once, causally ordered delivery.

## Decision

Operation-based. Exactly-once is solved locally with an `OpId` dedupe set and
causality with a dependency buffer, so the transport can be lossy and
out-of-order without being able to corrupt state.

## Consequences

- Sync payloads are proportional to the edit, not the document.
- We own dedupe and buffering; both are small and unit-tested.
- Pending operations can grow unboundedly if a peer never sends a dependency.
  Mitigated by the anti-entropy pass pulling missing operations, not by dropping
  them.
