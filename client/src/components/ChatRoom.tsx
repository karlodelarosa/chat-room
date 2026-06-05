import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import type { ChatItem, ChatMessage, JoinRoomResult, SystemEvent } from '../types';
import MessageInput from './MessageInput';
import MessageList from './MessageList';
import RoomHeader from './RoomHeader';
import TypingIndicator from './TypingIndicator';
import UsernameModal from './UsernameModal';
import VideoCallPanel from './VideoCallPanel';
import './ChatRoom.css';

function systemEvent(
  type: SystemEvent['type'],
  extra: Partial<SystemEvent> = {},
): SystemEvent {
  return {
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    timestamp: Date.now(),
    ...extra,
  };
}

export default function ChatRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { socket, connected, connectionError } = useSocket(roomId);

  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const video = useWebRTC(socket, roomId, username, joined);

  const chatItems: ChatItem[] = useMemo(() => {
    const items: ChatItem[] = [
      ...messages.map((m) => ({ kind: 'message' as const, data: m })),
      ...systemEvents.map((e) => ({ kind: 'system' as const, data: e })),
    ];
    items.sort((a, b) => {
      const ta = a.kind === 'message' ? a.data.timestamp : a.data.timestamp;
      const tb = b.kind === 'message' ? b.data.timestamp : b.data.timestamp;
      return ta - tb;
    });
    return items;
  }, [messages, systemEvents]);

  const onJoinComplete = useCallback((name: string, result?: JoinRoomResult) => {
    if (result?.ok) {
      setUsername(name);
      setJoined(true);
    }
  }, []);

  const handleJoin = useCallback(
    (name: string) => {
      if (!socket || !roomId) return;
      socket.emit('join-room', { roomId, username: name }, (result: unknown) => {
        onJoinComplete(name, result as JoinRoomResult | undefined);
      });
    },
    [socket, roomId, onJoinComplete],
  );

  // Attach listeners as soon as the socket is ready so room-state is not missed after join.
  useEffect(() => {
    if (!socket || !roomId) return;

    function onRoomState(data: { messages: ChatMessage[]; userCount: number }) {
      setMessages(data.messages);
      setUserCount(data.userCount);
    }

    function onNewMessage(message: ChatMessage) {
      setMessages((prev) => [...prev, message]);
    }

    function onUserJoined({ username: name }: { username: string }) {
      setSystemEvents((prev) => [
        ...prev,
        systemEvent('join', { username: name }),
      ]);
    }

    function onUserLeft({ username: name }: { username: string }) {
      setSystemEvents((prev) => [
        ...prev,
        systemEvent('leave', { username: name }),
      ]);
    }

    function onUserCount(count: number) {
      setUserCount(count);
    }

    function onUserTyping({ username: name }: { username: string }) {
      if (name === username) return;
      setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    }

    function onUserStopTyping({ username: name }: { username: string }) {
      setTypingUsers((prev) => prev.filter((u) => u !== name));
    }

    function onRoomExpired({ message }: { message: string }) {
      setSystemEvents((prev) => [
        ...prev,
        systemEvent('expired', { message }),
      ]);
      setJoined(false);
    }

    socket.on('room-state', onRoomState);
    socket.on('new-message', onNewMessage);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('user-count', onUserCount);
    socket.on('user-typing', onUserTyping);
    socket.on('user-stop-typing', onUserStopTyping);
    socket.on('room-expired', onRoomExpired);

    return () => {
      socket.off('room-state', onRoomState);
      socket.off('new-message', onNewMessage);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('user-count', onUserCount);
      socket.off('user-typing', onUserTyping);
      socket.off('user-stop-typing', onUserStopTyping);
      socket.off('room-expired', onRoomExpired);
    };
  }, [socket, roomId, username]);

  function handleSend(content: string) {
    if (!socket || !roomId) return;
    socket.emit('send-message', { roomId, type: 'text', content });
  }

  function handleSendImage(imageData: string, caption?: string) {
    if (!socket || !roomId) return;
    socket.emit('send-message', {
      roomId,
      type: 'image',
      imageData,
      content: caption,
    });
  }

  function handleTyping() {
    if (!socket || !roomId || !username) return;
    socket.emit('typing', { roomId, username });
  }

  function handleStopTyping() {
    if (!socket || !roomId || !username) return;
    socket.emit('stop-typing', { roomId, username });
  }

  if (!roomId) {
    navigate('/');
    return null;
  }

  return (
    <div className="chat-room">
      <RoomHeader roomId={roomId} userCount={userCount} connected={connected} />

      <div className="chat-room__main">
        {joined && (
          <aside className="chat-room__video">
            <VideoCallPanel
              isInCall={video.isInCall}
              joining={video.joining}
              localStream={video.localStream}
              remotePeers={video.remotePeers}
              micEnabled={video.micEnabled}
              cameraEnabled={video.cameraEnabled}
              error={video.error}
              onJoin={video.joinCall}
              onLeave={video.leaveCall}
              onToggleMic={video.toggleMic}
              onToggleCamera={video.toggleCamera}
            />
          </aside>
        )}

        <section className={`chat-room__chat${joined ? '' : ' chat-room__chat--full'}`}>
          <div className="chat-room__messages">
            <MessageList items={chatItems} />
          </div>

          {joined && (
            <>
              <TypingIndicator users={typingUsers} />
              <MessageInput
                disabled={!connected}
                onSend={handleSend}
                onSendImage={handleSendImage}
                onTyping={handleTyping}
                onStopTyping={handleStopTyping}
              />
            </>
          )}
        </section>
      </div>

      {!joined && (
        <UsernameModal
          onSubmit={handleJoin}
          disabled={!socket || !connected}
          statusMessage={
            connectionError ??
            (!connected ? 'Connecting to chat server…' : undefined)
          }
        />
      )}
    </div>
  );
}
