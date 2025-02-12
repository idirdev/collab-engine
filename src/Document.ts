import { v4 as uuid } from 'uuid';
import {
  DocumentState,
  Operation,
  InsertOp,
  DeleteOp,
  Change,
  VersionVector,
  Snapshot,
} from './types.js';

export class Document {
  private state: DocumentState;

  constructor(id?: string, initialContent: string = '') {
    this.state = {
      id: id ?? uuid(),
      content: initialContent,
      version: 0,
      versionVector: {},
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  get id(): string { return this.state.id; }
  get content(): string { return this.state.content; }
  get version(): number { return this.state.version; }
  get versionVector(): VersionVector { return { ...this.state.versionVector }; }

  insert(position: number, text: string, clientId: string): Change {
    if (position < 0 || position > this.state.content.length) {
      throw new RangeError(`Insert position ${position} out of bounds [0, ${this.state.content.length}]`);
    }

    const op: InsertOp = {
      type: 'insert',
      position,
      content: text,
      clientId,
      timestamp: Date.now(),
    };

    return this.applyOperation(op, clientId);
  }

  delete(position: number, length: number, clientId: string): Change {
    if (position < 0 || position + length > this.state.content.length) {
      throw new RangeError(`Delete range [${position}, ${position + length}) out of bounds [0, ${this.state.content.length})`);
    }

    const op: DeleteOp = {
      type: 'delete',
      position,
      length,
      clientId,
      timestamp: Date.now(),
    };

    return this.applyOperation(op, clientId);
  }

  replace(position: number, length: number, text: string, clientId: string): Change {
    if (position < 0 || position + length > this.state.content.length) {
      throw new RangeError(`Replace range [${position}, ${position + length}) out of bounds`);
    }

    const deleteOp: DeleteOp = { type: 'delete', position, length, clientId, timestamp: Date.now() };
    const insertOp: InsertOp = { type: 'insert', position, content: text, clientId, timestamp: Date.now() };

    return this.applyOperations([deleteOp, insertOp], clientId);
  }

  applyOperation(op: Operation, clientId: string): Change {
    return this.applyOperations([op], clientId);
  }

  applyOperations(ops: Operation[], clientId: string): Change {
    const parentVersion = this.state.version;

    for (const op of ops) {
      this.executeOperation(op);
    }

    this.state.version++;
    this.state.versionVector[clientId] = (this.state.versionVector[clientId] ?? 0) + 1;
    this.state.updatedAt = Date.now();

    const change: Change = {
      id: uuid(),
      operations: ops,
      clientId,
      parentVersion,
      resultVersion: this.state.version,
      timestamp: Date.now(),
    };

    this.state.history.push(change);
    return change;
  }

  private executeOperation(op: Operation): void {
    switch (op.type) {
      case 'insert': {
        const before = this.state.content.slice(0, op.position);
        const after = this.state.content.slice(op.position);
        this.state.content = before + op.content + after;
        break;
      }
      case 'delete': {
        const before = this.state.content.slice(0, op.position);
        const after = this.state.content.slice(op.position + op.length);
        this.state.content = before + after;
        break;
      }
      case 'retain':
        break;
    }
  }

  resolveConflict(localChange: Change, remoteChange: Change): Operation[] {
    const resolved: Operation[] = [];

    for (const remoteOp of remoteChange.operations) {
      let transformed = remoteOp;
      for (const localOp of localChange.operations) {
        transformed = this.transformOperation(transformed, localOp);
      }
      resolved.push(transformed);
    }

    return resolved;
  }

  private transformOperation(op: Operation, against: Operation): Operation {
    if (op.type === 'retain' || against.type === 'retain') return op;

    if (op.type === 'insert' && against.type === 'insert') {
      const opPos = op.position;
      const againstPos = against.position;
      if (opPos <= againstPos) return op;
      return { ...op, position: opPos + against.content.length };
    }

    if (op.type === 'insert' && against.type === 'delete') {
      if (op.position <= against.position) return op;
      if (op.position >= against.position + against.length) {
        return { ...op, position: op.position - against.length };
      }
      return { ...op, position: against.position };
    }

    if (op.type === 'delete' && against.type === 'insert') {
      if (op.position >= against.position) {
        return { ...op, position: op.position + against.content.length };
      }
      if (op.position + op.length <= against.position) return op;
      return op;
    }

    if (op.type === 'delete' && against.type === 'delete') {
      if (op.position >= against.position + against.length) {
        return { ...op, position: op.position - against.length };
      }
      if (op.position + op.length <= against.position) return op;
      const overlapStart = Math.max(op.position, against.position);
      const overlapEnd = Math.min(op.position + op.length, against.position + against.length);
      const overlapLen = Math.max(0, overlapEnd - overlapStart);
      return { ...op, position: Math.min(op.position, against.position), length: op.length - overlapLen };
    }

    return op;
  }

  snapshot(): Snapshot {
    return {
      documentId: this.state.id,
      content: this.state.content,
      version: this.state.version,
      versionVector: { ...this.state.versionVector },
      timestamp: Date.now(),
    };
  }

  restoreFromSnapshot(snapshot: Snapshot): void {
    this.state.content = snapshot.content;
    this.state.version = snapshot.version;
    this.state.versionVector = { ...snapshot.versionVector };
    this.state.updatedAt = Date.now();
  }

  getHistory(since?: number): Change[] {
    if (since === undefined) return [...this.state.history];
    return this.state.history.filter((c) => c.resultVersion > since);
  }
}
