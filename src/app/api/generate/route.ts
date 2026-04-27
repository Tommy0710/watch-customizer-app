export const maxDuration = 60; // Tránh Vercel báo lỗi Timeout

import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import sharp from 'sharp';

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(request: Request) {
    try {
        const { strapImage, faceImage } = await request.json();

        if (!strapImage || !faceImage) {
            return NextResponse.json({ error: 'Thiếu dữ liệu hình ảnh' }, { status: 400 });
        }

        console.log("🛠️ Đang xử lý tỉ lệ chuẩn (Mặt đồng hồ = 45% Dây) bằng Sharp...");

        // 1. Tải ảnh Dây đồng hồ từ URL về Server
        const strapRes = await fetch(strapImage);
        if (!strapRes.ok) throw new Error("Không thể tải ảnh dây đồng hồ");
        const strapBuffer = Buffer.from(await strapRes.arrayBuffer());

        // 2. Đọc ảnh Mặt đồng hồ từ Base64
        const base64Data = faceImage.replace(/^data:image\/\w+;base64,/, "");
        const faceBuffer = Buffer.from(base64Data, 'base64');

        // 3. ĐO ĐẠC VÀ THU NHỎ (Bước quyết định tỉ lệ)
        const strapImg = sharp(strapBuffer);
        const metadata = await strapImg.metadata();
        const strapWidth = metadata.width || 1000;

        // Tỉ lệ vàng: Mặt đồng hồ thường chiếm khoảng 42% - 45% chiều rộng của tấm ảnh dây
        const targetFaceWidth = Math.round(strapWidth * 0.45);

        const resizedFace = await sharp(faceBuffer)
            .resize({ width: targetFaceWidth }) // Ép thu nhỏ mặt đồng hồ
            .toBuffer();

        // 4. Chuyển ảnh thu nhỏ sang data URI để gửi cho Replicate
        const resizedFaceDataUri = `data:image/jpeg;base64,${resizedFace.toString('base64')}`;

        console.log("🚀 Gửi 2 ảnh riêng (dây + mặt thu nhỏ) cho FLUX-2-PRO...");

        // 5. GỌI FLUX VỚI 2 ẢNH: dây đã chọn + mặt đồng hồ được thu nhỏ đúng tỉ lệ
        const output: any = await replicate.run(
            "black-forest-labs/flux-2-pro",
            {
                input: {
                    seed: 19826,
                    prompt: "A photorealistic luxury watch composed from two reference images: the original watch face and the original leather watch strap. Strictly preserve the exact design, texture, color, and proportions of both the watch face and the strap without alteration or redesign. The watch face is seamlessly and naturally attached to the watch strap, with accurate alignment, realistic connection, and proper scale. The watch face must appear proportionally smaller relative to the full strap, matching real-world wristwatch proportions (approximately 1/3 to 1/4 of the total strap length). Top-down flat lay composition, perfectly centered. The FULL leather watch strap must be completely visible in the frame from end to end, no cropping, no zoom-in. Ensure realistic product scale — the strap should dominate the composition while the watch face remains appropriately sized, not oversized. High-end product photography, professional studio lighting, soft shadows, clean background. Ultra-detailed, sharp focus, realistic materials, luxury aesthetic, 8k quality.",
                    resolution: "1 MP",
                    aspect_ratio: "9:16",
                    input_images: [strapImage, resizedFaceDataUri],
                    output_format: "webp",
                    output_quality: 90,
                    safety_tolerance: 5
                }
            }
        );

        console.log("✅ AI đã xử lý xong.");

        if (!output) throw new Error("AI không trả về kết quả hợp lệ.");
        const imageUrl = typeof output === 'string' ? output : output.url();

        return NextResponse.json({ success: true, resultImage: imageUrl });

    } catch (error: any) {
        console.error("❌ Lỗi AI / Sharp:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}