import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { decodeOps, type Op } from '../core/op.js';
import { isVector, type Vector } from '../core/clock.js';
import type { SerializedDigest } from './digest.js';
import { computeMissing, localDigest, type PeerView } from './protocol.js';

const MAX_BODY = 8 * 1024 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

export interface ServeOptions {
  peer: PeerView;
  onOps(ops: readonly Op[]): void | Promise<unknown>;
  port?: number;
  host?: string;
}

/**
 * Reference transport. Two endpoints:
 *   POST /sync  { clock, digest } -> { ops, want }
 *   POST /push  { ops }           -> { applied }
 */
export function serve(options: ServeOptions): Server {
  const { peer, onOps } = options;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method !== 'POST') {
        send(response, 405, { error: 'method not allowed' });
        return;
      }

      if (url.pathname === '/sync') {
        const body = (await readJson(request)) as { clock?: Vector; digest?: SerializedDigest };
        if (!isVector(body.clock) || body.digest === undefined) {
          send(response, 400, { error: 'clock and digest are required' });
          return;
        }
        const want = computeMissing(peer, body.clock, body.digest);
        const ops = peer.opsById(want.map((key) => parse(key)));
        send(response, 200, { ops, want, digest: localDigest(peer), clock: peer.clock() });
        return;
      }

      if (url.pathname === '/push') {
        const body = (await readJson(request)) as { ops?: unknown };
        const ops = decodeOps(body.ops ?? []);
        await onOps(ops);
        send(response, 200, { applied: ops.length });
        return;
      }

      send(response, 404, { error: 'not found' });
    } catch (error) {
      send(response, 400, { error: (error as Error).message });
    }
  });
}

function parse(key: string) {
  const at = key.indexOf('@');
  return { counter: Number(key.slice(0, at)), actor: key.slice(at + 1) };
}
