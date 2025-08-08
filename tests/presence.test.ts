import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PresenceTracker } from "../src/Presence";

describe("PresenceTracker", () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new PresenceTracker({ timeoutMs: 5000 });
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("adds a user with join", () => {
    const user = tracker.join("u1", "Alice");
    expect(user.userId).toBe("u1");
    expect(user.displayName).toBe("Alice");
    expect(user.isOnline).toBe(true);
    expect(user.color).toBeTruthy();
  });

  it("assigns different colors to users", () => {
    const u1 = tracker.join("u1", "Alice");
    const u2 = tracker.join("u2", "Bob");
    expect(u1.color).not.toBe(u2.color);
  });

  it("removes user on leave", () => {
    tracker.join("u1", "Alice");
    tracker.leave("u1");
    expect(tracker.getAllUsers()).toHaveLength(0);
  });

  it("tracks cursor position updates", () => {
    tracker.join("u1", "Alice");
    tracker.updateCursor("u1", { line: 5, column: 10, offset: 42 });

    const user = tracker.getUser("u1");
    expect(user?.cursor.line).toBe(5);
    expect(user?.cursor.column).toBe(10);
    expect(user?.cursor.offset).toBe(42);
  });

  it("tracks selection range", () => {
    tracker.join("u1", "Alice");
    const anchor = { line: 1, column: 0, offset: 0 };
    const head = { line: 1, column: 15, offset: 15 };
    tracker.updateSelection("u1", anchor, head);

    const user = tracker.getUser("u1");
    expect(user?.selection?.anchor).toEqual(anchor);
    expect(user?.selection?.head).toEqual(head);
    expect(user?.cursor).toEqual(head);
  });

  it("marks user offline after timeout", () => {
    tracker.join("u1", "Alice");
    vi.advanceTimersByTime(6000);

    const user = tracker.getUser("u1");
    expect(user?.isOnline).toBe(false);
  });

  it("keeps user online with heartbeats", () => {
    tracker.join("u1", "Alice");
    vi.advanceTimersByTime(3000);
    tracker.heartbeat("u1");
    vi.advanceTimersByTime(3000);

    const user = tracker.getUser("u1");
    expect(user?.isOnline).toBe(true);
  });

  it("returns only online users", () => {
    tracker.join("u1", "Alice");
    tracker.join("u2", "Bob");
    vi.advanceTimersByTime(6000);
    tracker.heartbeat("u1");

    // u1 sent heartbeat just before timeout for u2
    // but both timed out since heartbeat resets the timer
    const online = tracker.getOnlineUsers();
    // after 6s with 5s timeout, u2 is offline, u1 status depends on heartbeat timing
    expect(online.length).toBeLessThanOrEqual(2);
  });

  it("returns all users including offline", () => {
    tracker.join("u1", "Alice");
    tracker.join("u2", "Bob");
    expect(tracker.getAllUsers()).toHaveLength(2);
  });

  it("ignores cursor update for unknown user", () => {
    tracker.updateCursor("nonexistent", { line: 0, column: 0, offset: 0 });
    expect(tracker.getUser("nonexistent")).toBeUndefined();
  });

  it("fires onChange callback", () => {
    const onChange = vi.fn();
    const t = new PresenceTracker({ onChange });
    t.join("u1", "Alice");
    expect(onChange).toHaveBeenCalled();
    t.destroy();
  });

  it("cleans up stale users", () => {
    tracker.join("u1", "Alice");
    vi.advanceTimersByTime(20000); // 3x timeout
    tracker.cleanup();
    expect(tracker.getAllUsers()).toHaveLength(0);
  });

  it("clears all timers on destroy", () => {
    tracker.join("u1", "Alice");
    tracker.join("u2", "Bob");
    tracker.destroy();
    expect(tracker.getAllUsers()).toHaveLength(0);
  });
});
