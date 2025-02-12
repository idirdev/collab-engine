import { v4 as uuid } from 'uuid';
import { Document } from './Document.js';
import { PresenceTracker } from './Presence.js';
import { OTEngine } from './OT.js';
import { RoomConfig, SyncMessage, Change, Snapshot, UserPresence } from './types.js';

interface Room {
  config: RoomConfig;
  document: Document;
  presence: PresenceTracker;
  otEngine: OTEngine;
  clients: Map<string, { send: (msg: SyncMessage) => void; displayName: string }>;
  snapshots: Snapshot[];
}

export class CollabServer {
  private rooms: Map<string, Room> = new Map();
  private snapshotInterval: number;

  constructor(options?: { snapshotInterval?: number }) {
    this.snapshotInterval = options?.snapshotInterval ?? 50;
  }

  createRoom(config: RoomConfig, initialContent?: string): string {
    const document = new Document(config.id, initialContent ?? '');
    const presence = new PresenceTracker({ timeoutMs: config.heartbeatTimeout ?? 30000 });
    const otEngine = new OTEngine(`server-${config.id}`);

    this.rooms.set(config.id, {
      config,
      document,
      presence,
      otEngine,
      clients: new Map(),
      snapshots: [document.snapshot()],
    });

    return config.id;
  }

  joinRoom(
    roomId: string,
    clientId: string,
    displayName: string,
    send: (msg: SyncMessage) => void,
  ): void {
    const room = this.getRoom(roomId);

    if (room.config.maxUsers && room.clients.size >= room.config.maxUsers) {
      send({ type: 'error', roomId, clientId, payload: { code: 'ROOM_FULL', message: 'Room is full' }, timestamp: Date.now() });
      return;
    }

    room.clients.set(clientId, { send, displayName });
    room.presence.join(clientId, displayName);

    // Send handshake with current state
    send({
      type: 'handshake',
      roomId,
      clientId,
      payload: { version: room.document.version, accepted: true },
      timestamp: Date.now(),
    });

    // Send full state
    send({
      type: 'state-sync',
      roomId,
      clientId,
      payload: room.document.snapshot(),
      timestamp: Date.now(),
    });

    // Broadcast presence update
    this.broadcastPresence(roomId);
  }

  leaveRoom(roomId: string, clientId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(clientId);
    room.presence.leave(clientId);
    this.broadcastPresence(roomId);

    // Clean up empty rooms
    if (room.clients.size === 0) {
      room.presence.destroy();
    }
  }

  handleMessage(msg: SyncMessage): void {
    const room = this.rooms.get(msg.roomId);
    if (!room) return;

    switch (msg.type) {
      case 'delta':
        this.handleDelta(room, msg);
        break;
      case 'presence':
        this.handlePresence(room, msg);
        break;
      case 'state-sync':
        this.handleStateSyncRequest(room, msg);
        break;
    }
  }

  private handleDelta(room: Room, msg: SyncMessage): void {
    const incomingChange = msg.payload as Change;
    const concurrentChanges = room.document.getHistory(incomingChange.parentVersion);
    const transformedOps = room.otEngine.serverTransform(incomingChange, concurrentChanges);

    const appliedChange = room.document.applyOperations(transformedOps, msg.clientId);

    // ACK to sender
    const senderClient = room.clients.get(msg.clientId);
    senderClient?.send({
      type: 'ack',
      roomId: msg.roomId,
      clientId: msg.clientId,
      payload: { changeId: incomingChange.id, version: appliedChange.resultVersion },
      timestamp: Date.now(),
    });

    // Broadcast to others
    for (const [clientId, client] of room.clients) {
      if (clientId === msg.clientId) continue;
      client.send({
        type: 'delta',
        roomId: msg.roomId,
        clientId: msg.clientId,
        payload: appliedChange,
        version: appliedChange.resultVersion,
        timestamp: Date.now(),
      });
    }

    // Periodic snapshots
    if (room.document.version % this.snapshotInterval === 0) {
      room.snapshots.push(room.document.snapshot());
    }
  }

  private handlePresence(room: Room, msg: SyncMessage): void {
    const payload = msg.payload as { cursor?: { line: number; column: number; offset: number } };
    if (payload.cursor) {
      room.presence.updateCursor(msg.clientId, payload.cursor);
    }
    this.broadcastPresence(msg.roomId);
  }

  private handleStateSyncRequest(room: Room, msg: SyncMessage): void {
    const client = room.clients.get(msg.clientId);
    if (!client) return;

    client.send({
      type: 'state-sync',
      roomId: msg.roomId,
      clientId: msg.clientId,
      payload: room.document.snapshot(),
      timestamp: Date.now(),
    });
  }

  private broadcastPresence(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const users = room.presence.getAllUsers();
    for (const [clientId, client] of room.clients) {
      client.send({
        type: 'presence',
        roomId,
        clientId,
        payload: { users },
        timestamp: Date.now(),
      });
    }
  }

  private getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    return room;
  }

  getRoomDocument(roomId: string): Document { return this.getRoom(roomId).document; }
  getRoomUsers(roomId: string): UserPresence[] { return this.getRoom(roomId).presence.getAllUsers(); }
  getRoomCount(): number { return this.rooms.size; }
  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) { room.presence.destroy(); this.rooms.delete(roomId); }
  }
}
