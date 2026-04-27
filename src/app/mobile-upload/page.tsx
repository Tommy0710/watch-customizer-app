'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

type CameraState = 'requesting' | 'active' | 'denied' | 'unavailable';

function MobileUploadClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success'>('idle');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraState('requesting');
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraState('active');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setCameraState(name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    startCamera();
    return () => stopCamera();
  }, [sessionId, startCamera, stopCamera]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Center-crop to square
    const ox = (video.videoWidth - size) / 2;
    const oy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, ox, oy, size, size, 0, 0, size, size);

    setPreview(canvas.toDataURL('image/jpeg', 0.92));
    stopCamera();
  }, [stopCamera]);

  const retake = useCallback(() => {
    setPreview(null);
    startCamera();
  }, [startCamera]);

  const handleUpload = async () => {
    if (!preview || !sessionId) return;
    setUploadStatus('uploading');
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, image: preview }),
      });
      if (res.ok) setUploadStatus('success');
    } catch (err) {
      console.error(err);
      setUploadStatus('idle');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size < 20 * 1024) {
      alert('Ảnh không đủ chất lượng. Chụp gần hơn hoặc ở nơi đủ sáng!');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  /* ── Invalid link ── */
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-red-400 font-semibold">Link không hợp lệ!</p>
          <p className="text-gray-500 text-sm mt-1">Vui lòng quét lại mã QR trên màn hình máy tính.</p>
        </div>
      </div>
    );
  }

  /* ── Success ── */
  if (uploadStatus === 'success') {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/30">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Gửi Thành Công!</h1>
        <p className="text-gray-400 max-w-xs text-sm">
          Hình ảnh mặt đồng hồ đã được gửi lên màn hình máy tính. Hãy xem màn hình để tiếp tục nhé.
        </p>
      </div>
    );
  }

  /* ── Main ── */
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-white">

      {/* Header */}
      <div className="px-6 pt-10 pb-4 text-center">
        <p className="text-[10px] font-bold text-amber-400 tracking-[0.2em] uppercase mb-2">
          Handdn Watch Customizer
        </p>
        <h1 className="text-2xl font-bold">
          {preview ? 'Xem Lại Ảnh' : 'Chụp Mặt Đồng Hồ'}
        </h1>
        <p className="text-gray-400 text-sm mt-1.5">
          {preview
            ? 'Ảnh đã được khoanh vùng. Gửi hoặc chụp lại.'
            : 'Đặt mặt đồng hồ khớp vào vòng tròn rồi nhấn chụp'}
        </p>
      </div>

      {/* Viewfinder / Preview */}
      <div className="flex-1 flex flex-col items-center px-6">
        <div className="relative w-full max-w-sm aspect-square">

          {preview ? (
            /* ── Static preview ── */
            <div className="relative w-full h-full rounded-3xl overflow-hidden">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              {/* Vignette outside circle */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(circle 38% at 50% 50%, transparent 100%, rgba(0,0,0,0.6) 100%)' }}
              />
              {/* Circle border */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[72%] aspect-square rounded-full border-2 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.3)]" />
              </div>
            </div>
          ) : (
            /* ── Live camera viewfinder ── */
            <div className="relative w-full h-full rounded-3xl overflow-hidden bg-black">

              {/* Live video stream */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Vignette outside circle (only when active) */}
              {cameraState === 'active' && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: 'radial-gradient(circle 38% at 50% 50%, transparent 100%, rgba(0,0,0,0.6) 100%)' }}
                />
              )}

              {/* Guide ring overlay */}
              {cameraState === 'active' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-[72%] aspect-square">

                    {/* Animated outer pulse */}
                    <div className="absolute inset-[-4px] rounded-full border border-amber-400/25 animate-ping" />

                    {/* Main guide ring */}
                    <div className="absolute inset-0 rounded-full border-2 border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.35)]" />

                    {/* Tick marks at 12 / 3 / 6 / 9 */}
                    <div className="absolute top-0     left-1/2  -translate-x-1/2 -translate-y-1   w-0.5 h-3 bg-amber-400 rounded-full" />
                    <div className="absolute top-1/2  right-0   translate-x-1    -translate-y-1/2  h-0.5 w-3 bg-amber-400 rounded-full" />
                    <div className="absolute bottom-0 left-1/2  -translate-x-1/2  translate-y-1    w-0.5 h-3 bg-amber-400 rounded-full" />
                    <div className="absolute top-1/2  left-0    -translate-x-1    -translate-y-1/2  h-0.5 w-3 bg-amber-400 rounded-full" />

                    {/* Center dot */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    </div>

                    {/* Label inside circle */}
                    <div className="absolute bottom-[18%] inset-x-0 text-center">
                      <span className="text-amber-400/90 text-[10px] font-bold tracking-widest drop-shadow">
                        MẶT ĐỒNG HỒ VÀO ĐÂY
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Corner bracket markers */}
              {cameraState === 'active' && (
                <>
                  <div className="absolute top-3 left-3  w-6 h-6 border-t-2 border-l-2 border-amber-400/60 rounded-tl-lg pointer-events-none" />
                  <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-amber-400/60 rounded-tr-lg pointer-events-none" />
                  <div className="absolute bottom-3 left-3  w-6 h-6 border-b-2 border-l-2 border-amber-400/60 rounded-bl-lg pointer-events-none" />
                  <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-amber-400/60 rounded-br-lg pointer-events-none" />
                </>
              )}

              {/* Loading */}
              {cameraState === 'requesting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-400 text-sm">Đang mở camera...</p>
                </div>
              )}

              {/* Camera denied */}
              {(cameraState === 'denied' || cameraState === 'unavailable') && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                  <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3l18 18" />
                  </svg>
                  <p className="text-gray-400 text-sm">
                    {cameraState === 'denied'
                      ? 'Camera bị chặn. Cho phép truy cập camera trong cài đặt trình duyệt.'
                      : 'Thiết bị không hỗ trợ camera trực tiếp.'}
                  </p>
                  <label className="bg-amber-400 text-gray-900 font-semibold text-sm px-5 py-2.5 rounded-xl cursor-pointer active:scale-95 transition-transform">
                    Chọn ảnh từ thư viện
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Hidden canvas for frame capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Tips row */}
        {!preview && cameraState === 'active' && (
          <div className="flex justify-center gap-6 mt-5">
            {[
              { label: 'Đủ sáng', d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z' },
              { label: 'Chụp gần', d: 'M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z' },
              { label: 'Thẳng góc', d: 'M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m0 8v2a2 2 0 01-2 2h-2' },
            ].map((tip, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tip.d} />
                  </svg>
                </div>
                <span className="text-[11px] text-gray-500">{tip.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-6 pb-10 pt-6 flex flex-col items-center gap-3">
        {preview ? (
          <>
            <button
              onClick={handleUpload}
              disabled={uploadStatus === 'uploading'}
              className="w-full max-w-sm bg-amber-400 text-gray-900 font-bold py-4 rounded-2xl shadow-lg shadow-amber-400/20 hover:bg-amber-300 active:scale-[0.98] transition-all disabled:opacity-60 flex justify-center items-center gap-2 text-base"
            >
              {uploadStatus === 'uploading' ? (
                <>
                  <div className="w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                  Đang gửi...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Gửi Lên Màn Hình Máy Tính
                </>
              )}
            </button>
            <button
              onClick={retake}
              className="text-gray-400 py-2 text-sm hover:text-white transition-colors"
            >
              Chụp lại
            </button>
          </>
        ) : cameraState === 'active' ? (
          /* Shutter button */
          <>
            <button
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full bg-white border-4 border-amber-400 shadow-xl shadow-amber-400/30 active:scale-90 transition-transform flex items-center justify-center"
              aria-label="Chụp ảnh"
            >
              <div className="w-[52px] h-[52px] rounded-full bg-amber-400" />
            </button>
            <p className="text-gray-500 text-xs">Nhấn để chụp</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function MobileUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MobileUploadClient />
    </Suspense>
  );
}
