# Changelog

## 0.1.2 — Test resource cleanup and dependency maintenance (2026-11-09)

- Close file handles and clean up temporary directories after OpLog tests,
  including reopen cases. Node 26 treats leaked FileHandles as errors.
- Update Vitest to the supported 5.1 release and ESLint to the supported v10 line.
- Raise the minimum Node.js version to 22.13.0 and test on Node 22 and 24.
- Use `npm ci` in GitHub Actions for reproducible installs; commit the
  `package-lock.json` created by `npm install` before pushing this update.
- Re-run the full suite and `npm audit` after installation: these dependency
  updates were not executable in the offline packaging environment.

## 0.1.1 — Correctness and durability fixes (2026-11-09)

- Persist incoming operations even when their causal prerequisites are missing.
  Replay now reconstructs the pending buffer and drains it after dependencies arrive.
- Serialize concurrent local and incoming writes, and acknowledge changes only
  after append and fsync.
- Correct two-way HTTP synchronization: the client now computes which operations
  the server lacks, instead of misusing the server's outgoing `want` list.
- Fix RGA insertion ordering so a concurrent sibling cannot split an existing
  sibling's descendants.
- Add logical Lamport timestamps separate from per-actor sequence counters, so
  a register write that observes another write takes precedence.
- Make contiguous per-actor vector clocks authoritative in anti-entropy; Bloom
  digests can no longer suppress required edits on false positives.
- Validate digest lengths and detect complete-but-invalid log records.
- Truncate a torn final log record before subsequent appends.
- Add regression coverage and an independent Node integration smoke suite,
  including 100 deterministic randomized offline-convergence runs.
- Fix GitHub Actions configuration to avoid npm cache requiring a missing lockfile.

### Compatibility and limitations

Operation logs produced by the initial v0.1 prototype without `lamport` fields
cannot be reopened by this version without migration. This project remains a
reference implementation: HTTP endpoints are unauthenticated and should only
be run locally or on a trusted network. Full CI checks require npm packages,
which are fetched by GitHub Actions when the repository is pushed.
