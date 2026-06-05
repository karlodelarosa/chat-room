import { useState } from 'react';
import './RoomHeader.css';

interface RoomHeaderProps {
  roomId: string;
  userCount: number;
  connected: boolean;
}

export default function RoomHeader({ roomId, userCount, connected }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <header className="room-header">
      <div className="room-header__info">
        <h1 className="room-header__title">#{roomId}</h1>
        <span className={`room-header__status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Online' : '○ Reconnecting…'}
        </span>
      </div>

      <div className="room-header__actions">
        <span className="room-header__count">
          {userCount} {userCount === 1 ? 'user' : 'users'} online
        </span>
        <button className="room-header__copy" onClick={handleCopyLink}>
          {copied ? '✓ Copied!' : 'Copy Link'}
        </button>
      </div>
    </header>
  );
}
