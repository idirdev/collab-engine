import { UserPresence, CursorPosition } from './types.js';

const PRESENCE_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];

export class PresenceTracker {
  private users: Map<string, UserPresence> = new Map();
  private heartbeatTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private timeoutMs: number;
  private colorIndex: number = 0;
  private onChange?: (users: UserPresence[]) => void;

  constructor(options?: { timeoutMs?: number; onChange?: (users: UserPresence[]) => void }) {
    this.timeoutMs = options?.timeoutMs ?? 30000;
    this.onChange = options?.onChange;
  }

  join(userId: string, displayName: string): UserPresence {
    const color = PRESENCE_COLORS[this.colorIndex % PRESENCE_COLORS.length];
    this.colorIndex++;

    const presence: UserPresence = {
      userId,
      displayName,
      color,
      cursor: { line: 0, column: 0, offset: 0 },
      lastActive: Date.now(),
      isOnline: true,
    };

    this.users.set(userId, presence);
    this.resetHeartbeat(userId);
    this.notifyChange();
    return presence;
  }

  leave(userId: string): void {
    this.users.delete(userId);
    const timer = this.heartbeatTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.heartbeatTimers.delete(userId);
    this.notifyChange();
  }

  updateCursor(userId: string, cursor: CursorPosition): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.cursor = cursor;
    user.lastActive = Date.now();
    this.resetHeartbeat(userId);
    this.notifyChange();
  }

  updateSelection(userId: string, anchor: CursorPosition, head: CursorPosition): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.selection = { anchor, head };
    user.cursor = head;
    user.lastActive = Date.now();
    this.resetHeartbeat(userId);
    this.notifyChange();
  }

  heartbeat(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.lastActive = Date.now();
    user.isOnline = true;
    this.resetHeartbeat(userId);
  }

  getUser(userId: string): UserPresence | undefined {
    return this.users.get(userId);
  }

  getOnlineUsers(): UserPresence[] {
    return Array.from(this.users.values()).filter((u) => u.isOnline);
  }

  getAllUsers(): UserPresence[] {
    return Array.from(this.users.values());
  }

  private resetHeartbeat(userId: string): void {
    const existing = this.heartbeatTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const user = this.users.get(userId);
      if (user) {
        user.isOnline = false;
        this.notifyChange();
      }
    }, this.timeoutMs);

    this.heartbeatTimers.set(userId, timer);
  }

  private notifyChange(): void {
    this.onChange?.(this.getAllUsers());
  }

  cleanup(): void {
    const now = Date.now();
    for (const [userId, user] of this.users) {
      if (now - user.lastActive > this.timeoutMs * 3) {
        this.leave(userId);
      }
    }
  }

  destroy(): void {
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer);
    }
    this.heartbeatTimers.clear();
    this.users.clear();
  }
}
