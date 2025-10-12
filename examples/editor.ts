import { Document } from '../src/Document.js';
import { CollabServer } from '../src/Server.js';
import { SyncProtocol } from '../src/Sync.js';
import { OTEngine } from '../src/OT.js';
import { EditHistory } from '../src/History.js';
import { SyncMessage, Change } from '../src/types.js';

/**
 * Basic collaborative editor setup showing how to wire together
 * the server, sync protocol, and edit history.
 */

// --- server side ---
const server = new CollabServer({ snapshotInterval: 25 });
const roomId = server.createRoom({ id: 'demo-room', maxUsers: 10 }, 'Hello, world!');

// --- simulate two clients connecting ---

function createClient(clientId: string, displayName: string) {
  const localDoc = new Document(roomId, '');
  const otEngine = new OTEngine(clientId);
  const history = new EditHistory(100);

  const messageBus: SyncMessage[] = [];

  const sendToServer = (msg: SyncMessage) => {
    messageBus.push(msg);
  };

  const sync = new SyncProtocol(localDoc, clientId, roomId, sendToServer, (change) => {
    // apply remote change to local doc
    const transformedOps = otEngine.receiveRemoteChange(change);
    localDoc.applyOperations(transformedOps, change.clientId);
  });

  server.joinRoom(roomId, clientId, displayName, (msg) => {
    sync.receiveMessage(msg);
  });

  return {
    doc: localDoc,
    sync,
    history,
    otEngine,
    type(position: number, text: string) {
      const change = localDoc.insert(position, text, clientId);
      history.push(change);

      const buffered = otEngine.bufferLocalChange(change.operations);
      sync.sendChange(buffered);

      // process messages to server
      for (const msg of messageBus.splice(0)) {
        server.handleMessage(msg);
      }
    },
    undo() {
      const ops = history.undo();
      if (!ops) return;
      const inversed = ops.filter((op) => op.type !== 'retain');
      if (inversed.length > 0) {
        localDoc.applyOperations(inversed, clientId);
      }
    },
    getContent() {
      return localDoc.content;
    },
  };
}

// example usage
const alice = createClient('alice-01', 'Alice');
const bob = createClient('bob-01', 'Bob');

console.log('Initial state:', server.getRoomDocument(roomId).content);

alice.type(13, ' Welcome to the editor!');
console.log('After Alice types:', alice.getContent());

bob.type(0, '[Bob] ');
console.log('After Bob types:', bob.getContent());

alice.undo();
console.log('After Alice undo:', alice.getContent());

console.log('\nServer document:', server.getRoomDocument(roomId).content);
console.log('Online users:', server.getRoomUsers(roomId).map((u) => u.displayName));
