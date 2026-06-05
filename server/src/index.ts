import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type {
  ChatMessage,
  JoinRoomPayload,
  RoomData,
  SendMessagePayload,
  TypingPayload,
  VideoJoinPayload,
  VideoParticipant,
  WebRTCSignalPayload,
} from './types.js';

const PORT = process.env.PORT ?? 3001;
const ROOM_INACTIVITY_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // check every hour

// In-memory store — no database, no persistence.
// Key: roomId, Value: room state (users, messages, timestamps).
const rooms = new Map<string, RoomData>();

const app = express();
app.use(cors());
app.use(express.json());

// Health check for deployment / local dev.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const httpServer = createServer(app);

const MAX_IMAGE_BYTES = 600_000; // ~600 KB base64 payload limit per photo

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e7, // allow compressed image payloads
});

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function touchRoom(room: RoomData): void {
  room.lastActivityAt = Date.now();
}

function getOrCreateRoom(roomId: string): RoomData {
  let room = rooms.get(roomId);
  if (!room) {
    const now = Date.now();
    room = {
      id: roomId,
      users: new Map(),
      videoUsers: new Map(),
      messages: [],
      createdAt: now,
      lastActivityAt: now,
    };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastUserCount(roomId: string, room: RoomData): void {
  io.to(roomId).emit('user-count', room.users.size);
}

function leaveVideoCall(socketId: string, roomId: string): void {
  const room = rooms.get(roomId);
  if (!room?.videoUsers.has(socketId)) return;

  room.videoUsers.delete(socketId);
  touchRoom(room);
  io.to(roomId).emit('video-user-left', { socketId });
}

function removeUserFromRoom(socketId: string, roomId: string): string | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const user = room.users.get(socketId);
  if (!user) return null;

  leaveVideoCall(socketId, roomId);
  room.users.delete(socketId);
  touchRoom(room);

  // Socket.IO room: when the last user leaves, delete the in-memory room.
  if (room.users.size === 0) {
    rooms.delete(roomId);
    return user.username;
  }

  broadcastUserCount(roomId, room);
  return user.username;
}

// Expire rooms inactive for 24+ hours.
function cleanupInactiveRooms(): void {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivityAt >= ROOM_INACTIVITY_MS) {
      io.to(roomId).emit('room-expired', {
        message: 'This room expired after 24 hours of inactivity.',
      });
      for (const [socketId] of room.users) {
        const socket = io.sockets.sockets.get(socketId);
        socket?.leave(roomId);
        socket?.disconnect(true);
      }
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupInactiveRooms, CLEANUP_INTERVAL_MS);

io.on('connection', (socket) => {
  // Track which Socket.IO room this socket belongs to (one room per connection).
  let currentRoomId: string | null = null;

  /**
   * join-room: client enters a chat room.
   *
   * Socket.IO "rooms" are server-side channels identified by roomId.
   * socket.join(roomId) subscribes this connection to broadcasts for that room.
   * io.to(roomId).emit(...) reaches every socket in that room only.
   */
  socket.on('join-room', (payload: JoinRoomPayload, callback?: (result: { ok: boolean; error?: string }) => void) => {
    const { roomId, username } = payload;
    const trimmedName = username?.trim();

    if (!roomId || !trimmedName) {
      callback?.({ ok: false, error: 'Room ID and username are required.' });
      return;
    }

    if (currentRoomId) {
      socket.leave(currentRoomId);
      removeUserFromRoom(socket.id, currentRoomId);
    }

    const room = getOrCreateRoom(roomId);
    touchRoom(room);

    room.users.set(socket.id, { socketId: socket.id, username: trimmedName });
    currentRoomId = roomId;

    // Join the Socket.IO room channel — required for targeted broadcasts.
    socket.join(roomId);

    socket.to(roomId).emit('user-joined', { username: trimmedName });
    broadcastUserCount(roomId, room);

    socket.emit('room-state', {
      messages: room.messages,
      userCount: room.users.size,
    });

    callback?.({ ok: true });
  });

  socket.on('send-message', (payload: SendMessagePayload) => {
    const { roomId, type = 'text', content, imageData } = payload;
    if (!roomId || !currentRoomId || currentRoomId !== roomId) return;

    const room = rooms.get(roomId);
    const user = room?.users.get(socket.id);
    if (!room || !user) return;

    let message: ChatMessage | null = null;

    if (type === 'text') {
      const trimmed = content?.trim();
      if (!trimmed) return;
      message = {
        id: generateMessageId(),
        username: user.username,
        type: 'text',
        content: trimmed,
        timestamp: Date.now(),
      };
    } else if (type === 'image') {
      if (!imageData?.startsWith('data:image/')) return;
      if (imageData.length > MAX_IMAGE_BYTES) return;
      message = {
        id: generateMessageId(),
        username: user.username,
        type: 'image',
        content: content?.trim() ?? '',
        imageData,
        timestamp: Date.now(),
      };
    }

    if (!message) return;

    room.messages.push(message);
    touchRoom(room);

    // Broadcast to everyone in the Socket.IO room, including sender.
    io.to(roomId).emit('new-message', message);
  });

  socket.on('typing', (payload: TypingPayload) => {
    const { roomId, username } = payload;
    if (!roomId || !username || currentRoomId !== roomId) return;
    socket.to(roomId).emit('user-typing', { username });
  });

  socket.on('stop-typing', (payload: TypingPayload) => {
    const { roomId, username } = payload;
    if (!roomId || !username || currentRoomId !== roomId) return;
    socket.to(roomId).emit('user-stop-typing', { username });
  });

  /**
   * WebRTC signaling: the server only relays SDP offers/answers and ICE candidates.
   * Media flows peer-to-peer; Socket.IO rooms are used to route signals by socketId.
   */
  socket.on('video-join', (payload: VideoJoinPayload, callback?: (result: { participants: VideoParticipant[] }) => void) => {
    const { roomId } = payload;
    if (!roomId || currentRoomId !== roomId) return;

    const room = rooms.get(roomId);
    const user = room?.users.get(socket.id);
    if (!room || !user) return;

    const participants: VideoParticipant[] = [];
    for (const [socketId, name] of room.videoUsers) {
      if (socketId !== socket.id) {
        participants.push({ socketId, username: name });
      }
    }

    room.videoUsers.set(socket.id, user.username);
    touchRoom(room);

    socket.to(roomId).emit('video-user-joined', {
      socketId: socket.id,
      username: user.username,
    });

    callback?.({ participants });
  });

  socket.on('video-leave', (payload: VideoJoinPayload) => {
    const { roomId } = payload;
    if (!roomId || currentRoomId !== roomId) return;
    leaveVideoCall(socket.id, roomId);
  });

  socket.on('webrtc-offer', (payload: WebRTCSignalPayload) => {
    const { roomId, to, offer } = payload;
    if (!roomId || !to || !offer || currentRoomId !== roomId) return;

    const room = rooms.get(roomId);
    const user = room?.users.get(socket.id);
    if (!room?.videoUsers.has(socket.id) || !user) return;

    io.to(to).emit('webrtc-offer', {
      from: socket.id,
      username: user.username,
      offer,
    });
  });

  socket.on('webrtc-answer', (payload: WebRTCSignalPayload) => {
    const { roomId, to, answer } = payload;
    if (!roomId || !to || !answer || currentRoomId !== roomId) return;

    const room = rooms.get(roomId);
    if (!room?.videoUsers.has(socket.id)) return;

    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice', (payload: WebRTCSignalPayload) => {
    const { roomId, to, candidate } = payload;
    if (!roomId || !to || !candidate || currentRoomId !== roomId) return;

    const room = rooms.get(roomId);
    if (!room?.videoUsers.has(socket.id)) return;

    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;

    const username = removeUserFromRoom(socket.id, currentRoomId);
    if (username) {
      socket.to(currentRoomId).emit('user-left', { username });
    }
    currentRoomId = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
