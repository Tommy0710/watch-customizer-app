'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { QRCodeSVG } from 'qrcode.react';
import Cropper from 'react-easy-crop';
import { useAppStore } from '@/store/useAppStore';
import getCroppedImg from '@/utils/cropImage';

export default function FaceUploader() {
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string>('');
    const [uploadLink, setUploadLink] = useState<string>('');

    // Lấy hàm cập nhật ảnh từ Zustand
    const { setUploadedFace } = useAppStore();

    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);

    // State MỚI: Lưu tọa độ cắt và trạng thái đã cắt xong chưa
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
    const [isEditing, setIsEditing] = useState<boolean>(true);
    const [finalCroppedImage, setFinalCroppedImage] = useState<string | null>(null);

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
                    setUploadedImage(data.image);
                    setIsEditing(true);
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
            if (file.size < 20 * 1024) return alert("Ảnh quá mờ hoặc dung lượng quá thấp!");

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                const img = new Image();
                img.src = base64String;
                img.onload = () => {
                    if (img.width < 400 || img.height < 400) {
                        return alert(`Kích thước ảnh yêu cầu tối thiểu 400x400 pixel!`);
                    }
                    setUploadedImage(base64String);
                    setIsEditing(true); // Bật chế độ chỉnh sửa
                };
            };
            reader.readAsDataURL(file);
        }
    }, [setUploadedFace]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        maxFiles: 1,
    });
    // 3. Hàm Xử lý khi khách bấm "Xác nhận & Cắt ảnh"
    const handleConfirmCrop = async () => {
        try {
            if (!uploadedImage || !croppedAreaPixels) return;

            // Chạy hàm xử lý cắt ảnh bằng Canvas
            const croppedImageBase64 = await getCroppedImg(
                uploadedImage,
                croppedAreaPixels,
                rotation
            );

            // Lưu ảnh đã cắt siêu đẹp vào State nội bộ và Store Zustand
            setFinalCroppedImage(croppedImageBase64);
            setUploadedFace(croppedImageBase64);
            setIsEditing(false); // Tắt chế độ Edit

        } catch (e) {
            console.error("Lỗi khi cắt ảnh:", e);
            alert("Đã có lỗi xảy ra khi xử lý hình ảnh.");
        }
    };

    // 4. Hàm Reset
    const handleRemoveImage = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setUploadedImage(null);
        setFinalCroppedImage(null);
        setUploadedFace(null);
        setZoom(1);
        setRotation(0);
        setIsEditing(true);
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-white rounded-lg border border-gray-100 shadow-sm p-4 overflow-hidden relative">

            {uploadedImage && isEditing ? (
                // ==========================================
                // TRẠNG THÁI 2: ĐANG CHỈNH SỬA (EDIT MODE)
                // ==========================================
                <div className="relative w-full h-full flex flex-col">
                    <div className="relative flex-1 w-full bg-gray-900 rounded-lg overflow-hidden border border-gray-200 h-[85%] aspect-square">
                        <Cropper
                            image={uploadedImage}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotation}
                            aspect={1}
                            cropShape="round"
                            showGrid={false}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onRotationChange={setRotation}
                            onCropComplete={(area, areaPixels) => setCroppedAreaPixels(areaPixels)}
                        />
                    </div>

                    <div className="mt-3 flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-gray-400 uppercase w-10">Zoom</span>
                            <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black" />
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-gray-400 uppercase w-10">Rotate</span>
                            <input type="range" min={0} max={360} step={1} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black" />
                        </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                        <button onClick={() => handleRemoveImage()} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-md text-xs font-semibold hover:bg-gray-200 transition-colors">
                            Hủy bỏ
                        </button>
                        <button onClick={handleConfirmCrop} className="flex-1 bg-black text-white py-2 rounded-md text-xs font-bold hover:bg-gray-800 transition-colors shadow-md">
                            Xác nhận Mặt Đồng Hồ
                        </button>
                    </div>
                </div>

            ) : uploadedImage && !isEditing && finalCroppedImage ? (
                // ==========================================
                // TRẠNG THÁI 3: ĐÃ CẮT XONG (SẴN SÀNG COMBINE)
                // ==========================================
                <div className="relative w-full flex flex-col items-center justify-center py-6 group">

                    {/* Title */}
                    {/* <h3 className="mb-4 text-[11px] font-semibold text-gray-500 tracking-[0.2em] uppercase">
                        Mặt đồng hồ của bạn
                    </h3> */}

                    {/* Watch Face */}
                    <div className="relative w-[72%] max-w-[260px] aspect-square">
                        <div className="relative w-full h-full rounded-full overflow-hidden border border-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.08)] bg-white">

                            <img
                                src={finalCroppedImage}
                                alt="Watch Face"
                                className="w-full h-full object-cover"
                            />

                            {/* Glass reflection */}
                            <div className="absolute inset-0 pointer-events-none 
                bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)]
                opacity-60 mix-blend-overlay">
                            </div>
                        </div>

                        {/* subtle outer glow */}
                        <div className="absolute inset-0 rounded-full ring-1 ring-black/5"></div>
                    </div>

                    {/* Actions */}
                    <div className="mt-6 flex items-center gap-3">

                        {/* Secondary */}
                        <button
                            onClick={() => setIsEditing(true)}
                            className="px-4 py-2 text-xs font-medium text-gray-600 
            border border-gray-200 rounded-full 
            hover:bg-gray-100 transition-all">
                            Chỉnh sửa
                        </button>

                        {/* Primary */}
                        <button
                            onClick={() => handleRemoveImage()}
                            className="px-4 py-2 text-xs font-medium text-white 
            bg-black rounded-full 
            hover:bg-gray-800 transition-all shadow-sm">
                            Đổi ảnh
                        </button>
                    </div>
                </div>

            ) : (
                /* PHẦN UPLOAD (GIỮ NGUYÊN NHƯ CŨ) */
                <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                    <div
                        {...getRootProps()}
                        className={`w-full flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${isDragActive ? 'border-black bg-gray-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50/50'
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
                            <p className="text-[10px] text-gray-500 mt-1 leading-snug">Point your phone camera here<br />to capture your watch directly.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}