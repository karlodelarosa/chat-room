export type MessageType = 'text' | 'image';

export interface ChatMessage {
  id: string;
  username: string;
  type: MessageType;
  content: string;
  imageData?: string;
  timestamp: number;
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
  inVideo?: boolean;
}

export interface ClientEmit {
  op: 'emit';
  event: string;
  data?: unknown;
  id?: number;
}

interface MessageRow {
  id: string;
  username: string;
  type: MessageType;
  content: string;
  image_data: string | null;
  timestamp: number;
}

export { type MessageRow };
