import client from '../services/client';
import {registerSocketSessionInvalidator} from '../services/sessionLifecycle';
import constants from '../contents/Api_URL';
import {useAuthStore} from '../auth/store/login.store';
import {keepPickedAttachmentLocal, rememberLocalMedia} from '../services/ChatAPI/localMedia';

function uploadedAttachmentMetas(value: any): Array<{fileUrl?: string}> {
  const meta = value?.fileMeta || value?.result?.fileMeta || value;
  if (Array.isArray(meta?.images)) return meta.images;
  return meta?.fileUrl ? [meta] : [];
}

// Hàm upload file lên server, trả về url
export async function uploadFiles(files: Array<{ uri: string, name: string, type: string, duration?: number }>, roomId: string, replyToId?: string): Promise<any | null> {
  try {
    const auth = useAuthStore.getState().auth;
    const accountId = String(auth?.user?.username || '');
    const localFiles = await Promise.all(files.map(async file => ({
      ...file,
      uri: await keepPickedAttachmentLocal(accountId, file.uri, file.name),
    })));
    const formData = new FormData();
    localFiles.forEach(file => formData.append('file', {uri: file.uri, name: file.name, type: file.type} as any));
    formData.append('roomId', roomId);
    const audioDuration = files.length === 1 ? Number(files[0].duration) : 0;
    if (localFiles[0]?.type.startsWith('audio/') && Number.isFinite(audioDuration) && audioDuration > 0) {
      formData.append('fileDuration', String(audioDuration));
    }
    if (replyToId) formData.append('replyToId', replyToId);

    const response = await client.post(constants.API_URLS.UPLOAD, formData, {
      timeout: 90000,
      params: {roomId},
      // Axios defaults POST bodies to application/x-www-form-urlencoded. React
      // Native's OkHttp multipart bridge rejects that type before it opens the
      // request; multipart/form-data lets it generate the boundary itself.
      headers: {'Content-Type': 'multipart/form-data'},
    });

    if (response.data?.success && response.data.result) {
      if (accountId) {
        uploadedAttachmentMetas(response.data.result).forEach((meta, index) => {
          if (meta.fileUrl && localFiles[index]?.uri) {
            rememberLocalMedia(accountId, meta.fileUrl, localFiles[index].uri);
          }
        });
      }
      return response.data.result;
    }
    return null;
  } catch (err) {
    console.warn('Lỗi upload file:', err);
    return null;
  }
}

export const uploadFile = (file: {uri: string; name: string; type: string; duration?: number}, roomId: string, replyToId?: string) =>
  uploadFiles([file], roomId, replyToId);


import { io, Socket } from "socket.io-client";
import {enqueueOutboxMessage, getOutboxMessages, markOutboxAttempted, removeOutboxMessage, retryOutboxMessage} from '../services/ChatAPI/outbox';
import type {OutboxMessage} from '../services/ChatAPI/outbox';
import {getHiddenChatAccessToken} from '../services/hiddenChatAccess';


export let socket: Socket | null = null;
let outboxAccountId = '';
let flushingOutbox = false;
const outboxWaiters = new Map<string, {resolve: (value: any) => void; reject: (error: Error) => void}>();

async function flushOutbox() {
  if (flushingOutbox || !outboxAccountId || !socket?.connected) return;
  flushingOutbox = true;
  const accountId = outboxAccountId;
  try {
    while (socket?.connected && outboxAccountId === accountId) {
      const item = getOutboxMessages(accountId)[0];
      if (!item) break;
      // Keep an ambiguous attempt visible until reconnect or explicit retry;
      // the stable clientMessageId lets the server acknowledge it without duplication.
      if (item.lastAttemptAt) break;
      markOutboxAttempted(accountId, item.id);
      const activeSocket = socket;
      const outcome = await new Promise<{error: Error | null; result?: any}>(resolve => {
        activeSocket.timeout(15000).emit('sendMessageTo', {
          roomId: item.roomId,
          message: item.content,
          type: item.type,
          replyToId: item.replyToId,
          clientMessageId: item.id,
          hiddenChatAccessToken: getHiddenChatAccessToken() || undefined,
        }, (error: Error | null, result: any) => resolve({error, result}));
      });
      if (outboxAccountId !== accountId) break;
      if (outcome.error) {
        outboxWaiters.get(item.id)?.resolve({messageId: item.id, queued: true});
        outboxWaiters.delete(item.id);
        break;
      }
      if (!outcome.result?.success) {
        // A negative acknowledgement is definitive: the server did not save it.
        removeOutboxMessage(accountId, item.id);
        outboxWaiters.get(item.id)?.reject(new Error(outcome.result?.error || 'Không gửi được tin nhắn.'));
        outboxWaiters.delete(item.id);
        break;
      }
      removeOutboxMessage(accountId, item.id);
      outboxWaiters.get(item.id)?.resolve(outcome.result);
      outboxWaiters.delete(item.id);
    }
  } finally {
    flushingOutbox = false;
    if (outboxAccountId && outboxAccountId !== accountId && socket?.connected) void flushOutbox();
  }
}

