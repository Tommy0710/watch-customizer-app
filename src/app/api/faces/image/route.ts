import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { getObjectBuffer, getThumbnailBuffer } from '@/lib/aws';

// Streams an S3 object's bytes through our own server so the bucket never needs
// to be public and we never hand out AWS credentials to the browser.
// `s-maxage` makes Vercel's edge cache serve every visitor after the first request
// for a given key — S3/Mongo are only hit once per key per year, not per pageview.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  const thumb = searchParams.get('thumb') === '1';

  if (!key) {
    return NextResponse.json({ error: 'Thiếu tham số key' }, { status: 400 });
  }

  try {
    // Chỉ phục vụ những key đã được đồng bộ vào DB, tránh bị dò key tùy ý trong bucket
    const client = await clientPromise;
    const db = client.db('watch_customizer');
    const exists = await db.collection('faces').findOne({ key });

    if (!exists) {
      return NextResponse.json({ error: 'Không tìm thấy ảnh' }, { status: 404 });
    }

    const { buffer, contentType } = thumb ? await getThumbnailBuffer(key) : await getObjectBuffer(key);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    console.error('❌ Lỗi khi tải ảnh từ S3:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
