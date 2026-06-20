import { create } from 'zustand';
import type { Space } from '../types';

interface MapState {
  spaces: Record<string, Space>;
  selectedSpaceId: string | null;
  userLocation: { lat: number; lng: number } | null;
  isReportSheetOpen: boolean;
  emptyOnly: boolean;
  showHeatmap: boolean;
  upsertSpace: (space: Space) => void;
  removeSpace: (id: string) => void;
  setSelectedSpace: (id: string | null) => void;
  setUserLocation: (loc: { lat: number; lng: number } | null) => void;
  setReportSheetOpen: (v: boolean) => void;
  setEmptyOnly: (v: boolean) => void;
  setShowHeatmap: (v: boolean) => void;
  bulkSetSpaces: (spaces: Space[]) => void;
}

export const useMapStore = create<MapState>((set) => ({
  spaces: {},
  selectedSpaceId: null,
  userLocation: null,
  isReportSheetOpen: false,
  emptyOnly: false,
  showHeatmap: false,

  upsertSpace: (space) =>
    set((s) => ({ spaces: { ...s.spaces, [space.id]: space } })),

  removeSpace: (id) =>
    set((s) => {
      const next = { ...s.spaces };
      delete next[id];
      return { spaces: next };
    }),

  setSelectedSpace: (selectedSpaceId) => set({ selectedSpaceId }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setReportSheetOpen: (isReportSheetOpen) => set({ isReportSheetOpen }),
  setEmptyOnly: (emptyOnly) => set({ emptyOnly }),
  setShowHeatmap: (showHeatmap) => set({ showHeatmap }),

  bulkSetSpaces: (spaces) =>
    set({
      spaces: spaces.reduce<Record<string, Space>>((acc, s) => {
        acc[s.id] = s;
        return acc;
      }, {}),
    }),
}));
