import { create } from 'zustand';
import { Product } from '@/lib/woocommerce';

interface AppState {
  selectedStrap: Product | null;
  uploadedFace: string | null;
  // Server-cropped watch-face result from a prior /api/generate call, reused for subsequent
  // Combine attempts with the same uploadedFace so /api/generate can skip re-running the
  // gpt-5-nano detection step. Cleared whenever uploadedFace changes.
  cachedFaceCrop: string | null;
  setSelectedStrap: (strap: Product | null) => void;
  setUploadedFace: (image: string | null) => void;
  setCachedFaceCrop: (image: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedStrap: null,
  uploadedFace: null,
  cachedFaceCrop: null,
  setSelectedStrap: (strap) => set({ selectedStrap: strap }),
  setUploadedFace: (image) => set({ uploadedFace: image, cachedFaceCrop: null }),
  setCachedFaceCrop: (image) => set({ cachedFaceCrop: image }),
}));
