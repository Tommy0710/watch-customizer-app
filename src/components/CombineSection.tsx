'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

export default function CombineSection() {
  const { selectedStrap, uploadedFace } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const handleCombine = async () => {
    if (!selectedStrap) return alert("Vui lòng chọn 1 mẫu dây đồng hồ ở Bước 1!");
    if (!uploadedFace) return alert("Vui lòng tải lên mặt đồng hồ ở Bước 2!");

    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strapImage: selectedStrap.image, // URL ảnh gốc dây đồng hồ
          faceImage: uploadedFace,         // Base64 hoặc URL của ảnh khách chụp
        }),
      });

      const data = await response.json();
      if (data.success) {
        setResultImage(data.resultImage);
      } else {
        alert("Lỗi AI: " + data.error);
      }
    } catch (error) {
      console.error(error);
      alert("Đã xảy ra lỗi khi kết nối tới AI.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* CỘT PHẢI - Kết quả AI */}
      <div className="p-6 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
        <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
          3. AI Generated Result
        </h2>
        <div className="flex-1 w-full rounded-lg flex items-center justify-center text-gray-400 bg-white border border-gray-100 shadow-sm overflow-hidden p-4 relative">
          
          {isGenerating ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-black font-semibold uppercase tracking-widest">AI đang thiết kế...</p>
            </div>
          ) : resultImage ? (
             <img src={resultImage} alt="Kết quả AI" className="w-full h-full object-contain" />
          ) : (
            <p className="text-center">Kết quả kết hợp bằng AI sẽ hiển thị tại đây sau khi bạn nhấn Combine.</p>
          )}

        </div>
      </div>

      {/* NÚT COMBINE */}
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