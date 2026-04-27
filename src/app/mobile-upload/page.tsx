'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function Step({ num, label, active }: { num: number; label: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${active ? 'bg-amber-400 text-gray-900' : 'bg-gray-800 text-gray-600'}`}>
        {num}
      </div>
      <span className={`text-xs transition-colors ${active ? 'text-amber-400' : 'text-gray-600'}`}>{label}</span>
    </div>
  );
}

function WatchGuide() {
  return (
    <div className="relative w-full h-full bg-gray-900 rounded-3xl overflow-hidden flex items-center justify-center">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Corner bracket markers */}
      {[
        'top-3 left-3 border-t-2 border-l-2 rounded-tl-lg',
        'top-3 right-3 border-t-2 border-r-2 rounded-tr-lg',
        'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-lg',
        'bottom-3 right-3 border-b-2 border-r-2 rounded-br-lg',
      ].map((cls, i) => (
        <div key={i} className={`absolute w-7 h-7 border-amber-400/70 ${cls}`} />
      ))}

      {/* Watch face target zone */}
      <div className="relative z-10 w-[72%] aspect-square">
        {/* Pulsing glow ring */}
        <div className="absolute inset-[-4px] rounded-full border-2 border-amber-400/20 animate-ping" />

        {/* Main guide circle */}
        <div className="absolute inset-0 rounded-full border-2 border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.25)]" />

        {/* Clock-position tick marks */}
        {/* 12 o'clock */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-0.5 h-3 bg-amber-400 rounded-full" />
        {/* 3 o'clock */}
        <div className="absolute top-1/2 right-0 translate-x-1 -translate-y-1/2 h-0.5 w-3 bg-amber-400 rounded-full" />
        {/* 6 o'clock */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-0.5 h-3 bg-amber-400 rounded-full" />
        {/* 9 o'clock */}
        <div className="absolute top-1/2 left-0 -translate-x-1 -translate-y-1/2 h-0.5 w-3 bg-amber-400 rounded-full" />

        {/* Center crosshair */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-8 h-8">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-amber-400/50" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-400/50" />
            <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-amber-400 -translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* Label inside circle */}
        <div className="absolute bottom-[18%] inset-x-0 text-center">
          <span className="text-amber-400 text-[11px] font-semibold tracking-wide">MẶT ĐỒNG HỒ VÀO ĐÂY</span>
        </div>
      </div>

      {/* Down-pointing arrow hints at corners */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 opacity-40">
        <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-amber-400" />
        <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-amber-400" />
      </div>
    </div>
  );
}

function Tips() {
  const items = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
      ),
      label: 'Đủ sáng',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
        </svg>
      ),
      label: 'Chụp gần',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m0 8v2a2 2 0 01-2 2h-2" />
        </svg>
      ),
      label: 'Thẳng góc',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
        </svg>
      ),
      label: 'Giữ vững',
    },
  ];

  return (
    <div className="flex justify-center gap-5 mt-5">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-gray-400">
            {item.icon}
          </div>
          <span className="text-[11px] text-gray-500">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function MobileUploadClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success'>('idle');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size < 20 * 1024) {
        alert('Ảnh chụp không đủ chất lượng. Vui lòng chụp gần hơn hoặc ở nơi đủ sáng!');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!preview || !sessionId) return;
    setStatus('uploading');
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, image: preview }),
      });
      if (res.ok) setStatus('success');
    } catch (error) {
      console.error(error);
      setStatus('idle');
    }
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
  if (status === 'success') {
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

  const step = preview ? 2 : 1;

  /* ── Main ── */
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-white">

      {/* Header */}
      <div className="px-6 pt-10 pb-4 text-center">
        <p className="text-[10px] font-bold text-amber-400 tracking-[0.2em] uppercase mb-2">
          Handdn Watch Customizer
        </p>
        <h1 className="text-2xl font-bold">Chụp Mặt Đồng Hồ</h1>
        <p className="text-gray-400 text-sm mt-1.5">
          {preview ? 'Kiểm tra ảnh rồi gửi lên máy tính' : 'Đặt mặt đồng hồ vào đúng vùng khung tròn'}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex justify-center items-center gap-3 px-6 mb-6">
        <Step num={1} label="Đặt vào khung" active={step === 1} />
        <div className="flex-1 max-w-[40px] h-px bg-gray-700" />
        <Step num={2} label="Xem lại" active={step === 2} />
        <div className="flex-1 max-w-[40px] h-px bg-gray-700" />
        <Step num={3} label="Gửi lên PC" active={false} />
      </div>

      {/* Capture / Preview area */}
      <div className="flex-1 flex flex-col items-center px-6">
        <div className="relative w-full max-w-sm aspect-square">

          {preview ? (
            /* Preview with circle overlay */
            <div className="relative w-full h-full rounded-3xl overflow-hidden">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              {/* Darken outside circle */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle 42% at 50% 50%, transparent 100%, rgba(0,0,0,0.55) 100%)',
                }}
              />
              {/* Circle border */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[72%] aspect-square rounded-full border-2 border-amber-400/70" />
              </div>
            </div>
          ) : (
            /* Guide overlay */
            <WatchGuide />
          )}

          {/* Invisible camera trigger */}
          {!preview && (
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer z-20"
            />
          )}
        </div>

        {/* Tips (only when no preview) */}
        {!preview && <Tips />}

        {/* Tap hint */}
        {!preview && (
          <p className="mt-6 text-amber-400 text-sm font-semibold animate-pulse text-center">
            Nhấn vào khung để mở camera
          </p>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-6 pb-10 pt-6 space-y-3">
        {preview ? (
          <>
            <button
              onClick={handleUpload}
              disabled={status === 'uploading'}
              className="w-full bg-amber-400 text-gray-900 font-bold py-4 rounded-2xl shadow-lg shadow-amber-400/20 hover:bg-amber-300 active:scale-[0.98] transition-all disabled:opacity-60 flex justify-center items-center gap-2 text-base"
            >
              {status === 'uploading' ? (
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
              onClick={() => setPreview(null)}
              className="w-full text-gray-400 py-3 text-sm hover:text-white transition-colors"
            >
              Chụp lại
            </button>
          </>
        ) : (
          <p className="text-center text-gray-600 text-xs">
            Hoặc nhấn giữ để chọn ảnh từ thư viện
          </p>
        )}
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
