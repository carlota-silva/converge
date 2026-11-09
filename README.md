# converge

A local-first sync engine written in TypeScript. Replicas can edit independently while offline, exchange operations after reconnecting, and converge without a coordinator.

**Status:** Experimental reference project. Not production-hardened; there is no authentication or transport encryption. Avoid exposing the HTTP server to untrusted networks.

## Features

- Replicated Growable Array (RGA) CRDT for collaborative plain text
- Last-write-wins (LWW) metadata registers
- Causal delivery using vector clocks and a pending operation buffer
- Vector-clock anti-entropy (Bloom digests exchanged as non-authoritative hints)
- Durable append-only persistence (including pending operations), in-memory test logs, and a reference HTTP sync transport
- Automated tests and benchmarks

## Quick start

Requires Node.js 22.13 or newer (Node 24 LTS also supported).

```bash
npm install
npm audit
npm run typecheck
npm run lint
npm test
npm run build
node dist/cli.js demo
npm run smoke
```

## CLI

```bash
node dist/cli.js serve --port 8787 --actor server
node dist/cli.js sync http://localhost:8787 --actor alice
```

## Design

- Operations carry actor IDs, counters, and causal dependencies.
- Text insertions use stable IDs; concurrent siblings have a deterministic order.
- Deleted characters are retained as tombstones.
- Register merge precedence is `(logical Lamport timestamp, actor ID)`, not wall-clock time.

For decisions and design trade-offs, see [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/adr](docs/adr).

## Development and verification

Run `npm install` to generate `package-lock.json`, then `npm audit`,
`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
Commit `package-lock.json` so GitHub Actions can use reproducible `npm ci`
installs on Node 22 and 24. Run `npm run smoke` after building for a basic standalone
integration check without a test-runner dependency.

This codebase is an AI-assisted prototype. Review the tests, logic, and ADRs
before relying on it in any important application. Contributions and further
engineering work are welcome.

## Limitations

No authentication or signing, no wire compression, no tombstone compaction, and no rich text support. Field types must be agreed in advance; concurrent incompatible field declarations are not resolved. The merge and synchronization algorithms are prototypes and have not been audited. Existing v0.1 operation logs without `lamport` fields are not supported; migrate or discard those experimental logs.

## License

MIT.
