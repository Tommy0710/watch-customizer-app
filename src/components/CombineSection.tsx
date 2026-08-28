'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

// Rotating status text shown while /api/generate is running
const PROCESSING_STEPS: { afterSeconds: number; label: string }[] = [
  { afterSeconds: 0, label: 'Reading strap texture & color...' },
  { afterSeconds: 4, label: 'Matching watch case & dial...' },
  { afterSeconds: 8, label: 'Assembling the wristwatch...' },
  { afterSeconds: 15, label: 'Finalizing details — almost there...' },
];

export default function CombineSection() {
  const { selectedStrap, uploadedFace, cachedFaceCrop, setCachedFaceCrop } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showZoomModal, setShowZoomModal] = useState(false);

  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      return;
    }
    const intervalId = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isGenerating]);

  const currentStepLabel = [...PROCESSING_STEPS]
    .reverse()
    .find((step) => elapsedSeconds >= step.afterSeconds)?.label ?? 'Processing...';

  const handleCombine = async () => {
    if (!selectedStrap) return alert("Please select a watch strap in Step 1!");
    if (!uploadedFace) return alert("Please upload a watch face in Step 2!");

    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strapImage: selectedStrap.image,
          strapId: selectedStrap.id,
          faceImage: cachedFaceCrop ?? uploadedFace,
          faceAlreadyCropped: !!cachedFaceCrop,
          strapName: selectedStrap.name,
          strapCategories: (selectedStrap.categories || []).map((c) => c.name),
          strapAttributes: selectedStrap.attributes || [],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Server error:", errorText);
        alert(`Something went wrong (${response.status}). Please try again!`);
        setIsGenerating(false);
        return;
      }

      const data = await response.json();
      if (data.success) {
        setResultImage(data.resultImage);
        if (data.croppedFace && !cachedFaceCrop) {
          setCachedFaceCrop(data.croppedFace);
        }
      } else {
        alert("Something went wrong: " + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error(error);
      alert("Something went wrong. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `handdn-custom-watch-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const productUrl = selectedStrap?.link || (selectedStrap?.id ? `https://handdn.com/?p=${selectedStrap.id}` : null);

  return (
    <>
      {/* RIGHT COLUMN - Result */}
      <div className="p-4 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
        <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
          3. Generated Result
        </h2>
        <div className="flex-1 w-full rounded-xl flex flex-col items-center justify-between text-gray-400 bg-white border border-gray-100 shadow-sm overflow-hidden p-3 relative min-h-0">

          {isGenerating ? (
            <div className="flex-1 w-full flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 rounded-full border border-black/15 bg-white shadow-sm flex items-center justify-center">
                <div className="flex items-end gap-1 h-8">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-full rounded-full bg-black origin-bottom motion-safe:animate-[wave-bar_1s_ease-in-out_infinite]"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-black font-semibold uppercase tracking-widest motion-safe:animate-pulse">{currentStepLabel}</p>
              <p className="text-[11px] text-gray-400 tabular-nums">{elapsedSeconds}s</p>
            </div>
          ) : resultImage ? (
            <div className="relative w-full h-full flex flex-col items-center justify-between min-h-0">
              {/* Image Preview Container with comfortable padding */}
              <div 
                className="flex-1 w-full min-h-0 flex items-center justify-center cursor-zoom-in group relative p-3 overflow-hidden"
                onClick={() => setShowZoomModal(true)}
                title="Nhấp để phóng to"
              >
                <img 
                  src={resultImage} 
                  alt="Generated result" 
                  className="max-w-full max-h-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-[1.02]" 
                />
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/75 text-white text-[10px] px-2.5 py-1 rounded-full backdrop-blur-sm pointer-events-none">
                  Phóng to
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="w-full flex items-center justify-center pt-2.5 border-t border-gray-100 flex-shrink-0 bg-white">
                <button
                  onClick={handleDownload}
                  className="px-5 py-2 bg-black hover:bg-zinc-800 text-white text-xs font-medium tracking-wide rounded-md transition-colors cursor-pointer shadow-xs"
                >
                  Tải xuống
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 w-full flex items-center justify-center">
              <p className="text-center text-sm px-4">Your combined result will appear here after you press Combine.</p>
            </div>
          )}

        </div>
      </div>

      {/* COMBINE BUTTON */}
      <button 
        onClick={handleCombine}
        disabled={isGenerating || !selectedStrap || !uploadedFace}
        className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full flex items-center justify-center shadow-lg border-4 border-white z-20 transition-transform duration-300 ${
          isGenerating || !selectedStrap || !uploadedFace 
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed scale-95' 
            : 'bg-black text-white hover:scale-105 cursor-pointer'
        }`}
      >
        <span className="text-xs font-bold tracking-widest text-center">
          {isGenerating ? 'WAIT' : 'COMBINE'}
        </span>
      </button>

      {/* HD ZOOM LIGHTBOX MODAL */}
      {showZoomModal && resultImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setShowZoomModal(false)}
        >
          <div className="relative max-w-4xl max-h-[92vh] flex flex-col items-center">
            <img 
              src={resultImage} 
              alt="High-Res Result" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <div className="flex items-center gap-4 mt-3">
              <button 
                onClick={handleDownload}
                className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-full hover:bg-gray-200 cursor-pointer"
              >
                Tải xuống
              </button>
              <button 
                onClick={() => setShowZoomModal(false)}
                className="px-4 py-2 bg-zinc-800 text-white text-xs font-semibold rounded-full hover:bg-zinc-700 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}