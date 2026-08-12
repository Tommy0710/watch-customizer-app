'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

// Rotating status text shown while /api/generate is running (~30-50s for FLUX-2-PRO) — describes
// the real pipeline order (see route.ts steps 1-6) so it stays honest, not a fake progress bar.
const PROCESSING_STEPS: { afterSeconds: number; label: string }[] = [
  { afterSeconds: 0, label: 'Reading strap texture & color...' },
  { afterSeconds: 8, label: 'Matching watch case & dial...' },
  { afterSeconds: 18, label: 'Assembling the wristwatch...' },
  { afterSeconds: 30, label: 'Finalizing details — almost there...' },
];

// Merges the strap + face images into one via HTML5 Canvas, client-side
const mergeImagesWithCanvas = async (strapUrl: string, faceBase64: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject("Canvas not supported");

    const strapImg = new Image();
    const faceImg = new Image();

    // crossOrigin is required to read pixels from an external URL (WooCommerce) without CORS errors
    strapImg.crossOrigin = "anonymous";

    // Once the strap image has loaded
    strapImg.onload = () => {
      canvas.width = strapImg.width;
      canvas.height = strapImg.height;

      // 1. Draw the strap as the background
      ctx.drawImage(strapImg, 0, 0, canvas.width, canvas.height);

      // Once the watch face image has loaded
      faceImg.onload = () => {
        // 2. Size the watch face to 40% of the strap image's width
        const faceTargetWidth = canvas.width * 0.4;
        const faceTargetHeight = (faceImg.height / faceImg.width) * faceTargetWidth;

        const x = (canvas.width - faceTargetWidth) / 2;
        const y = (canvas.height - faceTargetHeight) / 2;

        // 3. Draw the watch face centered on top of the strap
        ctx.drawImage(faceImg, x, y, faceTargetWidth, faceTargetHeight);

        // 4. Export as JPEG at 80% quality to keep the request fast and avoid 413 errors
        const compositeBase64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(compositeBase64);
      };

      faceImg.src = faceBase64;
    };

    strapImg.onerror = () => reject("Failed to load the strap image");
    faceImg.onerror = () => reject("Failed to load the watch face image");

    strapImg.src = strapUrl;
  });
};

export default function CombineSection() {
  const { selectedStrap, uploadedFace, cachedFaceCrop, setCachedFaceCrop } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
    .find((step) => elapsedSeconds >= step.afterSeconds)!.label;

  const handleCombine = async () => {
    console.log("--- DEBUG COMBINE ---");
    console.log("Strap Image URL:", selectedStrap?.image);
    console.log("Face Image (Base64):", uploadedFace ? "Has data" : "Empty");

    if (!selectedStrap) return alert("Please select a watch strap in Step 1!");
    if (!uploadedFace) return alert("Please upload a watch face in Step 2!");

    setIsGenerating(true);
    try {
      // 1. Run the client-side rough merge of the two images into one
      //const compositeBase64 = await mergeImagesWithCanvas(selectedStrap.image, uploadedFace);

      // 2. Send the merged image to the server for processing
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strapImage: selectedStrap.image, // URL (e.g. https://cdn.handdn.com/...)
          // Only used by the LoRA engine, to find this strap's clean studio render. The PRO path
          // ignores it and works from the catalog photo exactly as before.
          strapId: selectedStrap.id,
          // Reuse a previously server-cropped face (from an earlier Combine with the same photo)
          // when available, so /api/generate can skip re-running watch-face detection.
          faceImage: cachedFaceCrop ?? uploadedFace,
          faceAlreadyCropped: !!cachedFaceCrop,
          strapName: selectedStrap.name,
          strapCategories: (selectedStrap.categories || []).map((c) => c.name),
          strapAttributes: selectedStrap.attributes || [],
        }),
      });

      // 3. Hard-fail on a non-OK server response (avoids a JSON SyntaxError downstream)
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Server error:", errorText);
        alert(`Something went wrong (${response.status}). Please try again!`);
        setIsGenerating(false);
        return;
      }

      // 4. Handle the returned result
      const data = await response.json();
      if (data.success) {
        setResultImage(data.resultImage);
        if (data.croppedFace && !cachedFaceCrop) {
          setCachedFaceCrop(data.croppedFace);
        }
      } else {
        alert("Something went wrong: " + data.error);
      }
    } catch (error) {
      console.error(error);
      alert("Something went wrong. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* RIGHT COLUMN - Result */}
      <div className="p-4 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
        <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
          3. Generated Result
        </h2>
        <div className="flex-1 w-full rounded-lg flex items-center justify-center text-gray-400 bg-white border border-gray-100 shadow-sm overflow-hidden p-4 relative">

          {isGenerating ? (
            <div className="flex flex-col items-center gap-4">
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
             <img src={resultImage} alt="Generated result" className="w-full h-full object-contain" />
          ) : (
            <p className="text-center text-sm px-4">Your combined result will appear here after you press Combine.</p>
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
    </>
  );
}