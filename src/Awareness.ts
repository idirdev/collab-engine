import { v4 as uuid } from 'uuid';

export interface AwarenessState {
  clientId: string;
  user: { name: string; color: string; avatar?: string };
  cursor?: { anchor: number; head: number };
  selection?: { start: number; end: number };
  metadata: Record<string, unknown>;
  lastUpdated: number;
}

type AwarenessListener = (states: Map<string, AwarenessState>) => void;

/**
 * Manages user awareness across clients: who is online, where their
 * cursor is, what they are currently doing. Unlike PresenceTracker,
 * this is designed for arbitrary state that clients can broadcast.
 */
export class Awareness {
  private localClientId: string;
  private states: Map<string, AwarenessState> = new Map();
  private listeners: Set<AwarenessListener> = new Set();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private timeoutMs: number;

  constructor(clientId?: string, options?: { timeoutMs?: number }) {
    this.localClientId = clientId ?? uuid();
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  getLocalClientId(): string {
    return this.localClientId;
  }

  setLocalState(state: Omit<AwarenessState, 'clientId' | 'lastUpdated'>): void {
    const full: AwarenessState = {
      ...state,
      clientId: this.localClientId,
      lastUpdated: Date.now(),
    };
    this.states.set(this.localClientId, full);
    this.notify();
  }

  updateLocalField<K extends keyof AwarenessState>(key: K, value: AwarenessState[K]): void {
    const existing = this.states.get(this.localClientId);
    if (!existing) return;

    existing[key] = value;
    existing.lastUpdated = Date.now();
    this.notify();
  }

  applyRemoteState(clientId: string, state: AwarenessState): void {
    if (clientId === this.localClientId) return;

    const existing = this.states.get(clientId);
    if (existing && existing.lastUpdated > state.lastUpdated) return;

    this.states.set(clientId, { ...state, lastUpdated: Date.now() });
    this.notify();
  }

  removeClient(clientId: string): void {
    if (this.states.delete(clientId)) {
      this.notify();
    }
  }

  getState(clientId: string): AwarenessState | undefined {
    return this.states.get(clientId);
  }

  getStates(): Map<string, AwarenessState> {
    return new Map(this.states);
  }

  getActiveClients(): string[] {
    const now = Date.now();
    const active: string[] = [];
    for (const [id, state] of this.states) {
      if (now - state.lastUpdated < this.timeoutMs) {
        active.push(id);
      }
    }
    return active;
  }

  onChange(listener: AwarenessListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  startCleanup(intervalMs: number = 10_000): void {
    this.stopCleanup();
    this.cleanupInterval = setInterval(() => {
      this.removeStale();
    }, intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private removeStale(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, state] of this.states) {
      if (id === this.localClientId) continue;
      if (now - state.lastUpdated > this.timeoutMs) {
        this.states.delete(id);
        changed = true;
      }
    }

    if (changed) this.notify();
  }

  private notify(): void {
    const snapshot = new Map(this.states);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // listener errors should not propagate
      }
    }
  }

  destroy(): void {
    this.stopCleanup();
    this.states.clear();
    this.listeners.clear();
  }
}
