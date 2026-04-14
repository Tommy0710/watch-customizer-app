'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { QRCodeSVG } from 'qrcode.react';
import Cropper from 'react-easy-crop';
import { useAppStore } from '@/store/useAppStore'; // IMPORT KHO TRẠNG THÁI ZUSTAND

export default function FaceUploader() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [uploadLink, setUploadLink] = useState<string>('');
  
  // Lấy hàm cập nhật ảnh từ Zustand
  const { setUploadedFace } = useAppStore();

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // 1. Kiểm tra ảnh từ điện thoại gửi lên (Polling)
  useEffect(() => {
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    setUploadLink(`${currentOrigin}/mobile-upload?session=${newSessionId}`);

    const checkUpload = async () => {
      try {
        const res = await fetch(`/api/upload?sessionId=${newSessionId}`);
        const data = await res.json();
        
        if (data.success && data.image) {
          setUploadedImage(data.image); // Ảnh này đã là Base64 từ điện thoại
          setUploadedFace(data.image);  // Cập nhật luôn vào Store để sẵn sàng Combine
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error("Lỗi khi kiểm tra ảnh:", err);
      }
    };

    let intervalId = setInterval(checkUpload, 2500);
    return () => clearInterval(intervalId);
  }, [setUploadedFace]);

  // 2. Xử lý Kéo Thả / Upload trực tiếp bằng FileReader (Base64)
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      
      // Kiểm tra dung lượng
      if (file.size < 20 * 1024) {
        alert("Ảnh quá mờ hoặc dung lượng quá thấp. Vui lòng chọn ảnh rõ nét hơn!");
        return;
      }

      // Đọc file thành Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;

        // Kiểm tra kích thước hình ảnh
        const img = new Image();
        img.src = base64String;
        img.onload = () => {
          if (img.width < 400 || img.height < 400) {
            alert(`Kích thước ảnh là ${img.width}x${img.height}. Yêu cầu tối thiểu 400x400 pixel!`);
            return;
          }
          
          // Hoàn tất kiểm tra -> Cập nhật UI và Store
          setUploadedImage(base64String);
          setUploadedFace(base64String);
        };
      };
      
      // Kích hoạt việc đọc file
      reader.readAsDataURL(file);
    }
  }, [setUploadedFace]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  });

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadedImage(null);
    setUploadedFace(null); // Xóa ảnh khỏi Store
    setZoom(1);
    setRotation(0);
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-white overflow-hidden relative">
      
      {uploadedImage ? (
        <div className="relative w-full h-full flex flex-col">
          {/* VÙNG CHỈNH SỬA ẢNH */}
          <div className="relative flex-1 w-full bg-gray-900 rounded-lg overflow-hidden border border-gray-200">
            <Cropper
              image={uploadedImage}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              showGrid={false}
              cropShape="round" // Tạo vùng cắt hình tròn
            />
            
            {/* VECTOR KHUNG ĐỒNG HỒ OVERLAY (Không cho phép tương tác để click xuyên qua ảnh) */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
              <svg 
                viewBox="0 0 100 100" 
                className="w-[85%] h-[85%] text-white/50"
                fill="none" 
                stroke="currentColor" 
                strokeWidth="0.5"
              >
                {/* Vòng ngoài vỏ đồng hồ */}
                <circle cx="50" cy="50" r="48" strokeDasharray="2 1" />
                {/* Vòng mặt số chuẩn */}
                <circle cx="50" cy="50" r="40" className="text-yellow-500/80" strokeWidth="1" />
                {/* Tâm điểm */}
                <circle cx="50" cy="50" r="1" fill="currentColor" />
                {/* Các vạch chỉ giờ */}
                {[...Array(12)].map((_, i) => (
                  <line 
                    key={i}
                    x1="50" y1="12" x2="50" y2="15" 
                    transform={`rotate(${i * 30} 50 50)`} 
                  />
                ))}
              </svg>
            </div>
            
            <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/70 bg-black/50 px-2 py-1 rounded-full z-20 pointer-events-none">
              Drag to move • Scroll to zoom
            </p>
          </div>

          {/* BỘ ĐIỀU KHIỂN (CONTROLS) */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-400 uppercase w-10">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-400 uppercase w-10">Rotate</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
              />
            </div>
          </div>

          <div className="flex justify-between items-center mt-3">
            <button 
              onClick={handleRemoveImage}
              className="text-red-500 hover:text-red-600 text-[11px] font-semibold"
            >
              Remove
            </button>
            <span className="text-[11px] text-gray-400">Align face to center</span>
          </div>
        </div>
      ) : (
        /* PHẦN UPLOAD (GIỮ NGUYÊN NHƯ CŨ) */
        <div className="w-full h-full flex flex-col items-center justify-center gap-6">
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

          <div className="w-full flex items-center gap-3 opacity-60">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">Or use phone</span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          <div className="w-full flex items-center justify-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
            <div className="p-1.5 bg-white rounded-lg shadow-sm border w-[84px] h-[84px] border-gray-200">
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