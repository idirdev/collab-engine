import { describe, it, expect } from "vitest";
import { LWWRegister, GCounter, PNCounter, ORSet, RGA } from "../src/CRDT";

describe("LWWRegister", () => {
  it("stores and retrieves", () => {
    const r = new LWWRegister("a");
    expect(r.get()).toBe("a");
    r.set("b");
    expect(r.get()).toBe("b");
  });
});

describe("GCounter", () => {
  it("increments", () => {
    const c = new GCounter("n1");
    c.increment(5);
    c.increment(3);
    expect(c.value()).toBe(8);
  });
  it("merges", () => {
    const a = new GCounter("n1");
    const b = new GCounter("n2");
    a.increment(3);
    b.increment(7);
    a.merge(b.state());
    expect(a.value()).toBe(10);
  });
});

describe("PNCounter", () => {
  it("increments and decrements", () => {
    const c = new PNCounter("n1");
    c.increment(10);
    c.decrement(3);
    expect(c.value()).toBe(7);
  });
});

describe("ORSet", () => {
  it("adds and removes", () => {
    const s = new ORSet<string>();
    s.add("a");
    s.add("b");
    expect(s.has("a")).toBe(true);
    s.remove("a");
    expect(s.has("a")).toBe(false);
    expect(s.has("b")).toBe(true);
  });
});

describe("RGA", () => {
  it("inserts and reads text", () => {
    const r = new RGA("u1");
    r.insert(0, "H");
    r.insert(1, "i");
    expect(r.getText()).toBe("Hi");
  });
  it("deletes characters", () => {
    const r = new RGA("u1");
    r.insert(0, "A");
    r.insert(1, "B");
    r.insert(2, "C");
    r.delete(1);
    expect(r.getText()).toBe("AC");
  });
});
