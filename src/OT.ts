import { Operation, InsertOp, DeleteOp, RetainOp, Change } from './types.js';
import { v4 as uuid } from 'uuid';

/**
 * Operational Transformation engine. Handles transforming concurrent
 * operations so they can be applied in any order and still converge
 * to the same document state.
 */
export class OTEngine {
  private pendingBuffer: Change[] = [];
  private acknowledgedVersion: number = 0;
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  /**
   * Transform two operations that were applied concurrently.
   * Returns [op1', op2'] such that apply(apply(doc, op1), op2') === apply(apply(doc, op2), op1').
   */
  transform(op1: Operation, op2: Operation): [Operation, Operation] {
    if (op1.type === 'retain' || op2.type === 'retain') {
      return [op1, op2];
    }

    if (op1.type === 'insert' && op2.type === 'insert') {
      return this.transformInsertInsert(op1, op2);
    }
    if (op1.type === 'insert' && op2.type === 'delete') {
      return this.transformInsertDelete(op1, op2);
    }
    if (op1.type === 'delete' && op2.type === 'insert') {
      const [op2p, op1p] = this.transformInsertDelete(op2, op1);
      return [op1p, op2p];
    }
    if (op1.type === 'delete' && op2.type === 'delete') {
      return this.transformDeleteDelete(op1, op2);
    }

    return [op1, op2];
  }

  private transformInsertInsert(op1: InsertOp, op2: InsertOp): [InsertOp, InsertOp] {
    if (op1.position < op2.position || (op1.position === op2.position && op1.clientId < op2.clientId)) {
      return [op1, { ...op2, position: op2.position + op1.content.length }];
    }
    return [{ ...op1, position: op1.position + op2.content.length }, op2];
  }

  private transformInsertDelete(insertOp: InsertOp, deleteOp: DeleteOp): [InsertOp, DeleteOp] {
    if (insertOp.position <= deleteOp.position) {
      return [insertOp, { ...deleteOp, position: deleteOp.position + insertOp.content.length }];
    }
    if (insertOp.position >= deleteOp.position + deleteOp.length) {
      return [{ ...insertOp, position: insertOp.position - deleteOp.length }, deleteOp];
    }
    // Insert is within the deleted range; move insert to start of delete
    return [{ ...insertOp, position: deleteOp.position }, deleteOp];
  }

  private transformDeleteDelete(op1: DeleteOp, op2: DeleteOp): [DeleteOp, DeleteOp] {
    if (op1.position + op1.length <= op2.position) {
      return [op1, { ...op2, position: op2.position - op1.length }];
    }
    if (op2.position + op2.length <= op1.position) {
      return [{ ...op1, position: op1.position - op2.length }, op2];
    }

    // Overlapping deletes
    const start1 = op1.position;
    const end1 = op1.position + op1.length;
    const start2 = op2.position;
    const end2 = op2.position + op2.length;

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    const overlapLen = Math.max(0, overlapEnd - overlapStart);

    const newOp1: DeleteOp = {
      ...op1,
      position: Math.min(start1, start2),
      length: op1.length - overlapLen,
    };

    const newOp2: DeleteOp = {
      ...op2,
      position: Math.min(start1, start2),
      length: op2.length - overlapLen,
    };

    return [newOp1, newOp2];
  }

  /**
   * Compose two sequential operations into a single operation.
   * compose(op1, op2) means: first apply op1, then apply op2.
   */
  compose(ops: Operation[]): Operation[] {
    if (ops.length <= 1) return ops;

    const composed: Operation[] = [ops[0]];
    for (let i = 1; i < ops.length; i++) {
      const prev = composed[composed.length - 1];
      const curr = ops[i];

      // Merge adjacent inserts
      if (prev.type === 'insert' && curr.type === 'insert' &&
          curr.position === prev.position + prev.content.length &&
          prev.clientId === curr.clientId) {
        composed[composed.length - 1] = { ...prev, content: prev.content + curr.content };
        continue;
      }

      // Merge adjacent deletes
      if (prev.type === 'delete' && curr.type === 'delete' &&
          curr.position === prev.position &&
          prev.clientId === curr.clientId) {
        composed[composed.length - 1] = { ...prev, length: prev.length + curr.length };
        continue;
      }

      composed.push(curr);
    }
    return composed;
  }

  /**
   * Client-side: buffer a local operation. Returns it ready to send.
   */
  bufferLocalChange(ops: Operation[]): Change {
    const change: Change = {
      id: uuid(),
      operations: ops,
      clientId: this.clientId,
      parentVersion: this.acknowledgedVersion,
      resultVersion: this.acknowledgedVersion + 1,
      timestamp: Date.now(),
    };
    this.pendingBuffer.push(change);
    return change;
  }

  /**
   * Client-side: receive server acknowledgment. Remove from buffer.
   */
  acknowledge(changeId: string, serverVersion: number): void {
    this.pendingBuffer = this.pendingBuffer.filter((c) => c.id !== changeId);
    this.acknowledgedVersion = serverVersion;
  }

  /**
   * Client-side: receive a remote change. Transform it against all pending
   * local changes so it can be applied locally.
   */
  receiveRemoteChange(remoteChange: Change): Operation[] {
    let transformedOps = [...remoteChange.operations];

    for (const pendingChange of this.pendingBuffer) {
      const newTransformed: Operation[] = [];
      for (const remoteOp of transformedOps) {
        let currentRemoteOp = remoteOp;
        for (const localOp of pendingChange.operations) {
          const [, transformedRemote] = this.transform(localOp, currentRemoteOp);
          currentRemoteOp = transformedRemote;
        }
        newTransformed.push(currentRemoteOp);
      }
      transformedOps = newTransformed;
    }

    this.acknowledgedVersion = remoteChange.resultVersion;
    return transformedOps;
  }

  /**
   * Server-side: transform an incoming change against all changes that
   * happened since the client's known version.
   */
  serverTransform(incoming: Change, concurrentChanges: Change[]): Operation[] {
    let ops = [...incoming.operations];

    for (const concurrent of concurrentChanges) {
      const newOps: Operation[] = [];
      for (const incomingOp of ops) {
        let transformed = incomingOp;
        for (const concurrentOp of concurrent.operations) {
          const [transformedIncoming] = this.transform(transformed, concurrentOp);
          transformed = transformedIncoming;
        }
        newOps.push(transformed);
      }
      ops = newOps;
    }

    return ops;
  }

  getPendingCount(): number { return this.pendingBuffer.length; }
  getAcknowledgedVersion(): number { return this.acknowledgedVersion; }
}
