import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const instance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    setSocket(instance);

    instance.on('connect', () => setConnected(true));
    instance.on('disconnect', () => setConnected(false));

    return () => {
      instance.disconnect();
    };
  }, []);

  return { socket, connected };
}
