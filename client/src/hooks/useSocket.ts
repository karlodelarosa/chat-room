import { useEffect, useState } from 'react';
import { ChatSocket } from '../lib/chatSocket';

const CONNECT_TIMEOUT_MS = 10_000;

export function useSocket(roomId: string | undefined) {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;

    setConnectionError(null);
    setConnected(false);

    const instance = new ChatSocket(roomId);

    instance.on('connect', () => {
      setConnected(true);
      setConnectionError(null);
    });
    instance.on('disconnect', () => setConnected(false));
    instance.on('error', () => {
      setConnected(false);
      setConnectionError('Could not connect to the chat server.');
    });
    instance.connect();

    const timeout = window.setTimeout(() => {
      if (!instance.isOpen()) {
        setConnectionError(
          'Connection timed out. Make sure the server is running (npm run dev).',
        );
      }
    }, CONNECT_TIMEOUT_MS);

    setSocket(instance);

    return () => {
      window.clearTimeout(timeout);
      instance.disconnect();
    };
  }, [roomId]);

  return { socket, connected, connectionError };
}
