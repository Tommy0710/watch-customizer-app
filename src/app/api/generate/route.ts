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

        // 1. Đọc ảnh Mặt đồng hồ từ Base64
        const base64Data = faceImage.replace(/^data:image\/\w+;base64,/, "");
        const faceBuffer = Buffer.from(base64Data, 'base64');

        // 2. Lấy kích thước gốc của ảnh mặt đồng hồ, thu nhỏ xuống 1/2
        const faceMeta = await sharp(faceBuffer).metadata();
        const targetFaceWidth = Math.round((faceMeta.width ?? 1000) / 2.5);

        console.log(`🛠️ Resize mặt đồng hồ: ${faceMeta.width}px → ${targetFaceWidth}px (1/2 kích thước gốc)`);

        const resizedFace = await sharp(faceBuffer)
            .resize({ width: targetFaceWidth })
            .jpeg({ quality: 90 })
            .toBuffer();

        // 3. Chuyển ảnh thu nhỏ sang data URI để gửi cho Replicate
        const resizedFaceDataUri = `data:image/jpeg;base64,${resizedFace.toString('base64')}`;

        console.log("🚀 Gửi 2 ảnh riêng (dây + mặt thu nhỏ 1/2) cho FLUX-2-PRO...");

        // 5. GỌI FLUX VỚI 2 ẢNH: dây đã chọn + mặt đồng hồ được thu nhỏ đúng tỉ lệ
        const output: any = await replicate.run(
            "black-forest-labs/flux-2-pro",
            {
                input: {
                    seed: 19826,
                    prompt: "A hyper-detailed, photorealistic top-down flat lay photograph of a luxury wristwatch, seamlessly integrated into its complete leather strap. The image must meticulously preserve the exact details, colors, textures, and designs of both reference images without any alteration. The leather strap, which is proportionally dominant in the composition (the watch face must appear naturally smaller, roughly 1/3 to 1/4 the length of the strap), must be entirely visible from end to end, with no cropping. Every single element of the strap—including every individual thread of the precise stitching, the specific contours of the padded areas, the buckle style, the keepers, the hole pattern, and the exact grain pattern of the leather—must be reproduced with extreme fidelity. The watch face is perfectly centered and naturally connected to the strap, with sharp, ultra-detailed definition of all dial elements, hands, markers, and textures. The full strap extends across the frame, showcasing its entire length and every detail. The background is a clean, neutral, soft-toned, professional studio surface. The lighting is diffused, high-end product photography lighting, creating soft, natural shadows that emphasize the texture and dimensionality of the leather grain, the raised stitching, and the facets of the watch face. Every element is in sharp, crystal-clear focus, providing an 8k ultra-high-resolution, luxury aesthetic.",
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