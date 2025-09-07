import { Change, Operation, InsertOp, DeleteOp } from './types.js';

interface HistoryEntry {
  change: Change;
  inverse: Operation[];
}

export class EditHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxSize: number;

  constructor(maxSize: number = 200) {
    this.maxSize = maxSize;
  }

  push(change: Change): void {
    const inverse = this.computeInverse(change.operations);
    this.undoStack.push({ change, inverse });
    this.redoStack = []; // clear redo on new edit

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): Operation[] | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.redoStack.push(entry);
    return entry.inverse;
  }

  redo(): Operation[] | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.undoStack.push(entry);
    return entry.change.operations;
  }

  /**
   * Compact recent entries: merge sequential small edits from the same
   * client into a single undo entry (e.g., typing individual characters).
   */
  compact(withinMs: number = 1000): number {
    if (this.undoStack.length < 2) return 0;

    let compacted = 0;
    const merged: HistoryEntry[] = [this.undoStack[0]];

    for (let i = 1; i < this.undoStack.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = this.undoStack[i];

      const sameClient = prev.change.clientId === curr.change.clientId;
      const withinTime = curr.change.timestamp - prev.change.timestamp < withinMs;
      const bothInserts = prev.change.operations.every((o) => o.type === 'insert')
        && curr.change.operations.every((o) => o.type === 'insert');

      if (sameClient && withinTime && bothInserts) {
        // merge into previous
        merged[merged.length - 1] = {
          change: {
            ...prev.change,
            operations: [...prev.change.operations, ...curr.change.operations],
            resultVersion: curr.change.resultVersion,
            timestamp: curr.change.timestamp,
          },
          inverse: [...curr.inverse, ...prev.inverse],
        };
        compacted++;
      } else {
        merged.push(curr);
      }
    }

    this.undoStack = merged;
    return compacted;
  }

  private computeInverse(ops: Operation[]): Operation[] {
    const inverse: Operation[] = [];

    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      switch (op.type) {
        case 'insert':
          inverse.push({
            type: 'delete',
            position: op.position,
            length: op.content.length,
            clientId: op.clientId,
            timestamp: Date.now(),
          });
          break;
        case 'delete':
          // we don't have the deleted text, push a placeholder
          inverse.push({
            type: 'retain',
            count: op.length,
          });
          break;
        case 'retain':
          inverse.push(op);
          break;
      }
    }

    return inverse;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get undoSize(): number {
    return this.undoStack.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }
}
