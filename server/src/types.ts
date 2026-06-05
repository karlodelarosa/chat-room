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
  socketId: string;
  username: string;
}

export interface VideoParticipant {
  socketId: string;
  username: string;
}

export interface RoomData {
  id: string;
  users: Map<string, RoomUser>;
  /** Users currently in the live video call (socketId → username). */
  videoUsers: Map<string, string>;
  messages: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
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
