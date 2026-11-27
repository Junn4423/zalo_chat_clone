const mockNotificationMmkvStores = new Map<string, Map<string, string>>();

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((options?: {id?: string}) => {
    const id = options?.id || 'default';
    if (!mockNotificationMmkvStores.has(id)) mockNotificationMmkvStores.set(id, new Map());
    const values = mockNotificationMmkvStores.get(id)!;
    return {
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
      delete: (key: string) => values.delete(key),
    };
  }),
}));

const loadPreferences = () => {
  let preferences: typeof import('../src/services/notificationPreferences') | undefined;
  jest.isolateModules(() => {
    preferences = require('../src/services/notificationPreferences');
  });
  return preferences!;
};

describe('per-account notification preferences', () => {
  beforeEach(() => mockNotificationMmkvStores.clear());

  it('uses safe defaults and isolates preferences by account', () => {
    const {DEFAULT_NOTIFICATION_PREFERENCES, getNotificationPreferences, updateNotificationPreferences} = loadPreferences();
    expect(getNotificationPreferences('account-a')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    updateNotificationPreferences('account-a', {enabled: false, previewEnabled: false});

    expect(getNotificationPreferences('account-a')).toMatchObject({enabled: false, previewEnabled: false});
    expect(getNotificationPreferences('account-b')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('publishes changes for screens that handle socket notifications', () => {
    const {subscribeNotificationPreferences, updateNotificationPreferences} = loadPreferences();
    const listener = jest.fn();
    const unsubscribe = subscribeNotificationPreferences(listener);

    const next = updateNotificationPreferences('account-a', {soundEnabled: false});

    expect(listener).toHaveBeenCalledWith('account-a', next);
    unsubscribe();
    updateNotificationPreferences('account-a', {vibrationEnabled: false});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not write settings when there is no signed-in account', () => {
    const {DEFAULT_NOTIFICATION_PREFERENCES, getNotificationPreferences, updateNotificationPreferences} = loadPreferences();
    expect(updateNotificationPreferences(null, {enabled: false})).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(getNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});
