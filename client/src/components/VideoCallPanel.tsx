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
  playAudio = false,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  playAudio?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const syncAndPlay = () => {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      void el.play().catch(() => {
        // Retry after track data arrives.
      });

      const audioEl = audioRef.current;
      if (audioEl && playAudio) {
        if (audioEl.srcObject !== stream) {
          audioEl.srcObject = stream;
        }
        void audioEl.play().catch(() => {});
      }
    };

    syncAndPlay();
    stream.addEventListener('addtrack', syncAndPlay);

    for (const track of stream.getTracks()) {
      track.addEventListener('unmute', syncAndPlay);
      track.addEventListener('mute', syncAndPlay);
    }

    el.addEventListener('loadedmetadata', syncAndPlay);
    el.addEventListener('canplay', syncAndPlay);

    return () => {
      stream.removeEventListener('addtrack', syncAndPlay);
      el.removeEventListener('loadedmetadata', syncAndPlay);
      el.removeEventListener('canplay', syncAndPlay);
    };
  }, [stream, playAudio]);

  const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live');

  return (
    <div className="video-tile">
      <video
        ref={videoRef}
        className={`video-tile__video${mirror ? ' mirror' : ''}`}
        autoPlay
        playsInline
        muted={muted}
      />
      {playAudio && (
        <audio ref={audioRef} autoPlay playsInline className="video-tile__audio" />
      )}
      {!hasVideo && <div className="video-tile__placeholder">No video</div>}
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

  const tiles: {
    key: string;
    stream: MediaStream;
    label: string;
    muted: boolean;
    mirror: boolean;
    playAudio?: boolean;
  }[] = [
    ...(localStream ? [{ key: 'local', stream: localStream, label: 'You', muted: true, mirror: true }] : []),
    ...remotePeers.map((peer) => ({
      key: peer.socketId,
      stream: peer.stream,
      label: peer.username,
      muted: true,
      mirror: false,
      playAudio: true,
    })),
  ];

  return (
    <div className="video-call-panel">
      <p className="video-call-panel__header">
        Live Video {tiles.length > 0 ? `(${tiles.length})` : ''}
      </p>
      <div className="video-call-panel__grid">
        {tiles.map((tile) => (
          <VideoTile
            key={tile.key}
            stream={tile.stream}
            label={tile.label}
            muted={tile.muted}
            mirror={tile.mirror}
            playAudio={tile.playAudio ?? false}
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
