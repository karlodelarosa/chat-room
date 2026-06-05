import { useEffect, useRef } from 'react';
import type { RemotePeer } from '../types';
import './VideoCallPanel.css';

interface VideoCallPanelProps {
  isInCall: boolean;
  joining: boolean;
  localStream: MediaStream | null;
  remotePeers: RemotePeer[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

function VideoTile({
  stream,
  label,
  muted = false,
  mirror = false,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean;
  mirror?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return (
    <div className="video-tile">
      <video
        ref={videoRef}
        className={`video-tile__video${mirror ? ' mirror' : ''}`}
        autoPlay
        playsInline
        muted={muted}
      />
      <span className="video-tile__label">{label}</span>
    </div>
  );
}

export default function VideoCallPanel({
  isInCall,
  joining,
  localStream,
  remotePeers,
  micEnabled,
  cameraEnabled,
  error,
  onJoin,
  onLeave,
  onToggleMic,
  onToggleCamera,
}: VideoCallPanelProps) {
  if (!isInCall) {
    return (
      <div className="video-call-bar">
        <p className="video-call-panel__header">Live Video</p>
        <div className="video-call-bar__body">
          {error && <p className="video-call-bar__error">{error}</p>}
          <button
            type="button"
            className="video-call-bar__join"
            onClick={onJoin}
            disabled={joining}
          >
            {joining ? 'Starting camera…' : '📹 Start Video & Voice'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="video-call-panel">
      <p className="video-call-panel__header">Live Video</p>
      <div className="video-call-panel__grid">
        {localStream && (
          <VideoTile
            stream={localStream}
            label="You"
            muted
            mirror
          />
        )}
        {remotePeers.map((peer) => (
          <VideoTile
            key={peer.socketId}
            stream={peer.stream}
            label={peer.username}
          />
        ))}
      </div>

      <div className="video-call-panel__controls">
        <button
          type="button"
          className={`video-call-panel__btn${micEnabled ? '' : ' off'}`}
          onClick={onToggleMic}
          title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micEnabled ? '🎤' : '🔇'}
        </button>
        <button
          type="button"
          className={`video-call-panel__btn${cameraEnabled ? '' : ' off'}`}
          onClick={onToggleCamera}
          title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {cameraEnabled ? '📹' : '📷'}
        </button>
        <button
          type="button"
          className="video-call-panel__btn leave"
          onClick={onLeave}
          title="Leave video call"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
