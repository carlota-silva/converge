import type { Vector } from '../core/clock.js';
import { idKey, type OpId } from '../core/ids.js';
import type { Op } from '../core/op.js';
import { Digest, type SerializedDigest } from './digest.js';

/** The minimum a sync participant must expose to the protocol. */
export interface PeerView {
  clock(): Vector;
  opIds(): OpId[];
  opsById(ids: readonly OpId[]): Op[];
  isReady(op: Op): boolean;
}

export interface HelloMessage {
  t: 'hello';
  clock: Vector;
}

export interface BloomMessage {
  t: 'bloom';
  digest: SerializedDigest;
}

export interface WantMessage {
  t: 'want';
  ids: string[];
}

export interface OpsMessage {
  t: 'ops';
  ops: Op[];
}

export interface DoneMessage {
  t: 'done';
}

export type SyncMessage = HelloMessage | BloomMessage | WantMessage | OpsMessage | DoneMessage;

const MAX_WANT = 4096;

/**
 * Operations beyond the remote contiguous actor clock. A Bloom digest is
 * validated but never used to exclude required operations: Bloom filters can
 * return false positives and must not determine convergence.
 */
export function computeMissing(local: PeerView, remoteClock: Vector, remoteDigest: SerializedDigest): string[] {
  Digest.fromJSON(remoteDigest);
  const missing: string[] = [];

  for (const id of local.opIds()) {
    if (id.counter <= (remoteClock[id.actor] ?? 0)) continue;
    const key = idKey(id);
    missing.push(key);
    if (missing.length >= MAX_WANT) break;
  }
  return missing.sort();
}

/** Digest of everything held locally, sized to the local operation count. */
export function localDigest(local: PeerView): SerializedDigest {
  const ids = local.opIds();
  const digest = Digest.sized(ids.length);
  for (const id of ids) digest.add(idKey(id));
  return digest.toJSON();
}

/** Operations that are causally ready to apply at the receiver. */
export function selectReady(local: PeerView, ops: readonly Op[]): Op[] {
  return ops.filter((op) => local.isReady(op));
}
