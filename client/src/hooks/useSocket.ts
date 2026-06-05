import { useEffect, useRef, useState } from 'react';
import { ChatSocket } from '../lib/chatSocket';
import { getOrCreateSessionId } from '../utils/roomSession';

const CONNECT_TIMEOUT_MS = 10_000;

export function useSocket(roomId: string | undefined) {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<ChatSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;

    setConnectionError(null);
    setConnected(false);
    setReconnecting(false);

    const sessionId = getOrCreateSessionId(roomId);
    const instance = new ChatSocket(roomId, sessionId);
    socketRef.current = instance;

    instance.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      setConnectionError(null);
    });
    instance.on('disconnect', () => {
      setConnected(false);
    });
    instance.on('reconnecting', () => {
      setReconnecting(true);
      setConnectionError(null);
    });
    instance.on('error', () => {
      setConnectionError('Could not connect to the chat server.');
    });
    instance.connect();

    const timeout = window.setTimeout(() => {
      if (!instance.isOpen() && !instance.isReconnecting()) {
        setConnectionError(
          'Connection timed out. Make sure the server is running (npm run dev).',
        );
      }
    }, CONNECT_TIMEOUT_MS);

    setSocket(instance);

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'visible') {
        instance.pulse();
        if (!instance.isOpen() && !instance.isReconnecting()) {
          instance.connect();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearTimeout(timeout);
      instance.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  return { socket, connected, reconnecting, connectionError };
}
