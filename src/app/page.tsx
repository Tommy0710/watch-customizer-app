// src/app/page.tsx
import { getDatabaseProducts } from '@/lib/woocommerce'; // <-- ĐÃ SỬA: Import hàm gọi Database
import StrapSelector from '@/components/StrapSelector';
import FaceUploader from '@/components/FaceUploader';
import CombineSection from '@/components/CombineSection';

export default async function CustomizerApp() {
  // 1. Lấy dữ liệu siêu tốc trực tiếp từ MongoDB Atlas
  const products = await getDatabaseProducts(); // <-- ĐÃ SỬA: Gọi hàm Database

  return (
    <main className="h-screen w-full font-sans text-gray-800 overflow-hidden">
      {/* Container tràn viền */}
      <div className="relative w-full h-full bg-white grid grid-cols-2 overflow-hidden">

        {/* CỘT TRÁI - Chia làm 2 Block tầng */}
        <div className="flex flex-col border-r border-gray-200 overflow-hidden h-full">

          {/* Block 1: Handdn Watch Strap - Chiếm 50% chiều cao */}
          <div className="h-1/2 border-b border-gray-200 p-6 flex flex-col min-h-0">
            <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 flex-shrink-0">
              1. Handdn Watch Strap
            </h2>
            {/* Vùng chứa StrapSelector với min-h-0 để kích hoạt scroll bên trong */}
            <div className="flex-1 min-h-0">
              <StrapSelector initialProducts={products} />
            </div>
          </div>

          {/* Block 2: Upload - Chiếm 50% chiều cao */}
          <div className="h-1/2 p-6 flex flex-col bg-gray-50/50 min-h-0">
            <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
              2. Upload Customer Watch Face
            </h2>
            <div className="flex-1 min-h-0 w-full">
              <FaceUploader />
            </div>
          </div>
        </div>

        {/* CỘT PHẢI - Kết quả AI */}
        <div className="flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
          <CombineSection />
        </div>
      </div>
    </main>
  );
}