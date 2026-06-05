export type MessageType = 'text' | 'image';

export interface ChatMessage {
  id: string;
  username: string;
  type: MessageType;
  content: string;
  imageData?: string;
  timestamp: number;
}

export interface RoomUser {
  sessionId: string;
  username: string;
}

export interface VideoParticipant {
  socketId: string;
  username: string;
}

export interface JoinRoomPayload {
  roomId: string;
  username: string;
}

export interface SendMessagePayload {
  roomId: string;
  type?: MessageType;
  content?: string;
  imageData?: string;
}

export interface TypingPayload {
  roomId: string;
  username: string;
}

export interface VideoJoinPayload {
  roomId: string;
}

export interface WebRTCSignalPayload {
  roomId: string;
  to: string;
  offer?: object;
  answer?: object;
  candidate?: object;
}

export interface SessionAttachment {
  sessionId: string;
  username?: string;
  joined: boolean;
}

export interface ClientEmit {
  op: 'emit';
  event: string;
  data?: unknown;
  id?: number;
}

export interface ServerEvent {
  op: 'event';
  event: string;
  data: unknown;
}

export interface ServerAck {
  op: 'ack';
  id: number;
  data: unknown;
}

export type ServerMessage = ServerEvent | ServerAck;
