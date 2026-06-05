import { DurableObject } from 'cloudflare:workers';
import type {
  ChatMessage,
  ClientEmit,
  JoinRoomPayload,
  SendMessagePayload,
  SessionAttachment,
  TypingPayload,
  VideoJoinPayload,
  VideoParticipant,
  WebRTCSignalPayload,
} from './types.js';

const ROOM_INACTIVITY_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 600_000;

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
  private messages: ChatMessage[] = [];
  private users = new Map<string, string>();
  private videoUsers = new Map<string, string>();
  private lastActivityAt = Date.now();

  private touchRoom(): void {
    this.lastActivityAt = Date.now();
    void this.ctx.storage.setAlarm(Date.now() + ROOM_INACTIVITY_MS);
  }

  private sendEvent(ws: WebSocket, event: string, data: unknown): void {
    ws.send(JSON.stringify({ op: 'event', event, data }));
  }

  private sendAck(ws: WebSocket, id: number, data: unknown): void {
    ws.send(JSON.stringify({ op: 'ack', id, data }));
  }

  private broadcast(event: string, data: unknown, exclude?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        this.sendEvent(ws, event, data);
      }
    }
  }

  private broadcastUserCount(): void {
    this.broadcast('user-count', this.users.size);
  }

  private leaveVideoCall(sessionId: string): void {
    if (!this.videoUsers.has(sessionId)) return;
    this.videoUsers.delete(sessionId);
    this.touchRoom();
    this.broadcast('video-user-left', { socketId: sessionId });
  }

  private removeUser(sessionId: string): string | null {
    const username = this.users.get(sessionId);
    if (!username) return null;

    this.leaveVideoCall(sessionId);
    this.users.delete(sessionId);
    this.touchRoom();

    if (this.users.size === 0) {
      this.messages = [];
      this.videoUsers.clear();
      void this.ctx.storage.deleteAlarm();
      return username;
    }

    this.broadcastUserCount();
    return username;
  }

  async alarm(): Promise<void> {
    if (Date.now() - this.lastActivityAt < ROOM_INACTIVITY_MS) {
      void this.ctx.storage.setAlarm(this.lastActivityAt + ROOM_INACTIVITY_MS);
      return;
    }

    this.broadcast('room-expired', {
      message: 'This room expired after 24 hours of inactivity.',
    });

    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1000, 'Room expired');
    }

    this.users.clear();
    this.videoUsers.clear();
    this.messages = [];
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const attachment: SessionAttachment = {
      sessionId: crypto.randomUUID(),
      joined: false,
    };
    setAttachment(server, attachment);

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
        this.handleVideoLeave(attachment, parsed.data as VideoJoinPayload);
        break;
      case 'webrtc-offer':
        this.handleWebRTCOffer(attachment, parsed.data as WebRTCSignalPayload);
        break;
      case 'webrtc-answer':
        this.handleWebRTCAnswer(attachment, parsed.data as WebRTCSignalPayload);
        break;
      case 'webrtc-ice':
        this.handleWebRTCIce(attachment, parsed.data as WebRTCSignalPayload);
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = getAttachment(ws);
    if (!attachment.joined) return;

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

    if (attachment.joined && attachment.sessionId) {
      this.removeUser(attachment.sessionId);
    }

    this.touchRoom();
    this.users.set(attachment.sessionId, trimmedName);

    const nextAttachment: SessionAttachment = {
      ...attachment,
      username: trimmedName,
      joined: true,
    };
    setAttachment(ws, nextAttachment);

    this.broadcast('user-joined', { username: trimmedName }, ws);
    this.broadcastUserCount();

    this.sendEvent(ws, 'room-state', {
      messages: this.messages,
      userCount: this.users.size,
    });

    ack?.({ ok: true });
  }

  private handleSendMessage(
    ws: WebSocket,
    attachment: SessionAttachment,
    payload: SendMessagePayload,
  ): void {
    if (!attachment.joined || !payload.roomId) return;

    const username = this.users.get(attachment.sessionId);
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

    this.messages.push(message);
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
    if (!attachment.joined || !payload.roomId) return;

    const username = this.users.get(attachment.sessionId);
    if (!username) return;

    const participants: VideoParticipant[] = [];
    for (const [sessionId, name] of this.videoUsers) {
      if (sessionId !== attachment.sessionId) {
        participants.push({ socketId: sessionId, username: name });
      }
    }

    this.videoUsers.set(attachment.sessionId, username);
    this.touchRoom();

    this.broadcast('video-user-joined', {
      socketId: attachment.sessionId,
      username,
    }, ws);

    ack?.({ participants });
  }

  private handleVideoLeave(
    attachment: SessionAttachment,
    _payload: VideoJoinPayload,
  ): void {
    if (!attachment.joined) return;
    this.leaveVideoCall(attachment.sessionId);
  }

  private handleWebRTCOffer(
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !payload.to || !payload.offer) return;
    if (!this.videoUsers.has(attachment.sessionId)) return;

    const username = this.users.get(attachment.sessionId);
    if (!username) return;

    const target = this.findWebSocket(payload.to);
    if (!target) return;

    this.sendEvent(target, 'webrtc-offer', {
      from: attachment.sessionId,
      username,
      offer: payload.offer,
    });
  }

  private handleWebRTCAnswer(
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !payload.to || !payload.answer) return;
    if (!this.videoUsers.has(attachment.sessionId)) return;

    const target = this.findWebSocket(payload.to);
    if (!target) return;

    this.sendEvent(target, 'webrtc-answer', {
      from: attachment.sessionId,
      answer: payload.answer,
    });
  }

  private handleWebRTCIce(
    attachment: SessionAttachment,
    payload: WebRTCSignalPayload,
  ): void {
    if (!attachment.joined || !payload.to || !payload.candidate) return;
    if (!this.videoUsers.has(attachment.sessionId)) return;

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
