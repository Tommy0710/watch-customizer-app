'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

// Hàm ghép 2 ảnh thành 1 bằng HTML5 Canvas ngay trên trình duyệt
const mergeImagesWithCanvas = async (strapUrl: string, faceBase64: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject("Không hỗ trợ Canvas");

    const strapImg = new Image();
    const faceImg = new Image();

    // Cần crossOrigin để lấy ảnh từ link bên ngoài (WooCommerce) mà không bị chặn CORS
    strapImg.crossOrigin = "anonymous"; 

    // Khi ảnh dây tải xong
    strapImg.onload = () => {
      canvas.width = strapImg.width;
      canvas.height = strapImg.height;

      // 1. Vẽ dây đồng hồ làm nền
      ctx.drawImage(strapImg, 0, 0, canvas.width, canvas.height);

      // Khi ảnh mặt đồng hồ tải xong
      faceImg.onload = () => {
        // 2. Tính toán cho mặt đồng hồ chiếm 40% chiều rộng của tấm ảnh dây
        const faceTargetWidth = canvas.width * 0.4; 
        const faceTargetHeight = (faceImg.height / faceImg.width) * faceTargetWidth;
        
        const x = (canvas.width - faceTargetWidth) / 2;
        const y = (canvas.height - faceTargetHeight) / 2;

        // 3. Vẽ mặt đồng hồ đè lên giữa sợi dây
        ctx.drawImage(faceImg, x, y, faceTargetWidth, faceTargetHeight);

        // 4. Xuất ảnh định dạng JPEG với nén 80% để gửi API siêu nhanh và không bị lỗi 413
        const compositeBase64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(compositeBase64);
      };
      
      faceImg.src = faceBase64;
    };

    strapImg.onerror = () => reject("Lỗi khi tải ảnh dây đồng hồ");
    faceImg.onerror = () => reject("Lỗi khi tải ảnh mặt đồng hồ");
    
    strapImg.src = strapUrl;
  });
};

export default function CombineSection() {
  const { selectedStrap, uploadedFace } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const handleCombine = async () => {
    console.log("--- DEBUG COMBINE ---");
    console.log("Strap Image URL:", selectedStrap?.image);
    console.log("Face Image (Base64):", uploadedFace ? "Đã có dữ liệu" : "Trống");

    if (!selectedStrap) return alert("Vui lòng chọn 1 mẫu dây đồng hồ ở Bước 1!");
    if (!uploadedFace) return alert("Vui lòng tải lên mặt đồng hồ ở Bước 2!");

    setIsGenerating(true);
    try {
      // 1. Chạy hàm ghép thô 2 ảnh lại thành 1
      const compositeBase64 = await mergeImagesWithCanvas(selectedStrap.image, uploadedFace);
      
      // 2. Gửi bức ảnh đã ghép cho AI
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compositeImage: compositeBase64 
        }),
      });

      // 3. Bắt lỗi cứng từ máy chủ (Tránh lỗi SyntaxError JSON)
      if (!response.ok) {
        const errorText = await response.text(); 
        console.error("Lỗi Server:", errorText);
        alert(`Server báo lỗi (${response.status}). Vui lòng thử lại!`);
        setIsGenerating(false);
        return;
      }

      // 4. Xử lý kết quả trả về
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
      <div className="p-4 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
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
             <img src={resultImage} alt="Kết quả AI" className="w-full h-full object-contain shadow-lg" />
          ) : (
            <p className="text-center text-sm px-4">Kết quả kết hợp bằng AI sẽ hiển thị tại đây sau khi bạn nhấn Combine.</p>
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