const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate an 8-character alphanumeric room ID (e.g. x4k9m2ab). */
export function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}
