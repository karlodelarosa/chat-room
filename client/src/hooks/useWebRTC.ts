import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { RemotePeer, VideoJoinResult } from '../types';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface PeerEntry {
  pc: RTCPeerConnection;
  username: string;
}

export function useWebRTC(
  socket: Socket | null,
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
      if (existing) return existing.pc;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;

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
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          removePeer(remoteSocketId);
        }
      };

      peersRef.current.set(remoteSocketId, { pc, username: remoteUsername });
      return pc;
    },
    [socket, roomId, removePeer],
  );

  const createAndSendOffer = useCallback(
    async (remoteSocketId: string, remoteUsername: string) => {
      if (!socket || !roomId) return;

      const pc = createPeerConnection(remoteSocketId, remoteUsername);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', { roomId, to: remoteSocketId, offer });
    },
    [socket, roomId, createPeerConnection],
  );

  const handleOffer = useCallback(
    async (from: string, fromUsername: string, offer: RTCSessionDescriptionInit) => {
      if (!socket || !roomId || !isInCallRef.current) return;

      const pc = createPeerConnection(from, fromUsername);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc-answer', { roomId, to: from, answer });
    },
    [socket, roomId, createPeerConnection],
  );

  const handleAnswer = useCallback(async (from: string, answer: RTCSessionDescriptionInit) => {
    const entry = peersRef.current.get(from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(answer);
  }, []);

  const handleIce = useCallback(async (from: string, candidate: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(from);
    if (!entry) return;
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      // ICE candidates can arrive before remote description is set
    }
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
  }, [socket, roomId, chatJoined, removePeer, handleOffer, handleAnswer, handleIce]);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

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
