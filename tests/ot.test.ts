import { describe, it, expect } from "vitest";
import { OTEngine } from "../src/OT";
import { InsertOp, DeleteOp, Operation } from "../src/types";

describe("OTEngine", () => {
  describe("transform insert-insert", () => {
    it("shifts second insert when first is before it", () => {
      const engine = new OTEngine("c1");
      const op1: InsertOp = { type: "insert", position: 2, content: "abc", clientId: "c1", timestamp: 1 };
      const op2: InsertOp = { type: "insert", position: 5, content: "x", clientId: "c2", timestamp: 2 };

      const [t1, t2] = engine.transform(op1, op2);
      expect(t1).toEqual(op1);
      expect((t2 as InsertOp).position).toBe(8); // 5 + 3
    });

    it("breaks tie by clientId when positions are equal", () => {
      const engine = new OTEngine("c1");
      const op1: InsertOp = { type: "insert", position: 3, content: "a", clientId: "a-first", timestamp: 1 };
      const op2: InsertOp = { type: "insert", position: 3, content: "b", clientId: "b-second", timestamp: 1 };

      const [t1, t2] = engine.transform(op1, op2);
      // "a-first" < "b-second", so op1 keeps position, op2 shifts
      expect((t1 as InsertOp).position).toBe(3);
      expect((t2 as InsertOp).position).toBe(4);
    });
  });

  describe("transform insert-delete", () => {
    it("adjusts insert position when delete is before", () => {
      const engine = new OTEngine("c1");
      const ins: InsertOp = { type: "insert", position: 10, content: "x", clientId: "c1", timestamp: 1 };
      const del: DeleteOp = { type: "delete", position: 3, length: 4, clientId: "c2", timestamp: 1 };

      const [tIns, tDel] = engine.transform(ins, del);
      expect((tIns as InsertOp).position).toBe(6); // 10 - 4
    });

    it("handles insert within deleted range", () => {
      const engine = new OTEngine("c1");
      const ins: InsertOp = { type: "insert", position: 5, content: "x", clientId: "c1", timestamp: 1 };
      const del: DeleteOp = { type: "delete", position: 3, length: 5, clientId: "c2", timestamp: 1 };

      const [tIns] = engine.transform(ins, del);
      expect((tIns as InsertOp).position).toBe(3);
    });

    it("does not adjust insert before delete", () => {
      const engine = new OTEngine("c1");
      const ins: InsertOp = { type: "insert", position: 1, content: "x", clientId: "c1", timestamp: 1 };
      const del: DeleteOp = { type: "delete", position: 5, length: 3, clientId: "c2", timestamp: 1 };

      const [tIns] = engine.transform(ins, del);
      expect((tIns as InsertOp).position).toBe(1);
    });
  });

  describe("transform delete-delete", () => {
    it("handles non-overlapping deletes", () => {
      const engine = new OTEngine("c1");
      const d1: DeleteOp = { type: "delete", position: 1, length: 2, clientId: "c1", timestamp: 1 };
      const d2: DeleteOp = { type: "delete", position: 5, length: 3, clientId: "c2", timestamp: 1 };

      const [t1, t2] = engine.transform(d1, d2);
      expect((t1 as DeleteOp).position).toBe(1);
      expect((t2 as DeleteOp).position).toBe(3); // 5 - 2
    });

    it("handles overlapping deletes by reducing length", () => {
      const engine = new OTEngine("c1");
      const d1: DeleteOp = { type: "delete", position: 2, length: 5, clientId: "c1", timestamp: 1 };
      const d2: DeleteOp = { type: "delete", position: 4, length: 5, clientId: "c2", timestamp: 1 };

      const [t1, t2] = engine.transform(d1, d2);
      // overlap is [4, 7), length 3
      expect((t1 as DeleteOp).length).toBe(2); // 5 - 3
      expect((t2 as DeleteOp).length).toBe(2); // 5 - 3
    });
  });

  describe("compose", () => {
    it("merges adjacent inserts from same client", () => {
      const engine = new OTEngine("c1");
      const ops: InsertOp[] = [
        { type: "insert", position: 0, content: "he", clientId: "c1", timestamp: 1 },
        { type: "insert", position: 2, content: "llo", clientId: "c1", timestamp: 2 },
      ];

      const composed = engine.compose(ops);
      expect(composed).toHaveLength(1);
      expect((composed[0] as InsertOp).content).toBe("hello");
    });

    it("merges adjacent deletes from same client", () => {
      const engine = new OTEngine("c1");
      const ops: DeleteOp[] = [
        { type: "delete", position: 5, length: 2, clientId: "c1", timestamp: 1 },
        { type: "delete", position: 5, length: 3, clientId: "c1", timestamp: 2 },
      ];

      const composed = engine.compose(ops);
      expect(composed).toHaveLength(1);
      expect((composed[0] as DeleteOp).length).toBe(5);
    });

    it("does not merge non-adjacent operations", () => {
      const engine = new OTEngine("c1");
      const ops: InsertOp[] = [
        { type: "insert", position: 0, content: "a", clientId: "c1", timestamp: 1 },
        { type: "insert", position: 5, content: "b", clientId: "c1", timestamp: 2 },
      ];

      const composed = engine.compose(ops);
      expect(composed).toHaveLength(2);
    });

    it("returns single op unchanged", () => {
      const engine = new OTEngine("c1");
      const ops: InsertOp[] = [
        { type: "insert", position: 0, content: "x", clientId: "c1", timestamp: 1 },
      ];
      expect(engine.compose(ops)).toHaveLength(1);
    });
  });

  describe("bufferLocalChange", () => {
    it("creates a change with correct metadata", () => {
      const engine = new OTEngine("client-1");
      const ops: InsertOp[] = [
        { type: "insert", position: 0, content: "hi", clientId: "client-1", timestamp: Date.now() },
      ];

      const change = engine.bufferLocalChange(ops);
      expect(change.clientId).toBe("client-1");
      expect(change.operations).toHaveLength(1);
      expect(change.parentVersion).toBe(0);
      expect(engine.getPendingCount()).toBe(1);
    });
  });

  describe("acknowledge", () => {
    it("removes buffered change on ack", () => {
      const engine = new OTEngine("c1");
      const change = engine.bufferLocalChange([
        { type: "insert", position: 0, content: "x", clientId: "c1", timestamp: 1 },
      ]);

      engine.acknowledge(change.id, 1);
      expect(engine.getPendingCount()).toBe(0);
      expect(engine.getAcknowledgedVersion()).toBe(1);
    });
  });

  describe("retain operations", () => {
    it("passes through retain ops in transform", () => {
      const engine = new OTEngine("c1");
      const retain = { type: "retain" as const, count: 5 };
      const ins: InsertOp = { type: "insert", position: 0, content: "a", clientId: "c1", timestamp: 1 };

      const [t1, t2] = engine.transform(retain, ins);
      expect(t1.type).toBe("retain");
      expect(t2.type).toBe("insert");
    });
  });
});
