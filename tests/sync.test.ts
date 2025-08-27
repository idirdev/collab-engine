import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncProtocol } from "../src/Sync";
import { Document } from "../src/Document";
import { SyncMessage, Change } from "../src/types";

describe("SyncProtocol", () => {
  let doc: Document;
  let sentMessages: SyncMessage[];
  let sendFn: (msg: SyncMessage) => void;

  beforeEach(() => {
    doc = new Document("doc-1", "hello");
    sentMessages = [];
    sendFn = (msg) => sentMessages.push(msg);
  });

  it("sends handshake on connect", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);
    sync.handshake();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe("handshake");
    expect(sentMessages[0].clientId).toBe("c1");
    expect(sentMessages[0].roomId).toBe("room-1");
  });

  it("handles handshake response and connects", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);
    expect(sync.isConnected()).toBe(false);

    sync.receiveMessage({
      type: "handshake",
      roomId: "room-1",
      clientId: "c1",
      payload: { version: 0, accepted: true },
      timestamp: Date.now(),
    });

    expect(sync.isConnected()).toBe(true);
  });

  it("queues changes while offline", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);
    const change: Change = {
      id: "ch-1",
      operations: [{ type: "insert", position: 5, content: " world", clientId: "c1", timestamp: Date.now() }],
      clientId: "c1",
      parentVersion: 0,
      resultVersion: 1,
      timestamp: Date.now(),
    };

    sync.sendChange(change);
    expect(sync.getOfflineCount()).toBe(1);
    expect(sentMessages).toHaveLength(0);
  });

  it("sends queued changes after connecting", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);
    const change: Change = {
      id: "ch-1",
      operations: [{ type: "insert", position: 5, content: "!", clientId: "c1", timestamp: Date.now() }],
      clientId: "c1",
      parentVersion: 0,
      resultVersion: 1,
      timestamp: Date.now(),
    };

    sync.sendChange(change);
    expect(sync.getOfflineCount()).toBe(1);

    // simulate handshake
    sync.receiveMessage({
      type: "handshake",
      roomId: "room-1",
      clientId: "c1",
      payload: { version: 0, accepted: true },
      timestamp: Date.now(),
    });

    expect(sync.getOfflineCount()).toBe(0);
    // handshake msg + the flushed change
    const deltaMessages = sentMessages.filter((m) => m.type === "delta");
    expect(deltaMessages).toHaveLength(1);
  });

  it("handles ack and removes pending change", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);

    // connect first
    sync.receiveMessage({
      type: "handshake",
      roomId: "room-1",
      clientId: "c1",
      payload: { version: 0, accepted: true },
      timestamp: Date.now(),
    });

    const change: Change = {
      id: "ch-1",
      operations: [{ type: "insert", position: 0, content: "x", clientId: "c1", timestamp: Date.now() }],
      clientId: "c1",
      parentVersion: 0,
      resultVersion: 1,
      timestamp: Date.now(),
    };

    sync.sendChange(change);
    expect(sync.getPendingCount()).toBe(1);

    sync.receiveMessage({
      type: "ack",
      roomId: "room-1",
      clientId: "c1",
      payload: { changeId: "ch-1", version: 1 },
      timestamp: Date.now(),
    });

    expect(sync.getPendingCount()).toBe(0);
    expect(sync.getServerVersion()).toBe(1);
  });

  it("restores document from state-sync", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);

    sync.receiveMessage({
      type: "state-sync",
      roomId: "room-1",
      clientId: "c1",
      payload: {
        documentId: "doc-1",
        content: "restored content",
        version: 5,
        versionVector: { c1: 3, c2: 2 },
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    expect(doc.content).toBe("restored content");
    expect(doc.version).toBe(5);
  });

  it("handles disconnect and moves pending to offline queue", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);

    sync.receiveMessage({
      type: "handshake",
      roomId: "room-1",
      clientId: "c1",
      payload: { version: 0, accepted: true },
      timestamp: Date.now(),
    });

    const change: Change = {
      id: "ch-1",
      operations: [{ type: "insert", position: 0, content: "a", clientId: "c1", timestamp: Date.now() }],
      clientId: "c1",
      parentVersion: 0,
      resultVersion: 1,
      timestamp: Date.now(),
    };

    sync.sendChange(change);
    sync.onDisconnect();

    expect(sync.isConnected()).toBe(false);
    expect(sync.getPendingCount()).toBe(0);
    expect(sync.getOfflineCount()).toBe(1);
  });

  it("skips remote changes from own client", () => {
    const onRemote = vi.fn();
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn, onRemote);

    sync.receiveMessage({
      type: "delta",
      roomId: "room-1",
      clientId: "c1",
      payload: {
        id: "ch-remote",
        operations: [{ type: "insert", position: 0, content: "echo", clientId: "c1", timestamp: Date.now() }],
        clientId: "c1",
        parentVersion: 0,
        resultVersion: 1,
        timestamp: Date.now(),
      } as Change,
      timestamp: Date.now(),
    });

    expect(onRemote).not.toHaveBeenCalled();
  });

  it("fires onRemoteChange for other clients", () => {
    const onRemote = vi.fn();
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn, onRemote);

    sync.receiveMessage({
      type: "delta",
      roomId: "room-1",
      clientId: "c2",
      payload: {
        id: "ch-remote",
        operations: [{ type: "insert", position: 0, content: "hi", clientId: "c2", timestamp: Date.now() }],
        clientId: "c2",
        parentVersion: 0,
        resultVersion: 1,
        timestamp: Date.now(),
      } as Change,
      timestamp: Date.now(),
    });

    expect(onRemote).toHaveBeenCalledTimes(1);
  });

  it("requests resync on version mismatch error", () => {
    const sync = new SyncProtocol(doc, "c1", "room-1", sendFn);

    sync.receiveMessage({
      type: "error",
      roomId: "room-1",
      clientId: "c1",
      payload: { code: "VERSION_MISMATCH", message: "Version mismatch" },
      timestamp: Date.now(),
    });

    const syncRequests = sentMessages.filter((m) => m.type === "state-sync");
    expect(syncRequests).toHaveLength(1);
  });
});
