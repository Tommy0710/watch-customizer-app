'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function MobileUploadClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success'>('idle');

  // Khi khách chụp ảnh xong
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Chuyển ảnh thành định dạng Base64 để gửi qua API
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Nút bấm Gửi lên máy tính
  const handleUpload = async () => {
    if (!preview || !sessionId) return;
    setStatus('uploading');
    
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, image: preview })
      });
      
      if (res.ok) {
        setStatus('success');
      }
    } catch (error) {
      console.error(error);
      setStatus('idle');
    }
  };

  if (!sessionId) {
    return <div className="p-10 text-center text-red-500 font-medium">Link không hợp lệ! Vui lòng quét lại mã QR trên màn hình máy tính.</div>;
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-white text-center">
        <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">Upload Thành Công!</h1>
        <p className="text-gray-400">Hình ảnh đã được gửi lên màn hình máy tính của bạn. Hãy xem màn hình máy tính nhé.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 text-gray-800 font-sans">
      <h1 className="text-xl font-bold mb-6 text-center tracking-tight">Handdn Watch Customizer</h1>
      
      {/* Vùng xem trước ảnh */}
      <div className="w-full max-w-sm aspect-square bg-white border-2 border-dashed border-gray-300 rounded-2xl mb-8 flex items-center justify-center overflow-hidden relative shadow-sm">
        {preview ? (
          <img src={preview} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center p-6">
             <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
             </div>
             <p className="text-sm font-medium text-gray-500">Chụp hoặc Chọn ảnh mặt đồng hồ của bạn</p>
          </div>
        )}
        
        {/* Nút Chọn ảnh ẨN (Trải đều ra toàn bộ vùng viền đứt) */}
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" // Gợi ý trình duyệt mở Camera sau
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {/* Nút Upload */}
      {preview && (
        <button 
          onClick={handleUpload} 
          disabled={status === 'uploading'}
          className="w-full max-w-sm bg-black text-white font-semibold py-4 rounded-xl shadow-lg hover:bg-gray-800 transition-colors disabled:bg-gray-400 flex justify-center items-center gap-2"
        >
          {status === 'uploading' ? (
             <>
               <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
               Đang gửi...
             </>
          ) : 'Gửi lên Màn hình máy tính'}
        </button>
      )}
    </div>
  );
}

export default function MobileUploadPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <MobileUploadClient />
    </Suspense>
  );
}