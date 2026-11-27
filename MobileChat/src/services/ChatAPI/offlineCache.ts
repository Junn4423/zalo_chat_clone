import {MMKV} from 'react-native-mmkv';

const cache = new MMKV({id: 'mobilechat-offline-cache-v1'});

export type ConversationSnapshot = {
  users: any[];
  conversationUsers: any[];
  lastMessages: Record<string, any>;
  groupChats: any[];
  roomIds: Record<string, string>;
  unreadCounts?: Record<string, number>;
  hiddenRoomIds?: string[];
};

const userKey = (username: string) => encodeURIComponent(username);
const snapshotKey = (username: string) => `conversations:${userKey(username)}`;
const roomIndexKey = (username: string) => `rooms:${userKey(username)}`;
const roomMessagesKey = (username: string, roomId: string) =>
  `messages:${userKey(username)}:${encodeURIComponent(roomId)}`;

export function loadConversationSnapshot(username: string): ConversationSnapshot | null {
  try {
    const value = cache.getString(snapshotKey(username));
    return value ? JSON.parse(value) as ConversationSnapshot : null;
  } catch {
    return null;
  }
}

export function saveConversationSnapshot(username: string, snapshot: ConversationSnapshot) {
  try {
    cache.set(snapshotKey(username), JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Unable to save offline chat list', error);
  }
}

export function loadRoomMessages(username: string, roomId: string): any[] {
  try {
    const value = cache.getString(roomMessagesKey(username, roomId));
    const messages = value ? JSON.parse(value) : [];
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

export function saveRoomMessages(username: string, roomId: string, incoming: any[]) {
  try {
    const byId = new Map<string, any>();
    incoming.forEach(message => {
      if (message?._id) byId.set(String(message._id), message);
    });
    const messages = [...byId.values()]
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt ?? left.timestamp ?? 0).getTime() || 0;
        const rightTime = new Date(right.createdAt ?? right.timestamp ?? 0).getTime() || 0;
        return leftTime - rightTime || String(left._id).localeCompare(String(right._id));
      });
    cache.set(roomMessagesKey(username, roomId), JSON.stringify(messages));

    const indexKey = roomIndexKey(username);
    const rawIndex = cache.getString(indexKey);
    const index: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    const nextIndex = [...index.filter(id => id !== roomId), roomId];
    cache.set(indexKey, JSON.stringify(nextIndex));
  } catch (error) {
    console.warn('Unable to save offline chat messages', error);
  }
}

export function clearUserOfflineCache(username: string) {
  try {
    const rawIndex = cache.getString(roomIndexKey(username));
    const roomIds: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    roomIds.forEach(roomId => cache.delete(roomMessagesKey(username, roomId)));
    cache.delete(roomIndexKey(username));
    cache.delete(snapshotKey(username));
  } catch (error) {
    console.warn('Unable to clear offline chat cache', error);
  }
}
