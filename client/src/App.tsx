import { Route, Routes } from 'react-router-dom';
import HomePage from './components/HomePage';
import ChatRoom from './components/ChatRoom';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<ChatRoom />} />
    </Routes>
  );
}
