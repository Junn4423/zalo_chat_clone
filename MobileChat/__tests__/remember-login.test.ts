const mockMmkvStores = new Map<string, Map<string, string>>();

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((options?: {id?: string}) => {
    const id = options?.id || 'default';
    if (!mockMmkvStores.has(id)) mockMmkvStores.set(id, new Map());
    const values = mockMmkvStores.get(id)!;
    return {
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
      delete: (key: string) => values.delete(key),
    };
  }),
}));

const testAuth = {
  message: 'ok',
  user: {id: 'qa-user', username: 'qa-user', name: 'QA User'},
  token: 'qa-token',
};

const loadAuthStore = () => {
  let store: typeof import('../src/auth/store/login.store').useAuthStore | undefined;
  jest.isolateModules(() => {
    store = require('../src/auth/store/login.store').useAuthStore;
  });
  return store!;
};

const persistedAuthState = () => {
  const encoded = mockMmkvStores.get('default')?.get('auth-storage');
  return encoded ? JSON.parse(encoded).state : null;
};

describe('remember-login persistence', () => {
  beforeEach(async () => {
    mockMmkvStores.clear();
    const asyncStorage = require('@react-native-async-storage/async-storage');
    await asyncStorage.clear();
  });

  it('restores the persisted session, then clears auth while preserving the remembered username on logout', async () => {
    const store = loadAuthStore();
    store.getState().loginSuccess(testAuth, true);

    const storage = require('../src/auth/utils/storage');
    await storage.setToken(testAuth.token);
    await storage.setRememberedUsername(testAuth.user.username);

    expect(persistedAuthState()).toMatchObject({auth: testAuth, rememberLogin: true});

    const restoredStore = loadAuthStore();
    expect(restoredStore.getState().auth).toEqual(testAuth);
    expect(restoredStore.getState().rememberLogin).toBe(true);

    restoredStore.getState().logout();
    await storage.removeToken();

    expect(persistedAuthState()).toMatchObject({auth: null, rememberLogin: true});
    await expect(storage.getToken()).resolves.toBeNull();
    await expect(storage.getRememberedUsername()).resolves.toBe(testAuth.user.username);
  });

  it('does not persist a session or remembered username when remember-login is off', async () => {
    const store = loadAuthStore();
    store.getState().loginSuccess(testAuth, false);

    const storage = require('../src/auth/utils/storage');
    await Promise.all([storage.removeToken(), storage.removeRememberedUsername()]);

    expect(persistedAuthState()).toMatchObject({auth: null, rememberLogin: false});
    await expect(storage.getToken()).resolves.toBeNull();
    await expect(storage.getRememberedUsername()).resolves.toBeNull();
  });
});
