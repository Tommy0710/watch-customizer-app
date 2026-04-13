import clientPromise from '@/lib/mongodb';

// 1. Khai báo cấu trúc chuẩn (Type) giống hệt với StrapSelector
export type Category = { id: number; name: string; slug: string };
export type Tag = { id: number; name: string; slug: string };
export type Attribute = { name: string; options: string[] };

export type Product = {
  id: number;
  name: string;
  price: string;
  link: string;
  image: string;
  thumbnail?: string;
  attributes: Attribute[];
  categories: Category[];
  tags: Tag[];
};

// 2. Gắn Type <Product[]> vào hàm để TypeScript hiểu
export const getDatabaseProducts = async (): Promise<Product[]> => {
  try {
    const client = await clientPromise;
    const db = client.db('watch_customizer');
    
    const products = await db.collection('products').find({}).toArray();
    
    // 3. Ráp dữ liệu và ép kiểu chuẩn xác
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      link: product.link,
      image: product.image,
      thumbnail: product.thumbnail || product.image, // Fallback về image nếu không có thumbnail
      attributes: product.attributes || [],
      categories: product.categories || [],
      tags: product.tags || [],
    })) as Product[]; // Ép kiểu mạnh tay báo cho TypeScript biết đây là Product chuẩn
    
  } catch (error) {
    console.error("❌ Lỗi khi đọc Database:", error);
    return [];
  }
};