import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

// GET: Máy tính gọi vào đây để "hỏi thăm" xem có ảnh chưa
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) return NextResponse.json({ success: false });

    const client = await clientPromise;
    const db = client.db('watch_customizer');
    
    // Tìm session trong DB
    const session = await db.collection('sessions').findOne({ sessionId });

    // Nếu tìm thấy và có ảnh, trả về cho máy tính
    if (session && session.image) {
      return NextResponse.json({ success: true, image: session.image });
    }
    
    return NextResponse.json({ success: false, message: 'Chưa có ảnh' });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

// POST: Điện thoại gọi vào đây để Gửi ảnh lên
export async function POST(request: Request) {
  try {
    const { sessionId, image } = await request.json();
    if (!sessionId || !image) return NextResponse.json({ success: false }, { status: 400 });

    const client = await clientPromise;
    const db = client.db('watch_customizer');
    
    // Lưu ảnh vào DB (Upsert: Chưa có thì tạo, có rồi thì ghi đè)
    await db.collection('sessions').updateOne(
      { sessionId },
      { $set: { sessionId, image, createdAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}