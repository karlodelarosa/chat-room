export type MessageType = 'text' | 'image';

export interface ChatMessage {
  id: string;
  username: string;
  type: MessageType;
  content: string;
  imageData?: string;
  timestamp: number;
}

export interface RoomState {
  messages: ChatMessage[];
  userCount: number;
}

export interface SystemEvent {
  id: string;
  type: 'join' | 'leave' | 'expired';
  username?: string;
  message?: string;
  timestamp: number;
}

export type ChatItem =
  | { kind: 'message'; data: ChatMessage }
  | { kind: 'system'; data: SystemEvent };

export interface JoinRoomResult {
  ok: boolean;
  error?: string;
}

export interface VideoParticipant {
  socketId: string;
  username: string;
}

export interface RemotePeer {
  socketId: string;
  username: string;
  stream: MediaStream;
}

export interface VideoJoinResult {
  participants: VideoParticipant[];
}
