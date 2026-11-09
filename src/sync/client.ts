import { decodeOps, type Op } from '../core/op.js';
import type { Vector } from '../core/clock.js';
import type { SerializedDigest } from './digest.js';
import { computeMissing, localDigest, type PeerView } from './protocol.js';

export interface SyncResult {
  sent: number;
  received: number;
  rounds: number;
}

const MAX_ROUNDS = 64;

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/**
 * Run anti-entropy until both sides stop producing work. Each round pushes what
 * the remote is missing and applies what it returns.
 */
export async function sync(baseUrl: string, local: PeerView, apply: (ops: readonly Op[]) => void | Promise<unknown>): Promise<SyncResult> {
  let sent = 0;
  let received = 0;

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const remote = await post<{ ops: unknown; want: string[]; digest: SerializedDigest; clock: Vector }>(
      `${baseUrl}/sync`,
      { clock: local.clock(), digest: localDigest(local) },
    );

    const incoming = decodeOps(remote.ops);
    if (incoming.length > 0) {
      await apply(incoming);
      received += incoming.length;
    }

    const outgoing = local.opsById(computeMissing(local, remote.clock, remote.digest).map(parseKey));
    if (outgoing.length > 0) {
      await post(`${baseUrl}/push`, { ops: outgoing });
      sent += outgoing.length;
    }

    if (incoming.length === 0 && outgoing.length === 0) {
      return { sent, received, rounds: round };
    }
  }

  throw new Error(`sync did not settle in ${MAX_ROUNDS} rounds`);
}

export function missingForRemote(local: PeerView, clock: Vector, digest: SerializedDigest): string[] {
  return computeMissing(local, clock, digest);
}

function parseKey(key: string) {
  const at = key.indexOf('@');
  return { counter: Number(key.slice(0, at)), actor: key.slice(at + 1) };
}
