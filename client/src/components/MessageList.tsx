import { useEffect, useRef } from 'react';
import type { ChatItem } from '../types';
import { formatTimestamp } from '../utils/formatTime';
import './MessageList.css';

interface MessageListProps {
  items: ChatItem[];
}

export default function MessageList({ items }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  return (
    <div className="message-list">
      {items.length === 0 && (
        <p className="message-list__empty">
          No messages yet. Say hello!
        </p>
      )}

      {items.map((item) => {
        if (item.kind === 'system') {
          const { data } = item;
          let text = '';
          if (data.type === 'join') text = `${data.username} joined the room`;
          else if (data.type === 'leave') text = `${data.username} left the room`;
          else text = data.message ?? 'Room expired';

          return (
            <div key={data.id} className="message-list__system">
              <span>{text}</span>
            </div>
          );
        }

        const { data: msg } = item;
        return (
          <div key={msg.id} className="message-list__message">
            <div className="message-list__meta">
              <span className="message-list__username">{msg.username}</span>
              <span className="message-list__time">{formatTimestamp(msg.timestamp)}</span>
            </div>
            {(msg.type === 'image' || msg.imageData) && msg.imageData && (
              <img
                src={msg.imageData}
                alt={msg.content || 'Shared photo'}
                className="message-list__image"
                loading="lazy"
              />
            )}
            {msg.content && (
              <p className="message-list__content">{msg.content}</p>
            )}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
