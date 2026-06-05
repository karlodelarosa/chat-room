import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import CameraModal from './CameraModal';
import './MessageInput.css';

interface MessageInputProps {
  disabled?: boolean;
  onSend: (content: string) => void;
  onSendImage: (imageData: string, caption?: string) => void;
  onTyping: () => void;
  onStopTyping: () => void;
}

export default function MessageInput({
  disabled,
  onSend,
  onSendImage,
  onTyping,
  onStopTyping,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleChange(value: string) {
    setText(value);
    onTyping();
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(onStopTyping, 1500);
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    onStopTyping();
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleEmojiClick(emojiData: EmojiClickData) {
    setText((prev) => prev + emojiData.emoji);
    onTyping();
  }

  return (
    <div className="message-input">
      {showCamera && (
        <CameraModal
          onClose={() => setShowCamera(false)}
          onSend={(imageData, caption) => {
            onSendImage(imageData, caption);
            onStopTyping();
          }}
        />
      )}

      <div className="message-input__wrapper">
        <button
          type="button"
          className="message-input__camera-btn"
          onClick={() => setShowCamera(true)}
          disabled={disabled}
          title="Take a photo"
        >
          📷
        </button>

        <div className="message-input__emoji-container" ref={pickerRef}>
          <button
            type="button"
            className="message-input__emoji-btn"
            onClick={() => setShowEmoji((v) => !v)}
            disabled={disabled}
            title="Add emoji"
          >
            😀
          </button>
          {showEmoji && (
            <div className="message-input__picker">
              <EmojiPicker
                theme={Theme.DARK}
                onEmojiClick={handleEmojiClick}
                width="100%"
                height={350}
              />
            </div>
          )}
        </div>

        <textarea
          className="message-input__field"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message #room (Enter to send)"
          rows={1}
          disabled={disabled}
        />

        <button
          type="button"
          className="message-input__send"
          onClick={handleSend}
          disabled={disabled || !text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
