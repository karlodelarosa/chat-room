import { useEffect, useRef, useState } from 'react';
import { compressImage } from '../utils/compressImage';
import './CameraModal.css';

interface CameraModalProps {
  onClose: () => void;
  onSend: (imageData: string, caption?: string) => void;
}

export default function CameraModal({ onClose, onSend }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setError('Camera access denied or unavailable. Check browser permissions.');
      }
    }

    startCamera();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    setPreview(canvas.toDataURL('image/jpeg', 0.85));
  }

  function handleRetake() {
    setPreview(null);
  }

  async function handleSend() {
    if (!preview || sending) return;
    setSending(true);
    try {
      const compressed = await compressImage(preview);
      onSend(compressed, caption.trim() || undefined);
      onClose();
    } catch {
      setError('Failed to process image. Try again.');
      setSending(false);
    }
  }

  return (
    <div className="camera-modal__overlay" onClick={onClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="camera-modal__header">
          <h2>Camera</h2>
          <button type="button" className="camera-modal__close" onClick={onClose}>
            ✕
          </button>
        </div>

        {error ? (
          <p className="camera-modal__error">{error}</p>
        ) : (
          <div className="camera-modal__viewport">
            {preview ? (
              <img src={preview} alt="Captured" className="camera-modal__preview" />
            ) : (
              <video
                ref={videoRef}
                className="camera-modal__video"
                autoPlay
                playsInline
                muted
              />
            )}
          </div>
        )}

        {!error && (
          <>
            <input
              className="camera-modal__caption"
              placeholder="Add a caption (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
            />

            <div className="camera-modal__actions">
              {preview ? (
                <>
                  <button type="button" className="camera-modal__btn secondary" onClick={handleRetake}>
                    Retake
                  </button>
                  <button
                    type="button"
                    className="camera-modal__btn primary"
                    onClick={handleSend}
                    disabled={sending}
                  >
                    {sending ? 'Sending…' : 'Send Photo'}
                  </button>
                </>
              ) : (
                <button type="button" className="camera-modal__btn primary" onClick={handleCapture}>
                  Capture
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
