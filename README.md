# collab-engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Real-time collaboration engine** with CRDT and Operational Transformation support. Build collaborative editing features like Google Docs, Figma, or Notion.

## Features

- **CRDT data structures** - LWW-Register, G-Counter, PN-Counter, OR-Set, RGA
- **Operational Transformation** - Transform concurrent operations for convergence
- **Collaborative documents** - Insert, delete, replace with conflict resolution
- **Presence tracking** - Cursors, selections, user colors, heartbeat timeout
- **Sync protocol** - Handshake, state sync, delta sync, offline queue, reconnection
- **Server authority** - Room management, broadcast, conflict resolution, snapshots

## Quick Start

```bash
npm install collab-engine
```

### Server Setup

```typescript
import { CollabServer } from 'collab-engine';

const server = new CollabServer({ snapshotInterval: 50 });

// Create a collaboration room
server.createRoom({
  id: 'doc-123',
  maxUsers: 10,
  heartbeatTimeout: 30000,
  conflictResolution: 'server-wins',
}, 'Hello, world!');

// When a client connects (e.g., via WebSocket)
server.joinRoom('doc-123', 'user-1', 'Alice', (msg) => {
  ws.send(JSON.stringify(msg));
});

// Handle incoming messages
ws.on('message', (data) => {
  server.handleMessage(JSON.parse(data));
});
```

### Client Setup

```typescript
import { Document, OTEngine, SyncProtocol } from 'collab-engine';

const doc = new Document('doc-123');
const ot = new OTEngine('user-1');
const sync = new SyncProtocol(doc, 'user-1', 'doc-123',
  (msg) => ws.send(JSON.stringify(msg)),
  (change) => {
    // Apply remote change to editor
    const ops = ot.receiveRemoteChange(change);
    doc.applyOperations(ops, change.clientId);
  },
);

sync.handshake();
```

### Using CRDTs Directly

```typescript
import { LWWRegister, GCounter, PNCounter, ORSet, RGA } from 'collab-engine';

// Last-Writer-Wins Register
const title = new LWWRegister('Untitled');
title.set('My Document');

// Grow-only Counter (e.g., view count)
const views = new GCounter('node-1');
views.increment(1);

// Positive-Negative Counter (e.g., votes)
const votes = new PNCounter('node-1');
votes.increment(); // upvote
votes.decrement(); // downvote

// Observed-Remove Set (e.g., tags)
const tags = new ORSet<string>();
tags.add('typescript');
tags.add('crdt');
tags.remove('crdt');

// RGA for text editing
const text = new RGA('user-1');
text.insert(0, 'H');
text.insert(1, 'i');
console.log(text.getText()); // "Hi"
```

## Architecture

```
                    +------------------+
                    |  CollabServer    |
                    |  - rooms         |
                    |  - broadcast     |
                    |  - OT transform  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+       +-----------v---------+
    |  SyncProtocol     |       |  SyncProtocol       |
    |  Client A         |       |  Client B           |
    |  - offline queue  |       |  - offline queue    |
    |  - pending buffer |       |  - pending buffer   |
    +---------+---------+       +-----------+---------+
              |                             |
    +---------v---------+       +-----------v---------+
    |  Document + OT    |       |  Document + OT      |
    |  - operations     |       |  - operations       |
    |  - history        |       |  - history          |
    +-------------------+       +---------------------+
```

## CRDT vs OT

| Feature | CRDT | OT |
|---------|------|----|
| Server required | No (peer-to-peer) | Yes (central authority) |
| Conflict resolution | Automatic (mathematical) | Transform operations |
| Memory overhead | Higher (metadata) | Lower |
| Best for | Offline-first, P2P | Real-time, server-based |

This library supports **both approaches**. Use CRDTs for data structures that need peer-to-peer sync, and OT for text editing with a central server.

## API Reference

### Document
- `insert(position, text, clientId)` - Insert text
- `delete(position, length, clientId)` - Delete text
- `replace(position, length, text, clientId)` - Replace text
- `snapshot()` / `restoreFromSnapshot(snapshot)` - Persistence
- `getHistory(since?)` - Get change history

### OTEngine
- `transform(op1, op2)` - Transform concurrent operations
- `compose(ops)` - Merge sequential operations
- `bufferLocalChange(ops)` - Buffer local changes
- `receiveRemoteChange(change)` - Transform and apply remote change
- `serverTransform(incoming, concurrent)` - Server-side transformation

### CollabServer
- `createRoom(config, content?)` - Create a collaboration room
- `joinRoom(roomId, clientId, name, send)` - Add a client
- `leaveRoom(roomId, clientId)` - Remove a client
- `handleMessage(msg)` - Process sync messages

## License

MIT

## Protocol

Uses a custom binary sync protocol over WebSocket for minimal overhead.
