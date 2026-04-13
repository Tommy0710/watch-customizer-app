'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { QRCodeSVG } from 'qrcode.react';

export default function FaceUploader() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [uploadLink, setUploadLink] = useState<string>('');

  // Khởi tạo Session ID ngẫu nhiên khi component load
  useEffect(() => {
    // Dùng crypto.randomUUID có sẵn của trình duyệt để tạo ID độc nhất
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    
    // Tạo link dành riêng cho điện thoại (Chúng ta sẽ làm trang này sau)
    // VD: https://localhost:3000/mobile-upload?session=...
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    setUploadLink(`${currentOrigin}/mobile-upload?session=${newSessionId}`);
    
    // TODO: Bắt đầu gọi API Polling để chờ ảnh từ điện thoại ở đây
  }, []);

  // Xử lý khi khách hàng Kéo/Thả hoặc Chọn file trên máy tính
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0]; // Chỉ lấy file đầu tiên
      
      // Tạo URL tạm thời để hiển thị ảnh ngay lập tức
      const imageUrl = URL.createObjectURL(file);
      setUploadedImage(imageUrl);
      
      // TODO: Lưu file này vào state tổng (Zustand) để mang đi Combine AI
    }
  }, []);

  // Cấu hình Dropzone: Chỉ nhận ảnh, tối đa 1 file
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  });

  // Nút xóa ảnh để upload lại
  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation(); // Tránh kích hoạt Dropzone khi bấm nút xóa
    setUploadedImage(null);
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-white rounded-lg border border-gray-100 shadow-sm p-4 overflow-hidden relative">
      
      {uploadedImage ? (
        // ==========================================
        // TRẠNG THÁI 2: ĐÃ CÓ ẢNH (Hiển thị ảnh)
        // ==========================================
        <div className="relative w-full h-full flex flex-col items-center justify-center group">
          <div className="relative w-[80%] aspect-square rounded-full overflow-hidden border-4 border-gray-100 shadow-inner">
            <img 
              src={uploadedImage} 
              alt="Customer Watch Face" 
              className="w-full h-full object-cover"
            />
          </div>
          <button 
            onClick={handleRemoveImage}
            className="absolute top-2 right-2 bg-white/90 backdrop-blur text-red-500 hover:bg-red-50 hover:text-red-600 px-3 py-1.5 rounded-md text-xs font-medium shadow-sm transition-colors border border-gray-200"
          >
            Change Image
          </button>
          <p className="mt-4 text-xs text-gray-500 font-medium">Watch Face Ready</p>
        </div>

      ) : (
        // ==========================================
        // TRẠNG THÁI 1: CHƯA CÓ ẢNH (Khu vực Upload & QR)
        // ==========================================
        <div className="w-full h-full flex flex-col items-center justify-center gap-6">
          
          {/* Khu vực Kéo thả ảnh (Desktop) */}
          <div 
            {...getRootProps()} 
            className={`w-full flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragActive ? 'border-black bg-gray-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50/50'
            }`}
          >
            <input {...getInputProps()} />
            <div className="w-12 h-12 mb-3 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-800">Drop your watch face here</p>
            <p className="text-[10px] text-gray-400 mt-1">Supports JPG, PNG (Max 5MB)</p>
          </div>

          {/* Dải phân cách */}
          <div className="w-full flex items-center gap-3 opacity-60">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Or use phone</span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          {/* Khu vực quét mã QR */}
          <div className="w-full flex items-center justify-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
            <div className="p-1.5 bg-white rounded-lg shadow-sm border border-gray-200">
              {uploadLink && (
                <QRCodeSVG 
                  value={uploadLink} 
                  size={70} 
                  bgColor={"#ffffff"}
                  fgColor={"#000000"}
                  level={"L"}
                />
              )}
            </div>
            <div className="flex flex-col text-left">
              <p className="text-xs font-semibold text-gray-900 leading-tight">Scan to take a photo</p>
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">Point your phone camera here<br/>to capture your watch directly.</p>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}