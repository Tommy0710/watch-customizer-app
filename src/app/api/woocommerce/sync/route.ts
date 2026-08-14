import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const BASE64_KEY = process.env.WC_BAESE64_KEY;

type WooCommerceImage = {
  src?: string;
  thumbnail?: string;
};

type WooCommerceProduct = {
  id: number;
  name?: string;
  price?: string;
  permalink?: string;
  images?: WooCommerceImage[];
  attributes?: unknown;
  categories?: unknown;
  tags?: unknown;
};

type SyncedProduct = {
  id: number;
  name?: string;
  price?: string;
  link?: string;
  image?: string;
  thumbnail?: string;
  attributes?: unknown;
  categories?: unknown;
  tags?: unknown;
};

const getAuthHeaders = () => {
  const encodedCredentials = BASE64_KEY || Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  
  return {
    'Authorization': `Basic ${encodedCredentials}`,
    'Content-Type': 'application/json',
  };
};

export async function GET() {

  try {
    let allProducts: SyncedProduct[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      console.log(`⏳ Đang kéo trang ${page}/${totalPages} từ WooCommerce...`);
      
      const url = new URL(`https://handdn.com/wp-json/wc/v3/products`);
      url.searchParams.append('per_page', '100');
      url.searchParams.append('page', page.toString());
      url.searchParams.append('status', 'publish');
      url.searchParams.append('stock_status', 'instock');
      
      // BẮT BUỘC MỞ DÒNG NÀY ĐỂ KHÔNG BỊ TRÀN RAM
      url.searchParams.append('_fields', 'id,name,price,permalink,images,attributes,categories,tags');

      console.log(`\n=== DEBUG: Request URL (Trang ${page}) ===`);
      console.log(url.toString());

      // Gọi fetch với url.toString()
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: getAuthHeaders(),
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("=== DEBUG ERROR: Chi tiết lỗi từ API WooCommerce ===");
        console.error(`Status HTTP: ${response.status}`);
        console.error(`Nội dung lỗi (Raw):`, errorText);
        throw new Error(`HTTP ${response.status} - ${errorText}`);
      }

      if (page === 1) totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1', 10);
      console.log(`=== DEBUG: Header x-wp-totalpages (Tổng số trang) ===`, response.headers.get('x-wp-totalpages'));

      const products: unknown = await response.json();
      
      console.log(`=== DEBUG: Toàn bộ dữ liệu RAW trả về từ WooCommerce (Trang ${page}) ===`);
      console.dir(products, { depth: null });
      
      if (!Array.isArray(products)) {
        throw new Error('WooCommerce trả về dữ liệu sản phẩm không hợp lệ');
      }

      const formatted = (products as WooCommerceProduct[]).map((p) => ({
        id: p.id, // ID gốc của WooCommerce
        name: p.name,
        price: p.price,
        link: p.permalink,
        image: p.images && p.images.length > 0 ? p.images[0].src : '', 
        thumbnail: p.images && p.images.length > 0 ? p.images[0].thumbnail : '',
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
    
    // Chỉ chèn nếu có dữ liệu để tránh lỗi MongoDB
    if (allProducts.length > 0) {
      await collection.insertMany(allProducts);
    }

    console.timeEnd("⏱️ Thời gian đồng bộ");
    return NextResponse.json({ 
      success: true, 
      message: `Đã đồng bộ thành công ${allProducts.length} sản phẩm vào Database!` 
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    console.error("❌ Lỗi đồng bộ:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
