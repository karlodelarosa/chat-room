type EventHandler = (data: unknown) => void;

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

  constructor(roomId: string) {
    this.url = `${wsBaseUrl()}/api/ws?roomId=${encodeURIComponent(roomId)}`;
  }

  connect(): void {
    if (this.ws) return;

    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      this.trigger('connect', undefined);
    });

    this.ws.addEventListener('close', () => {
      this.trigger('disconnect', undefined);
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
    this.ws?.close();
    this.ws = null;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private trigger(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

export type { ChatSocket as Socket };
