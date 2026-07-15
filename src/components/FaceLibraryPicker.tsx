'use client';

import { useState, useMemo } from 'react';
import type { FaceItem } from '@/lib/aws';

export default function FaceLibraryPicker({
  faces,
  onSelect,
}: {
  faces: FaceItem[];
  onSelect: (face: FaceItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const categories = useMemo(() => {
    const set = new Set(faces.map((f) => f.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [faces]);

  const filteredFaces = useMemo(() => {
    return faces.filter((f) => {
      if (selectedCategory !== 'All' && f.category !== selectedCategory) return false;
      if (searchTerm && !f.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [faces, searchTerm, selectedCategory]);

  if (faces.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-center p-4 border border-dashed border-gray-200 rounded-xl">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Chưa có mặt đồng hồ trong thư viện.
          <br />
          Chạy đồng bộ tại <span className="font-mono text-gray-500">/api/faces/sync</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-2 border border-gray-100 rounded-xl p-3 bg-white shadow-sm overflow-hidden">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest flex-shrink-0">
        Or choose from library
      </p>

      <div className="flex gap-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 min-w-0 bg-transparent border-b border-gray-200 py-1 text-[11px] text-gray-800 outline-none focus:border-black transition-colors"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-white border border-gray-200 text-[10px] rounded-md px-1.5 py-1 outline-none focus:border-black cursor-pointer text-gray-600 max-w-[90px]"
        >
          <option value="All">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'Others' ? 'Others' : c.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-3 gap-2 auto-rows-max scrollbar-hide">
        {filteredFaces.map((face) => (
          <button
            key={face.key}
            type="button"
            onClick={() => onSelect(face)}
            title={face.name}
            className="group aspect-square rounded-md overflow-hidden border border-gray-200 hover:ring-2 hover:ring-black transition-all bg-gray-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/faces/image?key=${encodeURIComponent(face.key)}&thumb=1&v=2`}
              alt={face.name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          </button>
        ))}

        {filteredFaces.length === 0 && (
          <div className="col-span-3 flex items-center justify-center py-6">
            <p className="text-[11px] text-gray-400">Không tìm thấy mặt đồng hồ phù hợp.</p>
          </div>
        )}
      </div>
    </div>
  );
}
