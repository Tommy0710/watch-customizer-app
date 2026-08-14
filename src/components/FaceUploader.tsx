'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { QRCodeSVG } from 'qrcode.react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { useAppStore } from '@/store/useAppStore';
import getCroppedImg from '@/utils/cropImage';
import FaceLibraryPicker from '@/components/FaceLibraryPicker';
import type { FaceItem } from '@/lib/aws';

export default function FaceUploader({ initialFaces }: { initialFaces: FaceItem[] }) {
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [uploadLink, setUploadLink] = useState<string>('');

    // Grab the image-update setter from Zustand
    const { setUploadedFace } = useAppStore();

    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);

    // Tracks the crop coordinates and whether cropping is complete
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const [isEditing, setIsEditing] = useState<boolean>(true);
    const [finalCroppedImage, setFinalCroppedImage] = useState<string | null>(null);

    // 1. Poll for the image sent up from the phone
    useEffect(() => {
        // GUARD 1: If we already have an image (PC drag-drop, or the QR scan already finished), stop immediately.
        if (uploadedImage) return;

        const newSessionId = crypto.randomUUID();
        const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
        const uploadLinkTimeout = window.setTimeout(() => {
            setUploadLink(`${currentOrigin}/mobile-upload?session=${newSessionId}`);
        }, 0);

        // Declared outside so the inner function can clear it
        const checkUpload = async () => {
            try {
                const res = await fetch(`/api/upload?sessionId=${newSessionId}`);
                const data = await res.json();

                if (data.success && data.image) {
                    setCrop({ x: 0, y: 0 });
                    setZoom(1);
                    setRotation(0);
                    setUploadedImage(data.image);
                    setIsEditing(true);

                    // GUARD 2: Stop polling as soon as an image comes back successfully
                    if (intervalId) clearInterval(intervalId);
                }
            } catch (err) {
                console.error("Error checking for uploaded image:", err);
            }
        };

        // Poll every 2.5 seconds
        const intervalId = setInterval(checkUpload, 2500);

        // GUARD 3: Clean up if the user closes the popup or navigates away
        return () => {
            window.clearTimeout(uploadLinkTimeout);
            clearInterval(intervalId);
        };

    }, [uploadedImage]); // <-- IMPORTANT: re-run this effect whenever 'uploadedImage' changes

    // 2. Handle drag-and-drop / direct upload via FileReader (base64)
    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles && acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            if (file.size < 20 * 1024) return alert("The image is too blurry or too low resolution!");

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                const img = new Image();
                img.src = base64String;
                img.onload = () => {
                    if (img.width < 400 || img.height < 400) {
                        return alert(`The image must be at least 400x400 pixels!`);
                    }
                    setCrop({ x: 0, y: 0 });
                    setZoom(1);
                    setRotation(0);
                    setUploadedImage(base64String);
                    setIsEditing(true); // Enter edit mode
                };
            };
            reader.readAsDataURL(file);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        maxFiles: 1,
    });
    // 3. Handle the customer pressing "Confirm & Crop"
    const handleConfirmCrop = async () => {
        try {
            if (!uploadedImage || !croppedAreaPixels) return;

            // Run the Canvas-based crop
            const croppedImageBase64 = await getCroppedImg(
                uploadedImage,
                croppedAreaPixels,
                rotation
            );

            // Save the cropped image to local state and the Zustand store
            setFinalCroppedImage(croppedImageBase64);
            setUploadedFace(croppedImageBase64);
            setIsEditing(false); // Leave edit mode

        } catch (e) {
            console.error("Error while cropping the image:", e);
            alert("Something went wrong while processing the image.");
        }
    };

    // 4. Handle picking an existing watch face from the AWS S3 library (skips the crop step)
    const handleSelectLibraryFace = (face: FaceItem) => {
        const proxyUrl = `/api/faces/image?key=${encodeURIComponent(face.key)}`;
        setUploadedImage(proxyUrl);
        setFinalCroppedImage(proxyUrl);
        setUploadedFace(`s3://${face.key}`);
        setIsEditing(false);
    };

    // 5. Reset
    const handleRemoveImage = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setUploadedImage(null);
        setFinalCroppedImage(null);
        setUploadedFace(null);
        setCrop({ x: 0, y: 0 });
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
                            Edit
                        </button>

                        {/* Primary */}
                        <button
                            onClick={() => handleRemoveImage()}
                            className="px-4 py-2 text-xs font-medium text-white
            bg-black rounded-full
            hover:bg-gray-800 transition-all shadow-sm">
                            Change Photo
                        </button>
                    </div>
                </div>

            ) : (
                /* PHẦN UPLOAD: cột trái = thư viện có sẵn, cột phải = upload/QR */
                <div className="w-full h-full flex gap-4 min-h-0">
                    <div className="flex-1 min-w-0 h-full">
                        <FaceLibraryPicker faces={initialFaces} onSelect={handleSelectLibraryFace} />
                    </div>

                    <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-center gap-6">
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
                </div>
            )}
        </div>
    );
}
