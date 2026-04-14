import { NextResponse } from 'next/server';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(request: Request) {
  try {
    const { strapImage, faceImage } = await request.json();
    // Log để kiểm tra trên Terminal của VS Code
    console.log("--- API RECEIVE DATA ---");
    console.log("Strap Image:", strapImage ? "OK" : "MISSING");
    console.log("Face Image Length:", faceImage ? faceImage.length : 0);
    console.log("------------------------");

    if (!strapImage || !faceImage) {
      return NextResponse.json({ error: 'Thiếu dữ liệu hình ảnh' }, { status: 400 });
    }

    console.log("🚀 Đang gửi yêu cầu cho Replicate AI...");

    // Tạm thời chúng ta sẽ sử dụng model SDXL Image-to-Image để AI tự blend 2 bức ảnh
    // LƯU Ý: Vì bạn KHÔNG tách nền và KHÔNG pre-composite, AI sẽ phải tự "tưởng tượng" rất nhiều.
    const output = await replicate.run(
      "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
      {
        input: {
          prompt: "A photorealistic high-end watch face seamlessly attached to a luxury leather watch strap. Professional studio lighting, top-down view, highly detailed.",
          negative_prompt: "ugly, deformed, bad anatomy, poorly drawn, extra limbs, artifacts",
          image: faceImage, // Cung cấp ảnh mặt đồng hồ làm ảnh gốc
          prompt_strength: 0.65, // Mức độ AI được phép "sáng tạo" đè lên ảnh gốc (0.0 đến 1.0)
          refine: "expert_ensemble_refiner",
          apply_watermark: false
        }
      }
    )as string[];

    console.log("✅ AI đã xử lý xong:", output);

    // Replicate trả về mảng URL, ta lấy URL đầu tiên
    return NextResponse.json({ success: true, resultImage: output[0] });

  } catch (error: any) {
    console.error("❌ Lỗi AI:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}