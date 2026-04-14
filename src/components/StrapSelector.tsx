'use client';

import { useState, useMemo } from 'react';
import type { Product } from '@/lib/woocommerce';

const ALLOWED_CATEGORIES = ['Classic Watch Straps', 'Apple Watch Series Band', 'Apple Watch Ultra Band' ,'Vintage Watch Straps'];
// Thêm danh sách các thuộc tính được phép hiển thị trên bộ lọc (Thay đổi theo tên thuộc tính thực tế trên WooCommerce của bạn)
const ALLOWED_ATTRIBUTES = ['Color', 'Size', 'Material'];

export default function StrapSelector({ initialProducts }: { initialProducts: Product[] }) {
  // 1. Quản lý State cho Lọc và Tìm kiếm
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({});
  
  // State quản lý sản phẩm đang xem chi tiết
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // 2. Trích xuất TỰ ĐỘNG Danh mục (Sắp xếp Alphabet)
  const categories = useMemo(() => {
    if (!initialProducts) return [];
    const catSet = new Set<string>();

    initialProducts.forEach(product => {
      // Lấy danh mục (Chỉ thêm vào bộ lọc nếu category đó nằm trong danh sách ALLOWED_CATEGORIES)
      product.categories?.forEach(c => {
        if (ALLOWED_CATEGORIES.includes(c.name)) catSet.add(c.name);
      });
    });
    
    return Array.from(catSet).sort((a, b) => a.localeCompare(b));
  }, [initialProducts]);

  // 3. Trích xuất TỰ ĐỘNG Thuộc tính (Sắp xếp Alphabet & Ẩn tùy chọn trống)
  const attributes = useMemo(() => {
    if (!initialProducts) return [];

    // Lọc trước các sản phẩm thoả mãn Search và Category hiện tại
    const baseProducts = initialProducts.filter(product => {
      const isAllowedProduct = product.categories?.some(c => ALLOWED_CATEGORIES.includes(c.name));
      if (!isAllowedProduct) return false;

      if (searchTerm && !product.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;

      if (selectedCategory !== 'All') {
        const hasCategory = product.categories?.some(c => c.name === selectedCategory);
        if (!hasCategory) return false;
      }

      return true;
    });

    const attrMap = new Map<string, Set<string>>();

    baseProducts.forEach(product => {
      // Chỉ lấy thuộc tính từ những sản phẩm thực sự còn hiển thị trong Category này
      product.attributes?.forEach(attr => {
        // Chỉ thêm vào bộ lọc nếu thuộc tính đó nằm trong danh sách ALLOWED_ATTRIBUTES
        if (ALLOWED_ATTRIBUTES.includes(attr.name)) {
          if (!attrMap.has(attr.name)) attrMap.set(attr.name, new Set());
          attr.options.forEach(opt => attrMap.get(attr.name)!.add(opt));
        }
      });
    });

    return Array.from(attrMap.entries())
      .map(([name, options]) => ({
        name,
        options: Array.from(options).sort((a, b) => a.localeCompare(b)) // Sắp xếp các lựa chọn (options) theo alphabet
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sắp xếp tên thuộc tính (Material, Size...) theo alphabet
  }, [initialProducts, searchTerm, selectedCategory]);

  // 4. Logic Lọc Sản Phẩm Cuối Cùng (Áp dụng đồng thời Tìm kiếm + Danh mục + Thuộc tính)
  const filteredProducts = useMemo(() => {
    if (!initialProducts) return [];
    
    return initialProducts.filter(product => {
      // 0. Loại bỏ các sản phẩm không thuộc danh sách ALLOWED_CATEGORIES
      const isAllowedProduct = product.categories?.some(c => ALLOWED_CATEGORIES.includes(c.name));
      if (!isAllowedProduct) return false;

      // Lọc theo từ khóa tìm kiếm (Search)
      if (searchTerm && !product.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Lọc theo Danh mục (Category)
      if (selectedCategory !== 'All') {
        const hasCategory = product.categories?.some(c => c.name === selectedCategory);
        if (!hasCategory) return false;
      }

      // Lọc theo các Thuộc tính (Attributes)
      for (const [attrName, selectedValue] of Object.entries(selectedAttributes)) {
        if (selectedValue !== 'All') {
          const productAttr = product.attributes?.find(a => a.name === attrName);
          if (!productAttr || !productAttr.options.includes(selectedValue)) {
            return false;
          }
        }
      }

      return true; // Nếu vượt qua mọi điều kiện thì giữ lại
    });
  }, [initialProducts, searchTerm, selectedCategory, selectedAttributes]);

  // Reset view khi có thay đổi bộ lọc
  const handleFilterChange = () => {
    setSelectedProduct(null);
  };

  if (!initialProducts || initialProducts.length === 0) {
    return <div className="text-sm text-red-500">Không có dữ liệu sản phẩm.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      
      {/* KHU VỰC CÔNG CỤ TÌM KIẾM & LỌC */}
      <div className="mb-4 flex flex-col gap-3">
        {/* Thanh tìm kiếm (Minimalist style) */}
        <div className="relative">
          <input 
            type="text" 
            placeholder="Search straps..." 
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); handleFilterChange(); }}
            className="w-full bg-transparent border-b border-gray-200 py-1.5 pl-6 text-xs text-gray-800 outline-none focus:border-black transition-colors"
          />
          <svg className="absolute left-0 top-2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
        </div>

        {/* Thanh bộ lọc (Dropdowns ngang) */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-center">
          
          {/* Lọc Category */}
          <select 
            value={selectedCategory} 
            onChange={(e) => { 
              setSelectedCategory(e.target.value); 
              setSelectedAttributes({}); // Xóa các thuộc tính đã chọn khi đổi danh mục để không bị kẹt filter
              handleFilterChange(); 
            }}
            className="bg-white border border-gray-200 text-[11px] rounded-md px-2 py-1.5 outline-none focus:border-black cursor-pointer text-gray-600 min-w-[110px]"
          >
            <option value="All">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Render động tất cả các Attribute làm bộ lọc */}
          {attributes.map(attr => (
            <select 
              key={attr.name}
              value={selectedAttributes[attr.name] || 'All'}
              onChange={(e) => {
                setSelectedAttributes(prev => ({ ...prev, [attr.name]: e.target.value }));
                handleFilterChange();
              }}
              className="bg-white border border-gray-200 text-[11px] rounded-md px-2 py-1.5 outline-none focus:border-black cursor-pointer text-gray-600 min-w-[90px]"
            >
              <option value="All">{attr.name} (All)</option>
              {attr.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* VÙNG HIỂN THỊ DANH SÁCH / CHI TIẾT */}
      <div className="flex-1 overflow-hidden">
        {selectedProduct ? (
          // ==========================================
          // TRẠNG THÁI 2: ĐÃ CHỌN SẢN PHẨM (Chia 2 cột)
          // ==========================================
          <div className="flex h-full gap-4">
            {/* Cột trái: Lưới 3 cột thu nhỏ */}
            <div className="w-1/2 h-full overflow-y-auto pr-2 grid grid-cols-3 gap-2 auto-rows-max scrollbar-hide">
              {filteredProducts.map((product) => (
                <div 
                  key={product.id} 
                  onClick={() => setSelectedProduct(product)}
                  className={`cursor-pointer group flex flex-col p-1 rounded-md transition-all ${
                    selectedProduct.id === product.id ? 'ring-1 ring-black bg-gray-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="bg-gray-100 aspect-square rounded overflow-hidden relative border border-gray-200">
                    {/* Dùng Thumbnail cho hình thu nhỏ, nếu không có thì fallback về Image */}
                    {product.thumbnail || product.image ? (
                      <img src={product.thumbnail || product.image} alt={product.name} className="object-cover w-full h-full mix-blend-multiply" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Img</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Cột phải: Xem chi tiết sản phẩm */}
            <div className="w-1/2 h-full bg-white border border-gray-200 rounded-lg p-4 flex flex-col relative overflow-y-auto shadow-sm">
              <button 
                onClick={() => setSelectedProduct(null)}
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                title="Close"
              >
                ✕
              </button>

              <div className="w-full aspect-square bg-gray-50 rounded-md overflow-hidden flex-shrink-0 mb-4 border border-gray-100">
                 {selectedProduct.image ? (
                    <img src={selectedProduct.image} alt={selectedProduct.name} className="object-cover w-full h-full mix-blend-multiply hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No Image Available</div>
                  )}
              </div>

              <div className="flex flex-col flex-1">
                <h3 className="font-semibold text-gray-900 text-sm leading-snug">{selectedProduct.name}</h3>
                <p className="text-gray-500 mt-1 text-sm">${selectedProduct.price || '0.00'}</p>
                
                {/* <div className="flex flex-wrap gap-1 mt-3">
                  {selectedProduct.categories?.map(c => (
                     <span key={c.id} className="bg-black text-white px-2 py-0.5 rounded text-[10px]">{c.name}</span>
                  ))}
                  {selectedProduct.attributes.map((attr, idx) => (
                    <span key={idx} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] border border-gray-200">
                      {attr.options.join(', ')}
                    </span>
                  ))}
                </div> */}

                <div className="mt-auto pt-4 flex gap-2">
                  <a href={selectedProduct.link} target="_blank" rel="noopener noreferrer"
                    className="flex-1 bg-white border border-black text-black text-center py-2 rounded-md text-xs font-medium hover:bg-gray-50 transition-colors"
                  >
                    View on Store
                  </a>
                  <button className="flex-1 bg-black text-white text-center py-2 rounded-md text-xs font-medium hover:bg-gray-800 transition-colors shadow-md">
                    Select Strap
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // ==========================================
          // TRẠNG THÁI 1: CHƯA CHỌN (Lưới 6 cột)
          // ==========================================
          <div className="h-full overflow-y-auto pr-2 grid grid-cols-6 gap-3 auto-rows-max scrollbar-hide">
            {filteredProducts.map((product) => (
              <div 
                key={product.id} 
                onClick={() => setSelectedProduct(product)}
                className="cursor-pointer group flex flex-col"
              >
                <div className="bg-gray-100 aspect-square rounded-md overflow-hidden mb-1.5 relative border border-gray-200">
                  {/* Dùng Thumbnail cho hình thu nhỏ, nếu không có thì fallback về Image */}
                  {product.thumbnail || product.image ? (
                    <img src={product.thumbnail || product.image} alt={product.name} className="object-cover w-full h-full mix-blend-multiply group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Img</div>
                  )}
                </div>
                <p className="text-[9px] font-medium text-gray-800 line-clamp-2 leading-tight group-hover:text-black">{product.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}