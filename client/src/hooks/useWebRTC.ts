import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSocket } from '../lib/chatSocket';
import type { RemotePeer, VideoJoinResult } from '../types';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 4,
};

interface PeerEntry {
  pc: RTCPeerConnection;
  username: string;
  pendingCandidates: RTCIceCandidateInit[];
}

async function flushPendingCandidates(entry: PeerEntry): Promise<void> {
  if (!entry.pc.remoteDescription) return;
  const pending = entry.pendingCandidates.splice(0);
  for (const candidate of pending) {
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      // Candidate may already be applied.
    }
  }
}

async function queueIceCandidate(
  entry: PeerEntry,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  if (entry.pc.remoteDescription) {
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      // Ignore late/duplicate candidates.
    }
    return;
  }
  entry.pendingCandidates.push(candidate);
}

async function getCallMedia(): Promise<MediaStream> {
  const preferred: MediaStreamConstraints = {
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
}

export function useWebRTC(
  socket: ChatSocket | null,
  roomId: string | undefined,
  _username: string,
  chatJoined: boolean,
) {
  const [isInCall, setIsInCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const isInCallRef = useRef(false);

  const removePeer = useCallback((socketId: string) => {
    const entry = peersRef.current.get(socketId);
    if (entry) {
      entry.pc.close();
      peersRef.current.delete(socketId);
    }
    setRemotePeers((prev) => prev.filter((p) => p.socketId !== socketId));
  }, []);

  const cleanupCall = useCallback(() => {
    for (const [socketId] of peersRef.current) {
      removePeer(socketId);
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemotePeers([]);
    setIsInCall(false);
    isInCallRef.current = false;
    setMicEnabled(true);
    setCameraEnabled(true);
  }, [removePeer]);

  const createPeerConnection = useCallback(
    (remoteSocketId: string, remoteUsername: string) => {
      const existing = peersRef.current.get(remoteSocketId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.ontrack = (event) => {
        const stream =
          event.streams[0] ?? new MediaStream([event.track]);

        setRemotePeers((prev) => {
          const found = prev.find((p) => p.socketId === remoteSocketId);
          if (found) {
            return prev.map((p) =>
              p.socketId === remoteSocketId ? { ...p, stream } : p,
            );
          }
          return [
            ...prev,
            { socketId: remoteSocketId, username: remoteUsername, stream },
          ];
        });
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !socket || !roomId) return;
        socket.emit('webrtc-ice', {
          roomId,
          to: remoteSocketId,
          candidate: event.candidate.toJSON(),
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          pc.restartIce();
        } else if (pc.connectionState === 'closed') {
          removePeer(remoteSocketId);
        }
      };

      const entry: PeerEntry = { pc, username: remoteUsername, pendingCandidates: [] };
      peersRef.current.set(remoteSocketId, entry);
      return entry;
    },
    [socket, roomId, removePeer],
  );

  const createAndSendOffer = useCallback(
    async (remoteSocketId: string, remoteUsername: string) => {
      if (!socket || !roomId) return;

      const entry = createPeerConnection(remoteSocketId, remoteUsername);
      if (entry.pc.signalingState !== 'stable') return;

      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', { roomId, to: remoteSocketId, offer });
    },
    [socket, roomId, createPeerConnection],
  );

  const handleOffer = useCallback(
    async (from: string, fromUsername: string, offer: RTCSessionDescriptionInit) => {
      if (!socket || !roomId || !isInCallRef.current) return;

      const entry = createPeerConnection(from, fromUsername);
      if (entry.pc.signalingState !== 'stable') return;

      await entry.pc.setRemoteDescription(offer);
      await flushPendingCandidates(entry);

      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);

      socket.emit('webrtc-answer', { roomId, to: from, answer });
    },
    [socket, roomId, createPeerConnection],
  );

  const handleAnswer = useCallback(async (from: string, answer: RTCSessionDescriptionInit) => {
    const entry = peersRef.current.get(from);
    if (!entry) return;

    await entry.pc.setRemoteDescription(answer);
    await flushPendingCandidates(entry);
  }, []);

  const handleIce = useCallback(async (from: string, candidate: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(from);
    if (!entry) return;
    await queueIceCandidate(entry, candidate);
  }, []);

  useEffect(() => {
    if (!socket || !roomId || !chatJoined) return;

    function onVideoUserLeft({ socketId }: { socketId: string }) {
      removePeer(socketId);
    }

    function onWebRTCOffer({
      from,
      username: fromUsername,
      offer,
    }: {
      from: string;
      username: string;
      offer: RTCSessionDescriptionInit;
    }) {
      void handleOffer(from, fromUsername, offer);
    }

    function onWebRTCAnswer({
      from,
      answer,
    }: {
      from: string;
      answer: RTCSessionDescriptionInit;
    }) {
      void handleAnswer(from, answer);
    }

    function onWebRTCIce({
      from,
      candidate,
    }: {
      from: string;
      candidate: RTCIceCandidateInit;
    }) {
      void handleIce(from, candidate);
    }

    socket.on('video-user-left', onVideoUserLeft);
    socket.on('webrtc-offer', onWebRTCOffer);
    socket.on('webrtc-answer', onWebRTCAnswer);
    socket.on('webrtc-ice', onWebRTCIce);

    return () => {
      socket.off('video-user-left', onVideoUserLeft);
      socket.off('webrtc-offer', onWebRTCOffer);
      socket.off('webrtc-answer', onWebRTCAnswer);
      socket.off('webrtc-ice', onWebRTCIce);
    };
  }, [
    socket,
    roomId,
    chatJoined,
    removePeer,
    handleOffer,
    handleAnswer,
    handleIce,
    createAndSendOffer,
  ]);

  useEffect(() => {
    return () => {
      if (isInCallRef.current && socket && roomId) {
        socket.emit('video-leave', { roomId });
      }
      cleanupCall();
    };
  }, [socket, roomId, cleanupCall]);

  const joinCall = useCallback(async () => {
    if (!socket || !roomId || isInCallRef.current || joining) return;

    setJoining(true);
    setError(null);

    try {
      const stream = await getCallMedia();

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsInCall(true);
      isInCallRef.current = true;

      socket.emit('video-join', { roomId }, (result: VideoJoinResult) => {
        for (const participant of result.participants) {
          void createAndSendOffer(participant.socketId, participant.username);
        }
      });
    } catch {
      setError('Camera/microphone access denied. Allow permissions and try again.');
      cleanupCall();
    } finally {
      setJoining(false);
    }
  }, [socket, roomId, joining, createAndSendOffer, cleanupCall]);

  const leaveCall = useCallback(() => {
    if (socket && roomId) {
      socket.emit('video-leave', { roomId });
    }
    cleanupCall();
  }, [socket, roomId, cleanupCall]);

  const toggleMic = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !micEnabled;
    tracks.forEach((t) => { t.enabled = next; });
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCamera = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    const next = !cameraEnabled;
    tracks.forEach((t) => { t.enabled = next; });
    setCameraEnabled(next);
  }, [cameraEnabled]);

  return {
    isInCall,
    joining,
    localStream,
    remotePeers,
    micEnabled,
    cameraEnabled,
    error,
    joinCall,
    leaveCall,
    toggleMic,
    toggleCamera,
  };
}
