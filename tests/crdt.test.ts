import { describe, it, expect } from "vitest";
import { LWWRegister, GCounter, PNCounter, ORSet, RGA } from "../src/CRDT";

describe("LWWRegister", () => {
  it("stores and retrieves a value", () => {
    const reg = new LWWRegister("hello");
    expect(reg.get()).toBe("hello");
  });
  it("updates with higher timestamp", () => {
    const reg = new LWWRegister("a");
    reg.set("b", Date.now() + 1000);
    expect(reg.get()).toBe("b");
  });
});

describe("GCounter", () => {
  it("increments and returns value", () => {
    const c = new GCounter("node1");
    c.increment(3);
    expect(c.value()).toBe(3);
  });
  it("merges counters", () => {
    const a = new GCounter("a");
    const b = new GCounter("b");
    a.increment(3);
    b.increment(7);
    a.merge(b);
    expect(a.value()).toBe(10);
  });
});

describe("PNCounter", () => {
  it("supports increment and decrement", () => {
    const c = new PNCounter("node1");
    c.increment(10);
    c.decrement(3);
    expect(c.value()).toBe(7);
  });
});

describe("ORSet", () => {
  it("adds and removes elements", () => {
    const s = new ORSet<string>();
    s.add("x");
    expect(s.has("x")).toBe(true);
    s.remove("x");
    expect(s.has("x")).toBe(false);
  });
});

describe("RGA", () => {
  it("inserts characters and returns text", () => {
    const rga = new RGA("c1");
    rga.insert(0, "H");
    rga.insert(1, "i");
    expect(rga.getText()).toBe("Hi");
  });
});
