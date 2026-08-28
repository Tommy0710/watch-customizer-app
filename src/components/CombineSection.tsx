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
  const [zoomScale, setZoomScale] = useState(100);

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

  // Reset zoom level to 100% and listen for Escape key when opening zoom modal
  useEffect(() => {
    if (!showZoomModal) return;
    setZoomScale(100);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowZoomModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showZoomModal]);

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

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.min(prev + 25, 300));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.max(prev - 25, 50));
  };

  const handleZoomReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale(100);
  };

  return (
    <>
      {/* RIGHT COLUMN - Result */}
      <div className="p-4 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
        <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
          3. Generated Result
        </h2>
        <div className="flex-1 w-full rounded-xl flex flex-col items-center justify-between text-gray-400 bg-white overflow-hidden p-3 relative min-h-0">

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
              {/* Image Preview Container with borderless clean background */}
              <div 
                className="flex-1 w-full min-h-0 flex items-center justify-center cursor-zoom-in group relative p-2 overflow-hidden"
                onClick={() => setShowZoomModal(true)}
                title="Nhấp để phóng to"
              >
                <img 
                  src={resultImage} 
                  alt="Generated result" 
                  className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" 
                />
                
                {/* Magnifying Glass Floating Trigger */}
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowZoomModal(true); }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center shadow-md backdrop-blur-sm transition-all cursor-pointer"
                  title="Phóng to"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
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

      {/* HD ZOOM LIGHTBOX MODAL WITH INTERACTIVE SCROLL & ZOOM CONTROLS */}
      {showZoomModal && resultImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-start overflow-hidden p-3 sm:p-4"
          onClick={() => setShowZoomModal(false)}
        >
          {/* Top Floating Bar with Controls */}
          <div 
            className="w-full max-w-2xl flex items-center justify-between z-20 px-4 py-2 bg-zinc-900/90 backdrop-blur-md rounded-full border border-white/10 shadow-2xl text-white mb-2 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Zoom Controls: -, 100%, + */}
            <div className="flex items-center gap-1.5 bg-black/40 rounded-full px-2 py-1 border border-white/10">
              <button
                onClick={handleZoomOut}
                disabled={zoomScale <= 50}
                className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
                title="Thu nhỏ (-)"
              >
                −
              </button>
              <button
                onClick={handleZoomReset}
                className="px-2.5 py-1 rounded text-xs font-mono font-medium hover:bg-zinc-800 text-gray-200 transition-colors cursor-pointer"
                title="Khôi phục 100%"
              >
                {zoomScale}%
              </button>
              <button
                onClick={handleZoomIn}
                disabled={zoomScale >= 300}
                className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
                title="Phóng to (+)"
              >
                +
              </button>
            </div>

            {/* Actions: Download & Close */}
            <div className="flex items-center gap-2">
              <button 
                onClick={handleDownload}
                className="px-4 py-1.5 bg-white text-black text-xs font-semibold rounded-full hover:bg-gray-200 cursor-pointer shadow-sm transition-colors"
              >
                Download
              </button>
              <button 
                onClick={() => setShowZoomModal(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors"
                title="Đóng (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable Viewport — allows scrolling smoothly from top buckle down to bottom tail tip when zoomed in! */}
          <div 
            className="flex-1 w-full overflow-y-auto overflow-x-auto flex items-start justify-center p-2 sm:p-4 cursor-zoom-out"
          >
            <div 
              className="flex flex-col items-center justify-center m-auto transition-all duration-200 ease-out py-6"
              style={{
                height: `${zoomScale * 0.8}vh`,
                minHeight: zoomScale <= 100 ? '0px' : `${zoomScale * 0.8}vh`,
              }}
            >
              <img 
                src={resultImage} 
                alt="High-Res Result" 
                className="h-full w-auto max-w-none object-contain rounded shadow-2xl select-none"
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}