import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { listAllFaceKeys } from '@/lib/aws';

export const maxDuration = 60;

export async function GET() {
  try {
    console.log('⏳ Đang liệt kê ảnh mặt đồng hồ từ AWS S3...');
    const faces = await listAllFaceKeys();

    const client = await clientPromise;
    const db = client.db('watch_customizer');
    const collection = db.collection('faces');

    // Xóa sạch dữ liệu cũ và chèn toàn bộ dữ liệu mới (Full Sync) — giống hệt woocommerce/sync
    await collection.deleteMany({});

    if (faces.length > 0) {
      await collection.insertMany(faces);
    }

    // Đảm bảo /api/faces/image tra cứu theo key luôn nhanh, kể cả khi thư viện lớn dần
    await collection.createIndex({ key: 1 }, { unique: true });

    console.log(`✅ Đã đồng bộ ${faces.length} mặt đồng hồ vào MongoDB.`);
    return NextResponse.json({
      success: true,
      message: `Đã đồng bộ thành công ${faces.length} mặt đồng hồ vào Database!`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    console.error('❌ Lỗi đồng bộ Face Library:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
