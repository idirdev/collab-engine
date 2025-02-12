import { SyncMessage, Change, Snapshot, VersionVector } from './types.js';
import { Document } from './Document.js';

type MessageHandler = (msg: SyncMessage) => void;

interface SyncState {
  connected: boolean;
  serverVersion: number;
  localVersion: number;
  pendingChanges: Change[];
  offlineQueue: Change[];
}

export class SyncProtocol {
  private state: SyncState;
  private document: Document;
  private clientId: string;
  private roomId: string;
  private send: MessageHandler;
  private onRemoteChange?: (change: Change) => void;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;

  constructor(
    document: Document,
    clientId: string,
    roomId: string,
    send: MessageHandler,
    onRemoteChange?: (change: Change) => void,
  ) {
    this.document = document;
    this.clientId = clientId;
    this.roomId = roomId;
    this.send = send;
    this.onRemoteChange = onRemoteChange;
    this.state = {
      connected: false,
      serverVersion: 0,
      localVersion: 0,
      pendingChanges: [],
      offlineQueue: [],
    };
  }

  handshake(): void {
    this.send({
      type: 'handshake',
      roomId: this.roomId,
      clientId: this.clientId,
      payload: {
        documentId: this.document.id,
        version: this.document.version,
        versionVector: this.document.versionVector,
      },
      timestamp: Date.now(),
    });
  }

  receiveMessage(msg: SyncMessage): void {
    switch (msg.type) {
      case 'handshake':
        this.handleHandshake(msg);
        break;
      case 'state-sync':
        this.handleStateSync(msg);
        break;
      case 'delta':
        this.handleDelta(msg);
        break;
      case 'ack':
        this.handleAck(msg);
        break;
      case 'error':
        this.handleError(msg);
        break;
    }
  }

  private handleHandshake(msg: SyncMessage): void {
    const payload = msg.payload as { version: number; accepted: boolean };
    this.state.connected = true;
    this.state.serverVersion = payload.version;
    this.reconnectAttempts = 0;

    // If server is ahead, request full state sync
    if (payload.version > this.document.version) {
      this.send({
        type: 'state-sync',
        roomId: this.roomId,
        clientId: this.clientId,
        payload: { requestFull: true, since: this.document.version },
        version: this.document.version,
        timestamp: Date.now(),
      });
    }

    // Flush offline queue
    this.flushOfflineQueue();
  }

  private handleStateSync(msg: SyncMessage): void {
    const snapshot = msg.payload as Snapshot;
    this.document.restoreFromSnapshot(snapshot);
    this.state.serverVersion = snapshot.version;
    this.state.localVersion = snapshot.version;
  }

  private handleDelta(msg: SyncMessage): void {
    const change = msg.payload as Change;
    if (change.clientId === this.clientId) return; // Skip own echoes

    this.state.serverVersion = change.resultVersion;
    this.onRemoteChange?.(change);
  }

  private handleAck(msg: SyncMessage): void {
    const payload = msg.payload as { changeId: string; version: number };
    this.state.pendingChanges = this.state.pendingChanges.filter(
      (c) => c.id !== payload.changeId,
    );
    this.state.serverVersion = payload.version;
  }

  private handleError(msg: SyncMessage): void {
    const error = msg.payload as { code: string; message: string };
    console.error(`[Sync] Error from server: ${error.code} - ${error.message}`);

    if (error.code === 'VERSION_MISMATCH') {
      // Request full state resync
      this.send({
        type: 'state-sync',
        roomId: this.roomId,
        clientId: this.clientId,
        payload: { requestFull: true, since: 0 },
        timestamp: Date.now(),
      });
    }
  }

  sendChange(change: Change): void {
    if (!this.state.connected) {
      this.state.offlineQueue.push(change);
      return;
    }

    this.state.pendingChanges.push(change);
    this.send({
      type: 'delta',
      roomId: this.roomId,
      clientId: this.clientId,
      payload: change,
      version: change.resultVersion,
      timestamp: Date.now(),
    });
  }

  private flushOfflineQueue(): void {
    const queue = [...this.state.offlineQueue];
    this.state.offlineQueue = [];
    for (const change of queue) {
      this.sendChange(change);
    }
  }

  onDisconnect(): void {
    this.state.connected = false;
    // Move pending to offline queue
    this.state.offlineQueue.push(...this.state.pendingChanges);
    this.state.pendingChanges = [];
  }

  attemptReconnect(): boolean {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return false;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    setTimeout(() => this.handshake(), Math.min(delay, 30000));
    return true;
  }

  isConnected(): boolean { return this.state.connected; }
  getPendingCount(): number { return this.state.pendingChanges.length; }
  getOfflineCount(): number { return this.state.offlineQueue.length; }
  getServerVersion(): number { return this.state.serverVersion; }
}
