import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const BASE64_KEY = process.env.WC_BAESE64_KEY;
const getAuthHeaders = () => {
  const credentials = `${CONSUMER_KEY}:${CONSUMER_SECRET}`;
  const encodedCredentials = Buffer.from(credentials).toString('base64');
  return {
    'Authorization': `Basic ${BASE64_KEY} || ${encodedCredentials}`,
    'Content-Type': 'application/json',
  };
};

export async function GET() {
  console.log("🔄 Bắt đầu tiến trình đồng bộ WooCommerce -> MongoDB");
  console.time("⏱️ Thời gian đồng bộ");

  try {
    let allProducts: any[] = [];
    let page = 1;
    let totalPages = 1;

    // 1. Kéo toàn bộ dữ liệu từ WooCommerce (Giống hệt code cũ của bạn)
    while (page <= totalPages) {
      console.log(`⏳ Đang kéo trang ${page}/${totalPages} từ WooCommerce...`);
      const url = new URL(`https://handdn.com/wp-json/wc/v3/products`);
      url.searchParams.append('per_page', '100');
      url.searchParams.append('page', page.toString());
      url.searchParams.append('status', 'publish');
    //   url.searchParams.append('_fields', 'id,name,price,permalink,images,attributes,categories,tags');

      const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(),
        cache: 'no-store',
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (page === 1) totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1', 10);

      const products = await response.json();
      
      const formatted = products.map((p: any) => ({
        id: p.id, // ID gốc của WooCommerce
        name: p.name,
        price: p.price,
        link: p.permalink,
        image: p.images && p.images.length > 0 ? p.images[0].src : '', 
        attributes: p.attributes,
        categories: p.categories,
        tags: p.tags,
      }));
      
      allProducts = [...allProducts, ...formatted];
      page++;
    }

    // 2. Kết nối vào MongoDB và Cập nhật dữ liệu
    console.log(`🔌 Đang ghi ${allProducts.length} sản phẩm vào MongoDB...`);
    const client = await clientPromise;
    const db = client.db('watch_customizer'); // Tên cơ sở dữ liệu
    const collection = db.collection('products'); // Tên bảng lưu trữ

    // Xóa sạch dữ liệu cũ và chèn toàn bộ dữ liệu mới (Full Sync)
    await collection.deleteMany({});
    await collection.insertMany(allProducts);

    console.timeEnd("⏱️ Thời gian đồng bộ");
    return NextResponse.json({ 
      success: true, 
      message: `Đã đồng bộ thành công ${allProducts.length} sản phẩm vào Database!` 
    });

  } catch (error: any) {
    console.error("❌ Lỗi đồng bộ:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}