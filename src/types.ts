export interface InsertOp {
  type: 'insert';
  position: number;
  content: string;
  clientId: string;
  timestamp: number;
}

export interface DeleteOp {
  type: 'delete';
  position: number;
  length: number;
  clientId: string;
  timestamp: number;
}

export interface RetainOp {
  type: 'retain';
  count: number;
}

export type Operation = InsertOp | DeleteOp | RetainOp;

export interface DocumentState {
  id: string;
  content: string;
  version: number;
  versionVector: VersionVector;
  history: Change[];
  createdAt: number;
  updatedAt: number;
}

export interface CursorPosition {
  line: number;
  column: number;
  offset: number;
}

export interface UserPresence {
  userId: string;
  displayName: string;
  color: string;
  cursor: CursorPosition;
  selection?: { anchor: CursorPosition; head: CursorPosition };
  lastActive: number;
  isOnline: boolean;
}

export interface Change {
  id: string;
  operations: Operation[];
  clientId: string;
  parentVersion: number;
  resultVersion: number;
  timestamp: number;
}

export interface Snapshot {
  documentId: string;
  content: string;
  version: number;
  versionVector: VersionVector;
  timestamp: number;
}

export type VersionVector = Record<string, number>;

export type CRDTValue = string | number | boolean | null | CRDTValue[] | { [key: string]: CRDTValue };

export interface RoomConfig {
  id: string;
  maxUsers?: number;
  snapshotInterval?: number;
  heartbeatTimeout?: number;
  conflictResolution?: 'server-wins' | 'last-write-wins' | 'merge';
}

export type SyncMessageType = 'handshake' | 'state-sync' | 'delta' | 'ack' | 'presence' | 'error';

export interface SyncMessage {
  type: SyncMessageType;
  roomId: string;
  clientId: string;
  payload: unknown;
  version?: number;
  timestamp: number;
}
