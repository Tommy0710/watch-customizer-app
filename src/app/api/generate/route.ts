import { NextResponse } from 'next/server';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(request: Request) {
  try {
    // Chúng ta sẽ nhận bức ảnh đã ghép thô từ Frontend (để giữ đúng vị trí, tỉ lệ)
    const { compositeImage } = await request.json();

    console.log("--- API RECEIVE DATA ---");
    console.log("Composite Image Length:", compositeImage ? compositeImage.length : 0);
    console.log("------------------------");

    if (!compositeImage) {
      return NextResponse.json({ error: 'Thiếu dữ liệu hình ảnh Composite' }, { status: 400 });
    }

    console.log("🚀 Đang gửi yêu cầu cho Replicate AI (Model: FLUX-2-PRO)...");

    // Gọi FLUX-2-PRO theo đúng Schema
    const output: any = await replicate.run(
      "black-forest-labs/flux-2-pro",
      {
        input: {
          prompt: "A photorealistic luxury watch composed from two reference images: the original watch face and the original leather strap. Strictly preserve the exact design, texture, color, and proportions of both the watch face and the strap without alteration or redesign. The watch face is seamlessly and naturally attached to the strap, with accurate alignment, realistic connection, and proper scale. Top-down flat lay composition, perfectly centered. The FULL leather strap must be completely visible in the frame from end to end, no cropping, no zoom-in. High-end product photography, professional studio lighting, soft shadows, clean background. Ultra-detailed, sharp focus, realistic materials, luxury aesthetic, 8k quality.",
          
          // SỬA ĐỔI QUAN TRỌNG NHẤT: Đưa ảnh vào mảng (Array)
          input_images: [compositeImage], 
          
          aspect_ratio: "9:16",
          
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