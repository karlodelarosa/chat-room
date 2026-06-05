const SESSION_PREFIX = 'chatroom:session:';

export function getOrCreateSessionId(roomId: string): string {
  const key = `${SESSION_PREFIX}${roomId}`;
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

export function getSavedUsername(roomId: string): string | null {
  return sessionStorage.getItem(`chatroom:${roomId}:username`);
}

export function saveUsername(roomId: string, username: string): void {
  sessionStorage.setItem(`chatroom:${roomId}:username`, username);
}

export function clearRoomSession(roomId: string): void {
  sessionStorage.removeItem(`chatroom:${roomId}:username`);
  sessionStorage.removeItem(`${SESSION_PREFIX}${roomId}`);
}
