import { useNavigate } from 'react-router-dom';
import { generateRoomId } from '../utils/roomId';
import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();

  function handleCreateRoom() {
    const roomId = generateRoomId();
    navigate(`/room/${roomId}`);
  }

  return (
    <div className="home">
      <div className="home__card">
        <div className="home__logo">💬</div>
        <h1 className="home__title">Chatroom</h1>
        <p className="home__subtitle">
          Create a temporary room, share the link, and start chatting instantly.
          No accounts. No database. Just talk.
        </p>
        <button className="home__btn" onClick={handleCreateRoom}>
          Create Room
        </button>
        <p className="home__hint">
          Rooms expire after 24 hours of inactivity or when everyone leaves.
        </p>
      </div>
    </div>
  );
}
