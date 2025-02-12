import { v4 as uuid } from 'uuid';

/**
 * Last-Writer-Wins Register: stores a single value; concurrent writes
 * are resolved by timestamp (highest wins).
 */
export class LWWRegister<T> {
  private value: T;
  private timestamp: number;
  private nodeId: string;

  constructor(initialValue: T, nodeId?: string) {
    this.value = initialValue;
    this.timestamp = Date.now();
    this.nodeId = nodeId ?? uuid();
  }

  get(): T { return this.value; }
  getTimestamp(): number { return this.timestamp; }

  set(value: T, timestamp?: number): void {
    const ts = timestamp ?? Date.now();
    if (ts > this.timestamp || (ts === this.timestamp && this.nodeId < (uuid()))) {
      this.value = value;
      this.timestamp = ts;
    }
  }

  merge(other: LWWRegister<T>): void {
    if (other.timestamp > this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
    }
  }

  toJSON(): { value: T; timestamp: number; nodeId: string } {
    return { value: this.value, timestamp: this.timestamp, nodeId: this.nodeId };
  }
}

/**
 * Grow-only Counter: each node maintains its own count; the total is
 * the sum of all node counts. Only increments are allowed.
 */
export class GCounter {
  private counts: Map<string, number> = new Map();
  private nodeId: string;

  constructor(nodeId?: string) {
    this.nodeId = nodeId ?? uuid();
    this.counts.set(this.nodeId, 0);
  }

  increment(amount: number = 1): void {
    if (amount < 0) throw new Error('GCounter only supports increments');
    const current = this.counts.get(this.nodeId) ?? 0;
    this.counts.set(this.nodeId, current + amount);
  }

  value(): number {
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }

  merge(other: GCounter): void {
    for (const [nodeId, count] of other.counts) {
      const local = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(local, count));
    }
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

/**
 * Positive-Negative Counter: two GCounters (one for increments, one for
 * decrements). Value = positive - negative. Supports both inc and dec.
 */
export class PNCounter {
  private positive: GCounter;
  private negative: GCounter;

  constructor(nodeId?: string) {
    const id = nodeId ?? uuid();
    this.positive = new GCounter(id);
    this.negative = new GCounter(id);
  }

  increment(amount: number = 1): void { this.positive.increment(amount); }
  decrement(amount: number = 1): void { this.negative.increment(amount); }
  value(): number { return this.positive.value() - this.negative.value(); }

  merge(other: PNCounter): void {
    this.positive.merge(other.positive);
    this.negative.merge(other.negative);
  }

  toJSON(): { positive: Record<string, number>; negative: Record<string, number> } {
    return { positive: this.positive.toJSON(), negative: this.negative.toJSON() };
  }
}

/**
 * Observed-Remove Set: elements can be added and removed. Each add is
 * tagged with a unique ID; remove only removes observed tags.
 */
export class ORSet<T> {
  private elements: Map<string, { value: T; tag: string }> = new Map();
  private tombstones: Set<string> = new Set();

  add(value: T): string {
    const tag = uuid();
    this.elements.set(tag, { value, tag });
    return tag;
  }

  remove(value: T): void {
    for (const [tag, entry] of this.elements) {
      if (this.deepEqual(entry.value, value)) {
        this.elements.delete(tag);
        this.tombstones.add(tag);
      }
    }
  }

  has(value: T): boolean {
    for (const entry of this.elements.values()) {
      if (this.deepEqual(entry.value, value)) return true;
    }
    return false;
  }

  values(): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const entry of this.elements.values()) {
      const key = JSON.stringify(entry.value);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry.value);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): void {
    for (const tag of other.tombstones) {
      this.elements.delete(tag);
      this.tombstones.add(tag);
    }
    for (const [tag, entry] of other.elements) {
      if (!this.tombstones.has(tag)) {
        this.elements.set(tag, entry);
      }
    }
  }

  size(): number { return this.values().length; }

  private deepEqual(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * Replicated Growable Array (RGA): a sequence CRDT for collaborative text
 * editing. Each character has a unique ID and a reference to the previous
 * character, enabling deterministic ordering across replicas.
 */
interface RGANode {
  id: string;
  value: string;
  deleted: boolean;
  parentId: string | null;
  timestamp: number;
  clientId: string;
}

export class RGA {
  private nodes: RGANode[] = [];
  private nodeIndex: Map<string, number> = new Map();
  private clientId: string;

  constructor(clientId?: string) {
    this.clientId = clientId ?? uuid();
  }

  insert(position: number, char: string): RGANode {
    const parentId = position > 0 ? this.visibleNodeAt(position - 1)?.id ?? null : null;
    const node: RGANode = {
      id: uuid(),
      value: char,
      deleted: false,
      parentId,
      timestamp: Date.now(),
      clientId: this.clientId,
    };

    const insertIdx = this.findInsertIndex(parentId, node);
    this.nodes.splice(insertIdx, 0, node);
    this.rebuildIndex();
    return node;
  }

  delete(position: number): void {
    const node = this.visibleNodeAt(position);
    if (node) node.deleted = true;
  }

  getText(): string {
    return this.nodes.filter((n) => !n.deleted).map((n) => n.value).join('');
  }

  merge(remoteNode: RGANode): void {
    if (this.nodeIndex.has(remoteNode.id)) return;

    const insertIdx = this.findInsertIndex(remoteNode.parentId, remoteNode);
    this.nodes.splice(insertIdx, 0, { ...remoteNode });
    this.rebuildIndex();
  }

  private visibleNodeAt(position: number): RGANode | undefined {
    let visible = -1;
    for (const node of this.nodes) {
      if (!node.deleted) visible++;
      if (visible === position) return node;
    }
    return undefined;
  }

  private findInsertIndex(parentId: string | null, newNode: RGANode): number {
    let startIdx = 0;
    if (parentId !== null) {
      const parentIdx = this.nodeIndex.get(parentId);
      if (parentIdx !== undefined) startIdx = parentIdx + 1;
    }

    let idx = startIdx;
    while (idx < this.nodes.length) {
      const existing = this.nodes[idx];
      if (existing.parentId !== parentId) break;
      if (existing.timestamp < newNode.timestamp) break;
      if (existing.timestamp === newNode.timestamp && existing.clientId < newNode.clientId) break;
      idx++;
    }

    return idx;
  }

  private rebuildIndex(): void {
    this.nodeIndex.clear();
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeIndex.set(this.nodes[i].id, i);
    }
  }

  getNodes(): ReadonlyArray<RGANode> { return this.nodes; }
  length(): number { return this.nodes.filter((n) => !n.deleted).length; }
}
