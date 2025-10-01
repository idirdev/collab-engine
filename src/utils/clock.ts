/**
 * Lamport Clock: a simple logical clock for establishing a
 * partial causal ordering of events across distributed nodes.
 */
export class LamportClock {
  private counter: number;
  private nodeId: string;

  constructor(nodeId: string, initialValue: number = 0) {
    this.nodeId = nodeId;
    this.counter = initialValue;
  }

  /** Increment and return the new timestamp for a local event. */
  tick(): number {
    this.counter++;
    return this.counter;
  }

  /** Update the clock when receiving a remote timestamp. */
  receive(remoteTimestamp: number): number {
    this.counter = Math.max(this.counter, remoteTimestamp) + 1;
    return this.counter;
  }

  current(): number {
    return this.counter;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  toJSON(): { nodeId: string; counter: number } {
    return { nodeId: this.nodeId, counter: this.counter };
  }
}

/**
 * Vector Clock: tracks causality across multiple nodes.
 * Each node maintains a counter, and the vector is the
 * collection of all node counters.
 */
export class VectorClock {
  private clocks: Map<string, number>;
  private nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.clocks = new Map();
    this.clocks.set(nodeId, 0);
  }

  /** Increment this node's clock component. */
  tick(): Map<string, number> {
    const current = this.clocks.get(this.nodeId) ?? 0;
    this.clocks.set(this.nodeId, current + 1);
    return new Map(this.clocks);
  }

  /** Merge a remote vector clock into this one. */
  merge(remote: Map<string, number>): Map<string, number> {
    for (const [nodeId, remoteTime] of remote) {
      const localTime = this.clocks.get(nodeId) ?? 0;
      this.clocks.set(nodeId, Math.max(localTime, remoteTime));
    }
    // increment own counter to mark the merge event
    const own = this.clocks.get(this.nodeId) ?? 0;
    this.clocks.set(this.nodeId, own + 1);
    return new Map(this.clocks);
  }

  /**
   * Compare two vector clocks:
   * - returns "before" if this happened before other
   * - returns "after" if this happened after other
   * - returns "concurrent" if neither can be ordered
   * - returns "equal" if they are identical
   */
  compare(other: Map<string, number>): 'before' | 'after' | 'concurrent' | 'equal' {
    let hasBefore = false;
    let hasAfter = false;

    const allKeys = new Set([...this.clocks.keys(), ...other.keys()]);

    for (const key of allKeys) {
      const local = this.clocks.get(key) ?? 0;
      const remote = other.get(key) ?? 0;

      if (local < remote) hasBefore = true;
      if (local > remote) hasAfter = true;
    }

    if (!hasBefore && !hasAfter) return 'equal';
    if (hasBefore && !hasAfter) return 'before';
    if (!hasBefore && hasAfter) return 'after';
    return 'concurrent';
  }

  /** Check if this clock is causally before the other. */
  isBefore(other: Map<string, number>): boolean {
    return this.compare(other) === 'before';
  }

  /** Check if events are concurrent (cannot be ordered). */
  isConcurrent(other: Map<string, number>): boolean {
    return this.compare(other) === 'concurrent';
  }

  getNodeId(): string {
    return this.nodeId;
  }

  get(nodeId: string): number {
    return this.clocks.get(nodeId) ?? 0;
  }

  toMap(): Map<string, number> {
    return new Map(this.clocks);
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clocks);
  }
}
