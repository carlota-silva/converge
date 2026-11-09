import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VectorClock, isVector, type Vector } from '../core/clock.js';
import { Document, type SerializedDocument } from '../core/document.js';

export interface Snapshot {
  version: 1;
  clock: Vector;
  document: SerializedDocument;
  /** Number of log operations folded into this snapshot. */
  opsApplied: number;
}

export interface ReplicaState {
  clock: VectorClock;
  document: Document;
  opsApplied: number;
}

export function capture(state: ReplicaState): Snapshot {
  return {
    version: 1,
    clock: state.clock.toJSON(),
    document: state.document.serialize(),
    opsApplied: state.opsApplied,
  };
}

export function restore(snapshot: Snapshot): ReplicaState {
  if (snapshot.version !== 1) throw new Error(`unsupported snapshot version ${snapshot.version}`);
  if (!isVector(snapshot.clock)) throw new Error('snapshot clock is malformed');
  return {
    clock: VectorClock.fromJSON(snapshot.clock),
    document: Document.deserialize(snapshot.document),
    opsApplied: snapshot.opsApplied,
  };
}

export async function writeSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot));
}

export async function readSnapshot(path: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
