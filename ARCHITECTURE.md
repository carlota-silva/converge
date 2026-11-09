# Architecture

## Layers

```text
CLI / HTTP transport
     ↓
Sync protocol / anti-entropy
     ↓
Replica / causal delivery
     ↓
Document / RGA / LWW registers
     ↓
Operation types / clocks / identifiers
     ↓
Operation log / snapshots
```

## Identity and causal delivery

Each actor produces operation IDs `{actor, counter}`. Operations contain a dependency vector and a logical Lamport timestamp. `Replica.receive` persists each accepted operation before acknowledging it, buffers it until the dependencies and actor sequence are satisfied, and ignores duplicate operation IDs. Replay handles out-of-order records through the same pending buffer.

## Merge

Text operations address elements by stable ID. Concurrent insertions receive a deterministic sibling order. Metadata writes use Lamport counter then actor ID as a tie break.

## Sync

Peers exchange vector clocks and Bloom filters over operation IDs. Contiguous per-actor vector clocks determine exactly which operations need transmission; a Bloom digest is optional metadata and cannot suppress transmission because false positives could cause permanent missing updates. The HTTP transport is experimental and unauthenticated.

## Persistence

`OpLog` writes one JSON operation per line. The operation log is the primary record; snapshots are optional.

## Testing

The suite exercises subtree-safe RGA ordering, clock causality, offline convergence, two-way protocol sync, digest validation, buffered-operation replay, and operation-log corruption. Run it with `npm test`.
