// src/app/page.tsx
import { getDatabaseProducts } from '@/lib/woocommerce'; // <-- ĐÃ SỬA: Import hàm gọi Database
import StrapSelector from '@/components/StrapSelector';
import FaceUploader from '@/components/FaceUploader';

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
        <div className="p-6 flex flex-col bg-[#FAFAFA] overflow-hidden h-full">
          <h2 className="text-sm tracking-widest text-gray-400 uppercase font-semibold mb-4 text-center flex-shrink-0">
            3. AI Generated Result
          </h2>
          <div className="flex-1 w-full rounded-lg flex items-center justify-center text-gray-400 bg-white border border-gray-100 shadow-sm overflow-hidden text-center p-4">
            Kết quả kết hợp bằng AI sẽ hiển thị tại đây sau khi bạn nhấn Combine.
          </div>
        </div>

        {/* NÚT COMBINE (Cố định ở giữa) */}
        <button className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black text-white rounded-full flex items-center justify-center shadow-lg border-4 border-white z-20 hover:scale-105 transition-transform duration-300">
          <span className="text-xs font-bold tracking-widest text-center">COMBINE</span>
        </button>
      </div>
    </main>
  );
}