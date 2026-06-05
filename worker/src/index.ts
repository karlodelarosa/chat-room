import { DurableObject } from 'cloudflare:workers';
import type {
  ChatMessage,
  ClientEmit,
  JoinRoomPayload,
  MessageRow,
  SendMessagePayload,
  SessionAttachment,
  TypingPayload,
  VideoJoinPayload,
  VideoParticipant,
  WebRTCSignalPayload,
} from './types.js';

const ROOM_INACTIVITY_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 600_000;
const LAST_ACTIVITY_KEY = 'lastActivityAt';

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  STATIC: Fetcher;
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getAttachment(ws: WebSocket): SessionAttachment {
  return (ws.deserializeAttachment() as SessionAttachment | null) ?? {
    sessionId: crypto.randomUUID(),
    joined: false,
  };
}

function setAttachment(ws: WebSocket, attachment: SessionAttachment): void {
  ws.serializeAttachment(attachment);
}

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Keep idle connections alive at the edge without waking the DO (avoids ~60s proxy timeout).
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ op: 'ping' }),
        JSON.stringify({ op: 'pong' }),
      ),
    );

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          image_data TEXT,
          timestamp INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    });
  }

  /** Users are derived from live WebSocket attachments — survives DO hibernation. */
  private getJoinedUsers(): Map<string, string> {
    const users = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws);
      if (attachment.joined && attachment.username) {
        users.set(attachment.sessionId, attachment.username);
      }
    }
    return users;
  }

  private getLastActivityAt(): number {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>(
        'SELECT value FROM room_meta WHERE key = ?',
        LAST_ACTIVITY_KEY,
      )
      .one();
    return row ? Number(row.value) : Date.now();
  }

  private touchRoom(): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO room_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      LAST_ACTIVITY_KEY,
      String(now),
    );
    void this.ctx.storage.setAlarm(now + ROOM_INACTIVITY_MS);
  }

  private loadMessages(): ChatMessage[] {
    return this.ctx.storage.sql
      .exec<MessageRow>(
        'SELECT id, username, type, content, image_data, timestamp FROM messages ORDER BY timestamp ASC',
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        username: row.username,
        type: row.type,
        content: row.content,
        imageData: row.image_data ?? undefined,
        timestamp: row.timestamp,
      }));
  }

  private saveMessage(message: ChatMessage): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, username, type, content, image_data, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      message.id,
      message.username,
      message.type,
      message.content,
      message.imageData ?? null,
      message.timestamp,
    );
  }

  private clearRoomData(): void {
    this.ctx.storage.sql.exec('DELETE FROM messages');
    this.ctx.storage.sql.exec('DELETE FROM room_meta');
    void this.ctx.storage.deleteAlarm();
  }

  private sendEvent(ws: WebSocket, event: string, data: unknown): void {
    try {
      ws.send(JSON.stringify({ op: 'event', event, data }));
    } catch {
      // Client disconnected.
    }
  }

  private sendAck(ws: WebSocket, id: number, data: unknown): void {
    try {
      ws.send(JSON.stringify({ op: 'ack', id, data }));
    } catch {
      // Client disconnected.
    }
  }

  private broadcast(event: string, data: unknown, exclude?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        this.sendEvent(ws, event, data);
      }
    }
  }

  private broadcastUserCount(): void {
    this.broadcast('user-count', this.getJoinedUsers().size);
  }

  private closeDuplicateSessions(sessionId: string, keep: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === keep) continue;
      const attachment = getAttachment(ws);
      if (attachment.sessionId === sessionId) {
        ws.close(1000, 'Replaced by new connection');
      }
    }
  }

  private leaveVideoCall(sessionId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws);
      if (attachment.sessionId === sessionId && attachment.inVideo) {
        setAttachment(ws, { ...attachment, inVideo: false });
        this.broadcast('video-user-left', { socketId: sessionId });
        return;
      }
    }
  }

  private removeUser(sessionId: string): string | null {
    let username: string | null = null;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws);
      if (attachment.sessionId === sessionId && attachment.joined) {
        username = attachment.username ?? null;
        setAttachment(ws, { ...attachment, joined: false, inVideo: false });
        break;
      }
    }

    if (!username) return null;

    this.leaveVideoCall(sessionId);
    this.touchRoom();

    if (this.getJoinedUsers().size === 0) {
      this.clearRoomData();
      return username;
    }

    this.broadcastUserCount();
    return username;
  }

  async alarm(): Promise<void> {
    const lastActivityAt = this.getLastActivityAt();
    if (Date.now() - lastActivityAt < ROOM_INACTIVITY_MS) {
      void this.ctx.storage.setAlarm(lastActivityAt + ROOM_INACTIVITY_MS);
      return;
    }

    this.broadcast('room-expired', {
      message: 'This room expired after 24 hours of inactivity.',
    });

    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1000, 'Room expired');
    }

    this.clearRoomData();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const attachment: SessionAttachment = {
      sessionId,
      joined: false,
    };
    setAttachment(server, attachment);
    this.closeDuplicateSessions(sessionId, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: ClientEmit;
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (parsed.op !== 'emit') return;

    const attachment = getAttachment(ws);
    const ack = parsed.id !== undefined
      ? (data: unknown) => this.sendAck(ws, parsed.id!, data)
      : undefined;

    switch (parsed.event) {
      case 'join-room':
        this.handleJoinRoom(ws, attachment, parsed.data as JoinRoomPayload, ack);
        break;
      case 'send-message':
        this.handleSendMessage(ws, attachment, parsed.data as SendMessagePayload);
        break;
      case 'typing':
        this.handleTyping(ws, attachment, parsed.data as TypingPayload);
        break;
      case 'stop-typing':
        this.handleStopTyping(ws, attachment, parsed.data as TypingPayload);
        break;
      case 'video-join':
        this.handleVideoJoin(ws, attachment, parsed.data as VideoJoinPayload, ack);
        break;
      case 'video-leave':
        this.handleVideoLeave(ws, attachment, parsed.data as VideoJoinPayload);
        break;
      case 'webrtc-offer':
        this.handleWebRTCOffer(ws, attachment, parsed.data as WebRTCSignalPayload);
        break;
      case 'webrtc-answer':
        this.handleWebRTCAnswer(ws, attachment, parsed.data as WebRTCSignalPayload);
        break;
      case 'webrtc-ice':
        this.handleWebRTCIce(ws, attachment, parsed.data as WebRTCSignalPayload);
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = getAttachment(ws);
    if (!attachment.joined) return;

    // During reconnect the client opens a new socket before the old one closes.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const otherAttachment = getAttachment(other);
      if (
        otherAttachment.sessionId === attachment.sessionId &&
        otherAttachment.joined
      ) {
        return;
      }
    }

    const username = this.removeUser(attachment.sessionId);
    if (username) {
      this.broadcast('user-left', { username }, ws);
    }
  }

  private handleJoinRoom(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: JoinRoomPayload,
    ack?: (data: unknown) => void,
  ): void {
    const trimmedName = payload.username?.trim();
    if (!payload.roomId || !trimmedName) {
      ack?.({ ok: false, error: 'Room ID and username are required.' });
      return;
    }

    this.closeDuplicateSessions(attachment.sessionId, ws);

    const users = this.getJoinedUsers();
    const wasJoined = attachment.joined;
    if (wasJoined && users.has(attachment.sessionId)) {
      users.delete(attachment.sessionId);
    }

    this.touchRoom();

    const nextAttachment: SessionAttachment = {
      ...attachment,
      username: trimmedName,
      joined: true,
      inVideo: false,
    };
    setAttachment(ws, nextAttachment);

    if (!wasJoined) {
      this.broadcast('user-joined', { username: trimmedName }, ws);
    }
    this.broadcastUserCount();

    this.sendEvent(ws, 'room-state', {
      messages: this.loadMessages(),
      userCount: this.getJoinedUsers().size,
    });

    ack?.({ ok: true });
  }

  private handleSendMessage(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: SendMessagePayload,
  ): void {
    if (!attachment.joined || !payload.roomId) return;

    const username = attachment.username;
    if (!username) return;

    let message: ChatMessage | null = null;

    if (payload.type === 'text' || !payload.type) {
      const trimmed = payload.content?.trim();
      if (!trimmed) return;
      message = {
        id: generateMessageId(),
        username,
        type: 'text',
        content: trimmed,
        timestamp: Date.now(),
      };
    } else if (payload.type === 'image') {
      if (!payload.imageData?.startsWith('data:image/')) return;
      if (payload.imageData.length > MAX_IMAGE_BYTES) return;
      message = {
        id: generateMessageId(),
        username,
        type: 'image',
        content: payload.content?.trim() ?? '',
        imageData: payload.imageData,
        timestamp: Date.now(),
      };
    }

    if (!message) return;

    this.saveMessage(message);
    this.touchRoom();
    this.broadcast('new-message', message);
  }

  private handleTyping(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: TypingPayload,
  ): void {
    if (!attachment.joined || !payload.username) return;
    this.broadcast('user-typing', { username: payload.username }, ws);
  }

  private handleStopTyping(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: TypingPayload,
  ): void {
    if (!attachment.joined || !payload.username) return;
    this.broadcast('user-stop-typing', { username: payload.username }, ws);
  }

  private handleVideoJoin(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: VideoJoinPayload,
    ack?: (data: unknown) => void,
  ): void {
    if (!attachment.joined || !payload.roomId || !attachment.username) return;

    const participants: VideoParticipant[] = [];
    for (const peer of this.ctx.getWebSockets()) {
      const peerAttachment = getAttachment(peer);
      if (
        peerAttachment.inVideo &&
        peerAttachment.sessionId !== attachment.sessionId &&
        peerAttachment.username
      ) {
        participants.push({
          socketId: peerAttachment.sessionId,
          username: peerAttachment.username,
        });
      }
    }

    setAttachment(ws, { ...attachment, inVideo: true });
    this.touchRoom();

    this.broadcast('video-user-joined', {
      socketId: attachment.sessionId,
      username: attachment.username,
    }, ws);

    ack?.({ participants });
  }

  private handleVideoLeave(
    ws: WebSocket,
    attachment: SessionAttachment,
    _payload: VideoJoinPayload,
  ): void {
    if (!attachment.joined) return;
    this.leaveVideoCall(attachment.sessionId);
    setAttachment(ws, { ...attachment, inVideo: false });
  }

  private handleWebRTCOffer(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !attachment.inVideo || !payload.to || !payload.offer) return;
    if (!attachment.username) return;

    const target = this.findWebSocket(payload.to);
    if (!target) return;

    this.sendEvent(target, 'webrtc-offer', {
      from: attachment.sessionId,
      username: attachment.username,
      offer: payload.offer,
    });
  }

  private handleWebRTCAnswer(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !attachment.inVideo || !payload.to || !payload.answer) return;

    const target = this.findWebSocket(payload.to);
    if (!target) return;

    this.sendEvent(target, 'webrtc-answer', {
      from: attachment.sessionId,
      answer: payload.answer,
    });
  }

  private handleWebRTCIce(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !attachment.inVideo || !payload.to || !payload.candidate) return;

    const target = this.findWebSocket(payload.to);
    if (!target) return;

    this.sendEvent(target, 'webrtc-ice', {
      from: attachment.sessionId,
      candidate: payload.candidate,
    });
  }

  private findWebSocket(sessionId: string): WebSocket | undefined {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = getAttachment(ws);
      if (attachment.sessionId === sessionId) return ws;
    }
    return undefined;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true });
    }

    if (url.pathname === '/api/ws') {
      const roomId = url.searchParams.get('roomId');
      if (!roomId) {
        return new Response('Missing roomId', { status: 400 });
      }
      const stub = env.CHAT_ROOM.getByName(roomId);
      return stub.fetch(request);
    }

    return env.STATIC.fetch(request);
  },
};
