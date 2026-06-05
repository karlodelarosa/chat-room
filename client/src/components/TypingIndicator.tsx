import './TypingIndicator.css';

interface TypingIndicatorProps {
  users: string[];
}

export default function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null;

  let text: string;
  if (users.length === 1) {
    text = `${users[0]} is typing…`;
  } else if (users.length === 2) {
    text = `${users[0]} and ${users[1]} are typing…`;
  } else {
    text = `${users.length} people are typing…`;
  }

  return (
    <div className="typing-indicator">
      <span className="typing-indicator__dots">
        <span />
        <span />
        <span />
      </span>
      {text}
    </div>
  );
}
