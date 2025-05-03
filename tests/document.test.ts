import { describe, it, expect } from "vitest";
import { Document } from "../src/Document";

describe("Document", () => {
  it("creates with content", () => {
    const d = new Document("d1", "Hello");
    expect(d.getContent()).toBe("Hello");
  });
  it("inserts text", () => {
    const d = new Document("d1", "Hello");
    d.insert(5, " World", "u1");
    expect(d.getContent()).toBe("Hello World");
  });
  it("deletes text", () => {
    const d = new Document("d1", "Hello World");
    d.delete(5, 6, "u1");
    expect(d.getContent()).toBe("Hello");
  });
  it("replaces text", () => {
    const d = new Document("d1", "Hello World");
    d.replace(6, 5, "Earth", "u1");
    expect(d.getContent()).toBe("Hello Earth");
  });
  it("tracks history", () => {
    const d = new Document("d1", "");
    d.insert(0, "test", "u1");
    expect(d.getHistory().length).toBeGreaterThan(0);
  });
  it("snapshots and restores", () => {
    const d = new Document("d1", "original");
    const snap = d.snapshot();
    d.insert(0, "X", "u1");
    d.restoreFromSnapshot(snap);
    expect(d.getContent()).toBe("original");
  });
});