export const connectSocket = (
  userId: string,
  chatToken: string,
  currentChatRoomId?: string
) => {
  console.log("Connecting socket with userId:", userId);
  const normalizedUserId = String(userId || '');
  const existingAuth = socket?.auth as Record<string, unknown> | undefined;
  if (socket && (String(existingAuth?.userId || '') !== normalizedUserId || String(existingAuth?.token || '') !== String(chatToken || ''))) {
    // Do not send a new account's outbox through a socket authenticated as an older account.
    disconnectSocket();
  }

  if (!socket) {
    const createdSocket = io(constants.API_ORIGIN, {
      path: constants.API_SOCKET_PATH,
      transports: ["websocket"],
      auth: { userId: normalizedUserId, token: chatToken },
      reconnection: true,
      // Keep retrying while the device is offline or changes Wi-Fi networks.
      // Chat history and call signaling recover when connectivity returns.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket = createdSocket;
    outboxAccountId = normalizedUserId;

    // Reply to the backend's application heartbeat so it can keep lastActive fresh.
    createdSocket.on('ping', timestamp => {
      if (socket === createdSocket) createdSocket.emit('pong', timestamp);
    });


    createdSocket.on("connect", () => {
      if (socket !== createdSocket) return;
      console.log("Kết nối socket thành công:", socket ? socket.id : "unknown");
      if (currentChatRoomId) {
        createdSocket.emit("joinRoom", { roomId: currentChatRoomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined });
        console.log("Tham gia phòng khi kết nối:", currentChatRoomId);
      }
      if (outboxAccountId) {
        getOutboxMessages(outboxAccountId).forEach(item => {
          if (item.lastAttemptAt) retryOutboxMessage(outboxAccountId, item.id);
        });
      }
      void flushOutbox();

      // Tự động request danh sách online users sau khi connect
      setTimeout(() => {
        if (socket === createdSocket && createdSocket.connected) {
          console.log("📋 Requesting online users list...");
          createdSocket.emit("getOnlineUsers");
        }
      }, 1000); // Đợi 1 giây để đảm bảo connection stable
    });

  }
  outboxAccountId = normalizedUserId;
  return socket;
};
export const disconnectSocket = () => {
  outboxAccountId = '';
  const previousSocket = socket;
  socket = null;
  if (previousSocket) {
    previousSocket.disconnect();
    outboxWaiters.forEach(waiter => waiter.resolve({queued: true}));
    outboxWaiters.clear();
    console.log("Đã ngắt kết nối socket");
  }
};
registerSocketSessionInvalidator(disconnectSocket);
export const handleRoomEvents = (socket: Socket, roomId: string) => {
  console.log("Handling room events for roomId:", roomId);
  socket.emit("joinRoom", { roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined }, () => {
    console.log("Đã tham gia phòng:", roomId);
    console.log(`${(socket as any).userId} joined room ${roomId}`);
  });
};

export async function joinChatRooms(roomIds: string[]): Promise<string[]> {
  const activeSocket = socket;
  if (!activeSocket?.connected) return [];
  const uniqueIds = Array.from(new Set(roomIds.map(String).filter(Boolean)));
  const joined: string[] = [];

  for (let offset = 0; offset < uniqueIds.length; offset += 20) {
    const batch = uniqueIds.slice(offset, offset + 20);
    const results = await Promise.all(batch.map(roomId => new Promise<string | null>(resolve => {
      activeSocket.timeout(5000).emit('joinRoom', {roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined}, (error: Error | null, response: any) => {
        resolve(!error && response?.success ? roomId : null);
      });
    })));
    joined.push(...results.filter((roomId): roomId is string => Boolean(roomId)));
    if (activeSocket !== socket || !activeSocket.connected) break;
  }

  return joined;
}

export function sendMessage(roomId: string, message: string, type: string = "text", fileMeta?: any, replyToId?: string, location?: {latitude: number; longitude: number; accuracy?: number; liveSessionId?: string; isLive?: boolean; expiresAt?: string}, poll?: any) {
  if ((type === 'text' || type === 'sticker' || type === 'gif') && !fileMeta) {
    if (!outboxAccountId) return Promise.reject(new Error('Chưa xác định tài khoản gửi tin nhắn.'));
    let item: OutboxMessage;
    try {
      item = enqueueOutboxMessage({accountId: outboxAccountId, roomId, content: message, type, replyToId});
    } catch (error: any) {
      return Promise.reject(new Error(error?.message || 'Không lưu được tin nhắn chờ gửi.'));
    }
    if (!socket?.connected) return Promise.resolve({messageId: item.id, queued: true});
    const result = new Promise<{messageId: string; queued?: boolean}>((resolve, reject) => {
      outboxWaiters.set(item.id, {resolve, reject});
    });
    void flushOutbox();
    return result;
  }
  if (!socket || !socket.connected) {
    return Promise.reject(new Error('Mất kết nối. Vui lòng kiểm tra mạng.'));
  }
  const activeSocket = socket;
  return new Promise<{messageId: string}>((resolve, reject) => {
    activeSocket.timeout(15000).emit("sendMessageTo", {roomId, message, type, fileMeta, replyToId, location, poll, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined}, (error: Error | null, result: any) => {
      if (error) reject(new Error('Chưa nhận được xác nhận. Hãy kiểm tra cuộc trò chuyện trước khi gửi lại.'));
      else if (!result?.success) reject(new Error(result?.error || 'Không gửi được tin nhắn.'));
      else resolve(result);
    });
  });
}

export function retryQueuedMessage(id: string) {
  if (!outboxAccountId) return;
  retryOutboxMessage(outboxAccountId, id);
  void flushOutbox();
}
export const getFileType = (fileType: string): "image" | "video" | "audio" | "file" => {
  if (fileType.startsWith("image")) return "image";
  if (fileType.startsWith("video")) return "video";
  if (fileType.startsWith("audio")) return "audio";
  return "file";
};

export function onReceiveMessage(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("receiveMessage", callback);
}

// Hủy đăng ký sự kiện nhận tin nhắn
export function offReceiveMessage(handler?: (data: any) => void) {
  if (!socket) return;
  if (handler) {
    socket.off("receiveMessage", handler);
  } else {
    socket.off("receiveMessage");
  }
}



// Gửi tín hiệu WebRTC qua socket (offer/answer/candidate)
export function sendWebRTCSignal(roomId: string, signal: any) {
  console.log("Emitting webrtc-signal", roomId, signal);
  if (!socket || !socket.connected) {
    console.warn("Socket chưa kết nối. Không thể gửi WebRTC signal.");
    return;
  }
  socket.emit("webrtc-signal", { roomId, signal });
}

// Lắng nghe tín hiệu WebRTC từ server (offer/answer/candidate)
const signalHandlers = new WeakMap<(signal: any) => void, (data: {signal: any}) => void>();
export function onWebRTCSignal(callback: (signal: any) => void) {
  if (!socket) return;
  const handler = (data: {signal: any}) => callback(data.signal);
  signalHandlers.set(callback, handler);
  socket.on("webrtc-signal", handler);
}

// Hủy đăng ký lắng nghe tín hiệu WebRTC
export function offWebRTCSignal(handler?: (signal: any) => void) {
  if (!socket) return;
  if (handler) {
    const listener = signalHandlers.get(handler);
    if (listener) socket.off("webrtc-signal", listener);
    signalHandlers.delete(handler);
  } else {
    socket.off("webrtc-signal");
  }
}

// socket on groupCreated
export function onGroupCreated(socket: Socket, callback: (data: any) => void) {

  if (!socket) return;
  socket.on("groupCreated", (data: any) => {
    callback(data);
    console.log("Nhóm mới được tạo:", data);
  });
}

// Đánh dấu tin nhắn đã đọc
export function markMessageAsRead(messageId?: string, roomId?: string) {
  if (!socket || !socket.connected) {
    console.warn("Socket chưa kết nối. Không thể đánh dấu tin nhắn đã đọc.");
    return;
  }

  if (messageId && roomId) {
    // Đánh dấu 1 tin nhắn cụ thể
    socket.emit('markAsRead', {messageId, roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
    console.log("Đánh dấu tin nhắn đã đọc:", messageId);
  } else if (roomId) {
    // Đánh dấu tất cả tin nhắn trong room
    socket.emit('markAsRead', {roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
    console.log("Đánh dấu tất cả tin nhắn trong room đã đọc:", roomId);
  }
}

// Lắng nghe sự kiện tin nhắn được đánh dấu đã đọc
export function onMarkAsReadSuccess(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("markAsReadSuccess", callback);
}

// Lắng nghe số lượng tin nhắn chưa đọc
export function onUnreadCountResponse(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("unreadCountResponse", (data: any) => {
    callback(data);
  });
}

// Lấy số lượng tin nhắn chưa đọc
export function getUnreadCount(roomId: string) {
  if (!socket || !socket.connected) {
    console.warn("Socket chưa kết nối. Không thể lấy số tin nhắn chưa đọc.");
    return;
  }
  socket.emit('getUnreadCount', {roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
}

// Lắng nghe tin nhắn mới được đọc bởi người khác (để cập nhật UI)
export function onMessageRead(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("messageRead", callback);
}

// Hủy đăng ký sự kiện tin nhắn được đọc
export function offMessageRead(handler?: (data: any) => void) {
  if (!socket) return;
  if (handler) {
    socket.off("messageRead", handler);
  } else {
    socket.off("messageRead");
  }
}

export function onAllMessagesRead(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("allMessagesRead", callback);
}

export function offAllMessagesRead(handler?: (data: any) => void) {
  if (!socket) return;
  if (handler) socket.off("allMessagesRead", handler);
  else socket.off("allMessagesRead");
}

// Hủy đăng ký các sự kiện đánh dấu đã đọc
export function offMarkAsReadEvents(handler?: (data: any) => void) {
  if (!socket) return;
  if (handler) {
    socket.off("markAsReadSuccess", handler);
    socket.off("unreadCountResponse", handler);
  } else {
    socket.off("markAsReadSuccess");
    socket.off("unreadCountResponse");
  }
}

// Cleanup tất cả handlers - hàm mới để dọn dẹp toàn bộ
export function cleanupAllSocketHandlers() {
  if (!socket) return;

  console.log("🧹 Cleaning up all socket handlers");
  socket.off("receiveMessage");
  socket.off("messageUpdated");
  socket.off("messageDeleted");
  socket.off("messageHidden");
  socket.off("markAsReadSuccess");
  socket.off("unreadCountResponse");
  socket.off("messageRead");
  socket.off("allMessagesRead");
  socket.off("messageReadStatus");
  socket.off("groupCreated");
  socket.off("groupMembersUpdated");
  socket.off("groupAdminChanged");
  socket.off("groupImageChanged");
  socket.off("groupRemoved");
  socket.off("roomDeleted");
  socket.off("groupRenamed");
  socket.off("groupImageChanged");
  socket.off("chatPreferenceChanged");
  socket.off("onlineUsers");
  socket.off("userOnline");
  socket.off("userOffline");
}

// Lấy thông tin ai đã đọc tin nhắn trong group
export function getMessageReadStatus(messageId: string, roomId: string) {
  if (!socket || !socket.connected) {
    console.warn("Socket not connected when getting message read status");
    return;
  }
  socket.emit('getMessageReadStatus', {messageId, roomId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
}

// Lắng nghe thông tin ai đã đọc tin nhắn
export function onMessageReadStatus(callback: (data: any) => void) {
  if (!socket) return;
  socket.on("messageReadStatus", callback);
}

// Hủy đăng ký sự kiện trạng thái đọc tin nhắn
export function offMessageReadStatus(handler?: (data: any) => void) {
  if (!socket) return;
  if (handler) {
    socket.off("messageReadStatus", handler);
  } else {
    socket.off("messageReadStatus");
  }
}

export function handleOnlineUserEvents(socket: Socket, {
  onOnlineUsers,
  onUserOnline,
  onUserOffline
}: {
  onOnlineUsers?: (users: string[]) => void,
  onUserOnline?: (userId: string) => void,
  onUserOffline?: (userId: string) => void
}) {
  if (!socket) {
    console.warn('Socket is null, cannot listen online user events');
    return;
  }

  console.log('🎯 Setting up online user event listeners...');

  socket.on("onlineUsers", (users: string[]) => {
    console.log("📋 Online users received:", users);
    console.log("📊 Total online users:", users.length);

    // Filter out duplicates
    const uniqueUsers = [...new Set(users)];
    console.log("🔄 Filtered unique users:", uniqueUsers);

    if (onOnlineUsers) onOnlineUsers(uniqueUsers);
  });

  socket.on("userOnline", async (data: any) => {
    console.log("🟢 User online event:", data);
    console.log("🔍 User data type:", typeof data);
    console.log("🔍 Full data object:", JSON.stringify(data, null, 2));

    // Backend có thể gửi object hoặc string
    let userId: string;
    if (typeof data === 'string') {
      userId = data;
    } else if (data && data.userId) {
      userId = data.userId;
    } else {
      console.warn("❌ Invalid userOnline data format:", data);
      return;
    }

    console.log("✅ Extracted userId:", userId);
    if (onUserOnline) {
      onUserOnline(userId);
    }
  });

  socket.on("userOffline", (data: any) => {
    console.log("🔴 User offline event:", data);

    // Backend có thể gửi object hoặc string
    let userId: string;
    if (typeof data === 'string') {
      userId = data;
    } else if (data && data.userId) {
      userId = data.userId;
    } else {
      console.warn("❌ Invalid userOffline data format:", data);
      return;
    }

    console.log("✅ Extracted userId:", userId);
    if (onUserOffline) {
      onUserOffline(userId);
    }
  });
}
