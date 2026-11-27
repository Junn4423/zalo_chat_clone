import {MMKV} from 'react-native-mmkv';

const storage = new MMKV({id: 'mobilechat-outbox-v1'});
const listeners = new Set<(accountId: string) => void>();

export type OutboxMessage = {
  id: string;
  accountId: string;
  roomId: string;
  type: 'text' | 'sticker' | 'gif';
  content: string;
  replyToId?: string;
  mentions?: string[];
  createdAt: string;
  lastAttemptAt?: string;
};

const keyFor = (accountId: string) => `messages:${encodeURIComponent(accountId)}`;

function read(accountId: string): OutboxMessage[] {
  try {
    const raw = storage.getString(keyFor(accountId));
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(accountId: string, items: OutboxMessage[]) {
  try {
    if (items.length) storage.set(keyFor(accountId), JSON.stringify(items));
    else storage.delete(keyFor(accountId));
    listeners.forEach(listener => listener(accountId));
  } catch (error) {
    console.warn('Could not persist pending chat messages', error);
    throw error;
  }
}

export function getOutboxMessages(accountId: string, roomId?: string) {
  const items = read(accountId);
  return roomId ? items.filter(item => String(item.roomId) === String(roomId)) : items;
}

export function enqueueOutboxMessage(input: Omit<OutboxMessage, 'id' | 'createdAt' | 'lastAttemptAt'>) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const item: OutboxMessage = {...input, id, createdAt: new Date().toISOString()};
  write(item.accountId, [...read(item.accountId), item]);
  return item;
}

export function markOutboxAttempted(accountId: string, id: string) {
  const items = read(accountId).map(item => item.id === id ? {...item, lastAttemptAt: new Date().toISOString()} : item);
  write(accountId, items);
}

export function retryOutboxMessage(accountId: string, id: string) {
  const items = read(accountId).map(item => item.id === id ? {...item, lastAttemptAt: undefined} : item);
  write(accountId, items);
}

export function removeOutboxMessage(accountId: string, id: string) {
  write(accountId, read(accountId).filter(item => item.id !== id));
}

export function subscribeOutbox(listener: (accountId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
