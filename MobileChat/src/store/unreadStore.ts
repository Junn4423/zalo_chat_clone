import { create } from 'zustand';

interface UnreadStore {
  unreadCounts: Record<string, number>;
  setUnreadCount: (roomId: string, count: number) => void;
  replaceUnreadCounts: (counts: Record<string, number>) => void;
  incrementUnreadCount: (roomId: string) => void;
  resetUnreadCount: (roomId: string) => void;
  clearUnreadCounts: () => void;
  getTotalUnreadCount: () => number;
}

export const useUnreadStore = create<UnreadStore>((set, get) => ({
  unreadCounts: {},
  
  setUnreadCount: (roomId: string, count: number) => 
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: count
      }
    })),

  replaceUnreadCounts: (counts: Record<string, number>) => set({unreadCounts: counts}),
    
  incrementUnreadCount: (roomId: string) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: (state.unreadCounts[roomId] || 0) + 1
      }
    })),
    
  resetUnreadCount: (roomId: string) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: 0
      }
    })),

  clearUnreadCounts: () => set({unreadCounts: {}}),
    
  getTotalUnreadCount: () => {
    const { unreadCounts } = get();
    return Object.values(unreadCounts).reduce((total, count) => total + count, 0);
  }
}));
