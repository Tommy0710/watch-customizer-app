import { NextResponse } from 'next/server';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(request: Request) {
  try {
    // Chúng ta sẽ nhận bức ảnh đã ghép thô từ Frontend (để giữ đúng vị trí, tỉ lệ)
    const { strapImage, faceImage } = await request.json();

    console.log("--- API RECEIVE DATA ---");
    console.log("Strap Image:", strapImage ? "OK" : "MISSING");
    console.log("Face Image Length:", faceImage ? faceImage.length : 0);
    console.log("------------------------");

    if (!strapImage || !faceImage) {
      return NextResponse.json({ error: 'Thiếu dữ liệu hình ảnh' }, { status: 400 });
    }

    console.log("🚀 Đang gửi MẢNG 2 ẢNH cho FLUX-2-PRO...");

    // Gọi FLUX-2-PRO theo đúng Schema
    const output: any = await replicate.run(
      "black-forest-labs/flux-2-pro",
      {
        input: {
          prompt: "A photorealistic a watch composed from two reference images: the original watch face and the original flat leather watch strap, strictly preserving the exact design, color, grain pattern, stitching, and material texture of the leather strap with absolute accuracy (no color shift, no texture alteration, no redesign), strictly preserving the exact design, texture, color, and proportions of the watch face without any modification, seamlessly and naturally attaching the watch face to the strap with precise alignment, realistic lugs connection, correct physical scale, maintaining real-world proportions between the watch case and strap with a realistic case-to-strap width ratio (strap width approximately 18–22mm depending on case size) ensuring the strap is not disproportionately thin or thick relative to the watch face, top-down flat lay composition perfectly centered, the FULL leather strap completely visible from end to end including both strap tips with no cropping and no zoom-in, high-end product photography with professional studio lighting, soft shadows, clean minimal background, ultra-detailed sharp focus with realistic materials and accurate reflections, luxury aesthetic in 8k quality, maintaining true-to-source color fidelity and micro-texture detail consistency across the entire strap.",     
          // SỬA ĐỔI QUAN TRỌNG NHẤT: Đưa ảnh vào mảng (Array)
          input_images: [strapImage, faceImage], 
          
          aspect_ratio: "9:16",
          seed: 19826,
          // Các thông số tinh chỉnh thêm dựa trên schema:
          output_format: "jpg", // Xuất JPG cho nhẹ và dễ load
          output_quality: 90,   // Chất lượng 90/100
          safety_tolerance: 5,  // Nới lỏng kiểm duyệt (5 là cao nhất) để AI không hiểu nhầm vân da cá sấu/đà điểu là ảnh bạo lực/động vật
          resolution: "1 MP"    // Giữ nguyên độ phân giải chuẩn
        }
      }
    );

    console.log("✅ AI đã xử lý xong. Dữ liệu gốc trả về:", output);

    if (!output) {
      throw new Error("AI không trả về kết quả hợp lệ.");
    }

    // LƯU Ý TỪ DOC: Flux trả về 1 object đơn, KHÔNG PHẢI MẢNG!
    // Do đó ta gọi thẳng output.url() thay vì output[0].url()
    const imageUrl = typeof output === 'string' ? output : output.url();

    return NextResponse.json({ success: true, resultImage: imageUrl });

  } catch (error: any) {
    console.error("❌ Lỗi AI:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}