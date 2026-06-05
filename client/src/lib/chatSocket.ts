type EventHandler = (data: unknown) => void;

const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

function wsBaseUrl(): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}`;
}

export class ChatSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private ackCounter = 0;
  private pendingAcks = new Map<number, (data: unknown) => void>();
  private readonly url: string;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnecting = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(roomId: string, sessionId: string) {
    const params = new URLSearchParams({ roomId, sessionId });
    this.url = `${wsBaseUrl()}/api/ws?${params.toString()}`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionalClose = false;
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      this.startHeartbeat();
      this.trigger('connect', undefined);
    });

    this.ws.addEventListener('close', () => {
      this.stopHeartbeat();
      this.ws = null;
      this.trigger('disconnect', undefined);
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener('error', () => {
      this.trigger('error', undefined);
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          op: string;
          event?: string;
          data?: unknown;
          id?: number;
        };

        if (msg.op === 'event' && msg.event) {
          this.trigger(msg.event, msg.data);
        } else if (msg.op === 'ack' && msg.id !== undefined) {
          this.pendingAcks.get(msg.id)?.(msg.data);
          this.pendingAcks.delete(msg.id);
        } else if (msg.op === 'pong') {
          // Heartbeat response — connection is alive.
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  on<T = unknown>(event: string, handler: (data: T) => void): void {
    const wrapped: EventHandler = (data) => handler(data as T);
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(wrapped);
    (handler as EventHandler & { __wrapped?: EventHandler }).__wrapped = wrapped;
  }

  off<T = unknown>(event: string, handler: (data: T) => void): void {
    const wrapped = (handler as EventHandler & { __wrapped?: EventHandler }).__wrapped;
    if (wrapped) {
      this.handlers.get(event)?.delete(wrapped);
    }
  }

  emit<T = unknown>(event: string, data?: unknown, ack?: (result: T) => void): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const id = ack ? ++this.ackCounter : undefined;
    if (id !== undefined && ack) {
      this.pendingAcks.set(id, (result) => ack(result as T));
    }

    this.ws.send(JSON.stringify({ op: 'emit', event, data, id }));
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    this.ws?.close();
    this.ws = null;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isReconnecting(): boolean {
    return this.reconnecting;
  }

  /** Send an immediate ping — e.g. when the tab becomes visible again. */
  pulse(): void {
    this.sendPing();
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer) return;

    this.reconnecting = true;
    this.trigger('reconnecting', undefined);

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendPing();
    this.heartbeatTimer = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'ping' }));
    }
  }

  private trigger(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

export type { ChatSocket as Socket };
