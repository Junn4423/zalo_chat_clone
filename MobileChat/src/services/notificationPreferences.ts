import {MMKV} from 'react-native-mmkv';

export type NotificationPreferences = {
  enabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  previewEnabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  previewEnabled: true,
};

const storage = new MMKV({id: 'mobilechat-notification-preferences-v1'});
const listeners = new Set<(accountId: string, preferences: NotificationPreferences) => void>();
const keyFor = (accountId: string) => `preferences:${encodeURIComponent(accountId)}`;

const normalize = (value: Partial<NotificationPreferences> | null | undefined): NotificationPreferences => ({
  enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_NOTIFICATION_PREFERENCES.enabled,
  soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_NOTIFICATION_PREFERENCES.soundEnabled,
  vibrationEnabled: typeof value?.vibrationEnabled === 'boolean' ? value.vibrationEnabled : DEFAULT_NOTIFICATION_PREFERENCES.vibrationEnabled,
  previewEnabled: typeof value?.previewEnabled === 'boolean' ? value.previewEnabled : DEFAULT_NOTIFICATION_PREFERENCES.previewEnabled,
});

export function getNotificationPreferences(accountId?: string | null): NotificationPreferences {
  if (!accountId) return {...DEFAULT_NOTIFICATION_PREFERENCES};
  try {
    const raw = storage.getString(keyFor(accountId));
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return {...DEFAULT_NOTIFICATION_PREFERENCES};
  }
}

export function updateNotificationPreferences(
  accountId: string | null | undefined,
  updates: Partial<NotificationPreferences>,
): NotificationPreferences {
  if (!accountId) return {...DEFAULT_NOTIFICATION_PREFERENCES};
  const next = {...getNotificationPreferences(accountId), ...updates};
  storage.set(keyFor(accountId), JSON.stringify(next));
  listeners.forEach(listener => listener(accountId, next));
  return next;
}

export function subscribeNotificationPreferences(
  listener: (accountId: string, preferences: NotificationPreferences) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
