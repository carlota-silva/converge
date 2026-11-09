import { HEAD, compareIds, idKey, type OpId } from './ids.js';

interface Element {
  id: OpId;
  origin: OpId;
  ch: string;
  deleted: boolean;
}

export interface SerializedElement {
  id: OpId;
  origin: OpId;
  ch: string;
  deleted: boolean;
}

/**
 * Replicated Growable Array.
 *
 * Concurrent insertions at the same origin are ordered by descending Lamport id.
 * Descendants are kept with their ancestor when a concurrent sibling arrives.
 * Comparing only consecutive element IDs is insufficient for that invariant.
 */
export class Rga {
  #items: Element[] = [];
  #seen = new Set<string>();
  #entries = new Map<string, Element>();

  get size(): number {
    return this.#items.length;
  }

  get length(): number {
    let visible = 0;
    for (const item of this.#items) if (!item.deleted && item.ch !== '') visible += 1;
    return visible;
  }

  #indexOf(id: OpId): number {
    const key = idKey(id);
    for (let i = 0; i < this.#items.length; i += 1) {
      if (idKey(this.#items[i]!.id) === key) return i;
    }
    return -1;
  }

  /** Find the immediate child below origin on an element's ancestry chain. */
  #childBelow(element: Element, origin: OpId): OpId | null {
    let current = element;
    while (true) {
      if (idKey(current.origin) === idKey(origin)) return current.id;
      const parent = this.#entries.get(idKey(current.origin));
      if (!parent) return null;
      current = parent;
    }
  }

  /** Apply an insertion. Idempotent; throws if the origin is unknown. */
  insert(id: OpId, origin: OpId, ch: string): void {
    const key = idKey(id);
    if (this.#seen.has(key)) return;

    let start = 0;
    if (!(origin.actor === HEAD.actor && origin.counter === HEAD.counter)) {
      const originIndex = this.#indexOf(origin);
      if (originIndex < 0) throw new Error(`unknown origin ${idKey(origin)}`);
      start = originIndex + 1;
    }

    let at = start;
    while (at < this.#items.length) {
      const sibling = this.#childBelow(this.#items[at]!, origin);
      if (sibling === null || compareIds(sibling, id) <= 0) break;
      at += 1;
    }

    const element = { id, origin, ch, deleted: false };
    this.#items.splice(at, 0, element);
    this.#entries.set(key, element);
    this.#seen.add(key);
  }

  /** Tombstone a set of elements. Unknown ids are ignored. */
  remove(targets: readonly OpId[]): void {
    for (const target of targets) {
      const index = this.#indexOf(target);
      if (index >= 0) this.#items[index]!.deleted = true;
    }
  }

  /** Id of the visible element preceding `index`, or HEAD at index 0. */
  originAt(index: number): OpId {
    if (index <= 0) return HEAD;
    let visible = 0;
    for (const item of this.#items) {
      if (item.deleted || item.ch === '') continue;
      visible += 1;
      if (visible === index) return item.id;
    }
    throw new Error(`index ${index} out of range (length ${this.length})`);
  }

  idsInRange(start: number, count: number): OpId[] {
    if (start < 0 || count < 0) throw new Error('negative range');
    if (count === 0) return [];
    const ids: OpId[] = [];
    let visible = 0;
    for (const item of this.#items) {
      if (item.deleted || item.ch === '') continue;
      if (visible >= start && ids.length < count) ids.push(item.id);
      visible += 1;
      if (ids.length === count) break;
    }
    return ids;
  }

  toString(): string {
    let out = '';
    for (const item of this.#items) if (!item.deleted) out += item.ch;
    return out;
  }

  toArray(): string[] {
    return [...this.toString()];
  }

  serialize(): SerializedElement[] {
    return this.#items.map((item) => ({ ...item }));
  }

  static deserialize(elements: readonly SerializedElement[]): Rga {
    const rga = new Rga();
    for (const element of elements) {
      rga.insert(element.id, element.origin, element.ch);
      if (element.deleted) rga.remove([element.id]);
    }
    return rga;
  }
}
