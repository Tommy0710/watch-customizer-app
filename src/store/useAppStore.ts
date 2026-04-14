import { create } from 'zustand';
import { Product } from '@/lib/woocommerce';

interface AppState {
  selectedStrap: Product | null;
  uploadedFace: string | null;
  setSelectedStrap: (strap: Product | null) => void;
  setUploadedFace: (image: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedStrap: null,
  uploadedFace: null,
  setSelectedStrap: (strap) => set({ selectedStrap: strap }),
  setUploadedFace: (image) => set({ uploadedFace: image }),
}));