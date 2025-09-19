import { describe, it, expect, beforeEach } from "vitest";
import { EditHistory } from "../src/History";
import { Change, InsertOp, DeleteOp } from "../src/types";

function makeInsertChange(id: string, position: number, content: string, clientId: string = "c1", ts?: number): Change {
  return {
    id,
    operations: [{ type: "insert", position, content, clientId, timestamp: ts ?? Date.now() }],
    clientId,
    parentVersion: 0,
    resultVersion: 1,
    timestamp: ts ?? Date.now(),
  };
}

function makeDeleteChange(id: string, position: number, length: number, clientId: string = "c1"): Change {
  return {
    id,
    operations: [{ type: "delete", position, length, clientId, timestamp: Date.now() }],
    clientId,
    parentVersion: 0,
    resultVersion: 1,
    timestamp: Date.now(),
  };
}

describe("EditHistory", () => {
  let history: EditHistory;

  beforeEach(() => {
    history = new EditHistory();
  });

  it("starts empty", () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undoSize).toBe(0);
  });

  it("allows undo after push", () => {
    history.push(makeInsertChange("ch1", 0, "hello"));
    expect(history.canUndo()).toBe(true);
    expect(history.undoSize).toBe(1);
  });

  it("returns inverse operations on undo", () => {
    history.push(makeInsertChange("ch1", 0, "hello"));
    const ops = history.undo();
    expect(ops).not.toBeNull();
    expect(ops![0].type).toBe("delete");
    expect((ops![0] as DeleteOp).length).toBe(5);
  });

  it("enables redo after undo", () => {
    history.push(makeInsertChange("ch1", 0, "test"));
    history.undo();
    expect(history.canRedo()).toBe(true);
    expect(history.redoSize).toBe(1);
  });

  it("redo returns original operations", () => {
    const change = makeInsertChange("ch1", 0, "test");
    history.push(change);
    history.undo();
    const ops = history.redo();
    expect(ops).not.toBeNull();
    expect((ops![0] as InsertOp).content).toBe("test");
  });

  it("clears redo stack on new edit", () => {
    history.push(makeInsertChange("ch1", 0, "first"));
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push(makeInsertChange("ch2", 0, "new"));
    expect(history.canRedo()).toBe(false);
  });

  it("handles multiple undo/redo cycles", () => {
    history.push(makeInsertChange("ch1", 0, "a"));
    history.push(makeInsertChange("ch2", 1, "b"));
    history.push(makeInsertChange("ch3", 2, "c"));

    expect(history.undoSize).toBe(3);

    history.undo();
    history.undo();
    expect(history.undoSize).toBe(1);
    expect(history.redoSize).toBe(2);

    history.redo();
    expect(history.undoSize).toBe(2);
    expect(history.redoSize).toBe(1);
  });

  it("respects max size limit", () => {
    const h = new EditHistory(3);
    for (let i = 0; i < 5; i++) {
      h.push(makeInsertChange(`ch${i}`, i, String.fromCharCode(65 + i)));
    }
    expect(h.undoSize).toBe(3);
  });

  it("returns null on undo when empty", () => {
    expect(history.undo()).toBeNull();
  });

  it("returns null on redo when empty", () => {
    expect(history.redo()).toBeNull();
  });

  it("compacts sequential inserts from same client", () => {
    const now = Date.now();
    history.push(makeInsertChange("ch1", 0, "h", "c1", now));
    history.push(makeInsertChange("ch2", 1, "e", "c1", now + 100));
    history.push(makeInsertChange("ch3", 2, "y", "c1", now + 200));

    const compacted = history.compact(500);
    expect(compacted).toBe(2);
    expect(history.undoSize).toBe(1);
  });

  it("does not compact edits from different clients", () => {
    const now = Date.now();
    history.push(makeInsertChange("ch1", 0, "a", "c1", now));
    history.push(makeInsertChange("ch2", 1, "b", "c2", now + 100));

    const compacted = history.compact(500);
    expect(compacted).toBe(0);
    expect(history.undoSize).toBe(2);
  });

  it("clears all history", () => {
    history.push(makeInsertChange("ch1", 0, "x"));
    history.undo();
    history.clear();
    expect(history.undoSize).toBe(0);
    expect(history.redoSize).toBe(0);
  });
});
