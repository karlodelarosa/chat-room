import { FormEvent, useState } from 'react';
import { generateUsername } from '../utils/username';
import './UsernameModal.css';

interface UsernameModalProps {
  onSubmit: (username: string) => void;
  disabled?: boolean;
}

export default function UsernameModal({ onSubmit, disabled }: UsernameModalProps) {
  const [username, setUsername] = useState(() => generateUsername());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed) onSubmit(trimmed);
  }

  function handleRandomize() {
    setUsername(generateUsername());
  }

  return (
    <div className="username-modal__overlay">
      <form className="username-modal" onSubmit={handleSubmit}>
        <h2 className="username-modal__title">Join the room</h2>
        <p className="username-modal__desc">Choose a display name to start chatting.</p>

        <label className="username-modal__label" htmlFor="username">
          Username
        </label>
        <div className="username-modal__row">
          <input
            id="username"
            className="username-modal__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            autoFocus
            required
          />
          <button
            type="button"
            className="username-modal__dice"
            onClick={handleRandomize}
            title="Random username"
          >
            🎲
          </button>
        </div>

        <button type="submit" className="username-modal__submit" disabled={disabled}>
          {disabled ? 'Connecting…' : 'Enter Room'}
        </button>
      </form>
    </div>
  );
}
