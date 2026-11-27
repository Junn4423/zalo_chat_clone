import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import {MMKV} from 'react-native-mmkv';
import {NativeModules} from 'react-native';
import {loginResponse} from '../types';
import {clearHiddenChatAccessToken} from '../../services/hiddenChatAccess';

type AuthStore = {
  auth: loginResponse | null;
  rememberLogin: boolean;
  loginSuccess: (auth: loginResponse, rememberLogin: boolean) => void;
  logout: () => void;
};
type PersistedAuthState = Pick<AuthStore, 'auth' | 'rememberLogin'>;
const storage = new MMKV();
export const useAuthStore = create<AuthStore>()(
  persist<AuthStore, [], [], PersistedAuthState>(
    set => ({
      auth: null,
      rememberLogin: false,
      loginSuccess: (auth, rememberLogin) => {
        clearHiddenChatAccessToken();
        set({auth, rememberLogin});
      },
      logout: () => {
        clearHiddenChatAccessToken();
        const locationBridge = NativeModules.MobileChatLocation;
        if (typeof locationBridge?.stopLiveLocationService === 'function') {
          void locationBridge.stopLiveLocationService('', true).catch(() => {});
        }
        set({auth: null});
      },
    }),
    {
      name: 'auth-storage',
      partialize: state => ({
        auth: state.rememberLogin ? state.auth : null,
        rememberLogin: state.rememberLogin,
      }),
      storage: createJSONStorage(() => ({
        getItem: key => {
          const value = storage.getString(key);
          return value ?? null;
        },
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: key => {
          storage.delete(key);
        },
      })),
    },
  ),
);
