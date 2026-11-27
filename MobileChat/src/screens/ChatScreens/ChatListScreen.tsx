import React, { useEffect, useState, useRef } from "react";
import { View, Text, FlatList, ScrollView, TouchableOpacity, Vibration, Image, Alert } from "react-native";
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFocusEffect } from "@react-navigation/native";
import PushNotification from "react-native-push-notification";
import { styles } from "./css/ChatListScreen.style";
import SearchHeader from "../../components/SearchHeader";
import QrScannerModal from "../../components/QrScannerModal";
import { layTatCaNhanVien } from "../../services/UserAPI/api";
import { User } from "../../types/User";
import { LayTaoPhongChat, getLastMessageOfRoom, LayTatCaPhongChat, setRoomPin, setRoomMute, getHiddenRoomIds, joinGroupByInvite } from "../../services/ChatAPI/api";
import { useAuthStore } from "../../auth/store/login.store";
import { useUnreadStore } from "../../store/unreadStore";
import { 
  socket, 
  connectSocket,
  getUnreadCount,
  onUnreadCountResponse,
  markMessageAsRead,
  onMarkAsReadSuccess,
  onReceiveMessage,
  cleanupAllSocketHandlers,
  onGroupCreated,
  handleOnlineUserEvents,
  joinChatRooms,
} from "../../utils/socket";
import constants from "../../contents/Api_URL";
import {ConversationSnapshot, loadConversationSnapshot, saveConversationSnapshot} from "../../services/ChatAPI/offlineCache";
import {getVisibleCachedRoomIds} from "../../utils/chatRoomSync";
import {getNotificationPreferences, subscribeNotificationPreferences} from "../../services/notificationPreferences";
import {parseInviteLink} from "../../utils/friendInvite";

const hasRealMessage = (message: any) => Boolean(message && (message._id || message.timestamp || message.createdAt || message.content || message.fileMeta?.fileUrl));

const formatLastMessagePreview = (message: any, currentUserId?: string, includeSender = false) => {
  if (!message || typeof message !== 'object') return 'Không có tin nhắn';

  let display = '';
  if (message.deletedAt) display = 'Tin nhắn đã thu hồi';
  else if (message.type === 'image') display = '[Ảnh]';
  else if (message.type === 'video') display = '[Video]';
  else if (message.type === 'audio') display = '[Audio]';
  else if (message.type === 'location') display = '[Vị trí]';
  else if (message.type === 'gif') display = '[GIF]';
  else if (message.type === 'sticker') display = message.content ? `[Sticker] ${message.content}` : '[Sticker]';
  else if (message.type === 'poll') display = `[Bình chọn] ${message.content || message.poll?.question || ''}`.trim();
  else if (message.type === 'file') display = message.fileMeta?.fileName ? `[File] ${message.fileMeta.fileName}` : '[File]';
  else if (message.content) display = String(message.content);
  else display = '[Tin nhắn mới]';

  if (String(message.userId) === String(currentUserId)) return `Bạn: ${display}`;
  if (includeSender && message.userId) return `${message.userId}: ${display}`;
  return display;
};

const formatConversationTime = (value?: string | number | Date) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const isSameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (isSameDay(date, today)) return date.toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'});
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Hôm qua';
  return date.toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit'});
};

const initialsFor = (name?: string) => {
  const words = String(name || '').trim().replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase();
};

const avatarColorFor = (key?: string) => {
  const palette = ['#dceafe', '#e6e1ff', '#d9f2ea', '#ffeadc', '#fce1ec', '#e1edf1'];
  const hash = Array.from(String(key || '?')).reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
};

export default function ChatListScreen({ navigation }: { navigation: any }) {
  const [refreshing, setRefreshing] = useState(false);
  const [searchValue, setSearchValue] = useState<string>("");
  const [users, setUsers] = useState<User[]>([]);
  const [conversationUsers, setConversationUsers] = useState<Array<User & {roomId: string; _id: string}>>([]);
  const [lastMessages, setLastMessages] = useState<Record<string, any>>({});
  const [groupChats, setGroupChats] = useState<any[]>([]);
  const [roomIds, setRoomIds] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [employeeLoadError, setEmployeeLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'priority' | 'unread' | 'employees' | 'groups'>('all');
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [pendingOnlineEvents, setPendingOnlineEvents] = useState<string[]>([]);
  const [snapshotOwner, setSnapshotOwner] = useState<string | null>(null);
  const [hiddenRoomIds, setHiddenRoomIds] = useState<string[]>([]);
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const auth = useAuthStore(state => state.auth);
  const { unreadCounts, setUnreadCount, resetUnreadCount } = useUnreadStore();

  const handleInviteScan = async (value: string) => {
    setQrScannerVisible(false);
    const invite = parseInviteLink(value);
    if (!invite) {
      Alert.alert('Mã QR không hợp lệ', 'Hãy quét mã kết bạn hoặc mã mời nhóm MobileChat.');
      return;
    }
    if (invite.type === 'friend') {
      navigation.navigate('Directory', {openTab: 'discover', searchUsername: invite.username});
      return;
    }
    try {
      const room = await joinGroupByInvite(invite.token);
      void handleRefresh();
      navigation.navigate('ChatDetail', {chatId: room.roomId, chatType: 'group', chatName: room.name});
    } catch (error: any) {
      Alert.alert('Không vào được nhóm', error?.response?.data?.error || error?.message || 'Liên kết mời có thể đã hết hạn.');
    }
  };
  
  // Sử dụng ref để lưu trữ giá trị hiện tại cho việc so sánh trong socket handler
  const currentUsersRef = useRef<User[]>([]);
  const currentRoomIdsRef = useRef<Record<string, string>>({});
  const currentGroupIdsRef = useRef<Set<string>>(new Set());
  const hiddenRoomIdsRef = useRef<Set<string>>(new Set());
  const mutedRoomIdsRef = useRef<Set<string>>(new Set());
  const muteExpiryRef = useRef<Record<string, string | null>>({});
  const handlersSetupRef = useRef<boolean>(false);
  const isReloadingRef = useRef(false);
  const detectNewUserTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);
  const lastDataFetchAtRef = useRef(0);
  const fetchDataPromiseRef = useRef<Promise<void> | null>(null);
  const fetchDataQueuedRef = useRef(false);
  const socketListRevisionRef = useRef(0);
  const roomListLoadedRef = useRef(false);
  const visibleRoomIdsRef = useRef<string[]>([]);
  const socketReconnectHandlerRef = useRef<(() => void) | null>(null);
  const notificationPreferencesRef = useRef(getNotificationPreferences(auth?.user?.username));

  useEffect(() => {
    const accountId = String(auth?.user?.username || '');
    notificationPreferencesRef.current = getNotificationPreferences(accountId);
    if (!accountId) return undefined;
    return subscribeNotificationPreferences((changedAccountId, preferences) => {
      if (changedAccountId === accountId) notificationPreferencesRef.current = preferences;
    });
  }, [auth?.user?.username]);

  useEffect(() => {
    const username = auth?.user?.username;
    setSnapshotOwner(null);
    if (!username) {
      useUnreadStore.getState().clearUnreadCounts();
      setUsers([]);
      setConversationUsers([]);
      setLastMessages({});
      setGroupChats([]);
      setRoomIds({});
      setHiddenRoomIds([]);
      hiddenRoomIdsRef.current.clear();
      return;
    }

    const snapshot = loadConversationSnapshot(username);
    const cachedUsers = snapshot?.users || [];
    const cachedConversations = snapshot?.conversationUsers || [];
    const cachedGroups = snapshot?.groupChats || [];
    const cachedRoomIds = snapshot?.roomIds || {};
    const cachedHiddenRoomIds = (snapshot?.hiddenRoomIds || []).map(String);
    const cachedHiddenSet = new Set(cachedHiddenRoomIds);
    const visibleCachedRoomIds = Object.fromEntries(Object.entries(cachedRoomIds).filter(([, roomId]) => !cachedHiddenSet.has(String(roomId))));
    const cachedLastMessages = snapshot?.lastMessages || {};
    setUsers(cachedUsers);
    setConversationUsers(cachedConversations.filter((room: any) => !cachedHiddenSet.has(String(room.roomId || room._id))));
    setLastMessages(Object.fromEntries(Object.entries(cachedLastMessages).filter(([userId]) => !cachedHiddenSet.has(String(cachedRoomIds[userId] || '')))));
    setGroupChats(cachedGroups.filter((room: any) => !cachedHiddenSet.has(String(room._id))));
    setRoomIds(visibleCachedRoomIds);
    setHiddenRoomIds(cachedHiddenRoomIds);
    hiddenRoomIdsRef.current = cachedHiddenSet;
    currentUsersRef.current = cachedUsers;
    currentRoomIdsRef.current = visibleCachedRoomIds;
    currentGroupIdsRef.current = new Set(cachedGroups.filter((room: any) => !cachedHiddenSet.has(String(room._id))).map((room: any) => String(room._id)));
    visibleRoomIdsRef.current = getVisibleCachedRoomIds(cachedRoomIds, cachedGroups, cachedHiddenRoomIds);
    mutedRoomIdsRef.current = new Set([...cachedGroups, ...cachedConversations].filter((room: any) => room.isMuted).map((room: any) => String(room._id || room.roomId)));
    muteExpiryRef.current = Object.fromEntries([...cachedGroups, ...cachedConversations].filter((room: any) => room.isMuted).map((room: any) => [String(room._id || room.roomId), room.mutedUntil || null]));
    useUnreadStore.getState().replaceUnreadCounts(snapshot?.unreadCounts || {});
    setSnapshotOwner(username);
  }, [auth?.user?.username]);

  useEffect(() => {
    const username = auth?.user?.username;
    if (!username || snapshotOwner !== username) return;
    const snapshot: ConversationSnapshot = {users, conversationUsers, lastMessages, groupChats, roomIds, unreadCounts, hiddenRoomIds};
    saveConversationSnapshot(username, snapshot);
  }, [auth?.user?.username, snapshotOwner, users, conversationUsers, lastMessages, groupChats, roomIds, unreadCounts, hiddenRoomIds]);
  
  // Xử lý các pending online events khi users đã được load
  useEffect(() => {
    if (pendingOnlineEvents.length > 0 && currentUsersRef.current.length > 0) {
      console.log(" Processing pending online events:", pendingOnlineEvents);
      
      pendingOnlineEvents.forEach(username => {
        // Thử tìm theo maNhanVien trước
        let user = currentUsersRef.current.find(u => u.maNhanVien === username);
        if (!user) {
          // Nếu không tìm thấy, thử tìm theo userId
          user = currentUsersRef.current.find(u => u.userId === username);
        }
        
        if (user) {
          console.log(`Processed pending event: ${username} -> ${user.userId} (${user.tenNhanVien})`);
          const userId = user.userId;
          setOnlineUsers(prev => new Set([...prev, userId]));
        } else {
          console.log(`Still cannot process pending event: ${username}`);
        }
      });
      
      // Clear pending events
      setPendingOnlineEvents([]);
    }
  }, [pendingOnlineEvents, users]);

  // Lấy dữ liệu user và last message
  const fetchDataOnce = async () => {
    lastDataFetchAtRef.current = Date.now();
    const socketRevisionAtStart = socketListRevisionRef.current;
    setLoadError('');
    //Gọi lại connect socket
    if (auth && auth.user && auth.token) {
      connectSocket(auth.user.username, auth.token);
      
      // Setup handlers immediately after connecting, but only once
      if (!handlersSetupRef.current) {
        setupSocketHandlers();
        handlersSetupRef.current = true;
      }
    }
    
    console.log(" Fetching fresh data...");
    const roomsPromise: Promise<any[] | null> = LayTatCaPhongChat()
      .then(response => {
        return Array.isArray(response) ? response : Array.isArray(response?.rooms) ? response.rooms : [];
      })
      .catch(error => {
        console.error("Unable to load conversation rooms:", error);
        setLoadError('Không tải được danh sách chat. Kiểm tra mạng rồi chạm để thử lại.');
        return null;
      });
    const hiddenIdsPromise = getHiddenRoomIds().catch(error => {
      console.warn('Unable to load hidden chat IDs:', error?.message || error);
      return Array.from(hiddenRoomIdsRef.current);
    });

    let data: User[] = [];
    try {
      data = (await layTatCaNhanVien()).filter(user => !!user.userId && user.userId !== auth?.user?.username);
      setEmployeeLoadError('');
    } catch (error) {
      console.error('Unable to load employees:', error);
      setEmployeeLoadError('Không tải được danh sách nhân viên. Chạm để thử lại.');
      data = [];
    }
    setUsers(data);
    
    // Update refs immediately after setting users
    currentUsersRef.current = data;
    console.log("Updated currentUsersRef with", data.length, "users:", data.map(u => ({ userId: u.userId, maNhanVien: u.maNhanVien })));
    
    // Xử lý pending online events nếu có
    if (pendingOnlineEvents.length > 0) {
      console.log(" Processing pending online events:", pendingOnlineEvents);
      const processedEvents = new Set<string>();
      
      pendingOnlineEvents.forEach(username => {
        let user = data.find(u => u.maNhanVien === username);
        if (!user) {
          user = data.find(u => u.userId === username);
        }
        if (!user && auth?.user?.username === username) {
          user = data.find(u => u.userId === auth.user.id || u.maNhanVien === auth.user.username);
        }
        
        if (user) {
          processedEvents.add(user.userId);
          console.log(` Processed pending event: ${username} -> ${user.userId}`);
        } else {
          console.log(`Still cannot process pending event: ${username}`);
        }
      });
      
      if (processedEvents.size > 0) {
        setOnlineUsers(prev => {
          const newSet = new Set(prev);
          processedEvents.forEach(userId => newSet.add(userId));
          return newSet;
        });
        setPendingOnlineEvents([]);
      }
    }

    // Lấy nhóm chat và last message cho từng group
    // Load existing conversations in one request. The employee directory is only
    // used by the online tab and must not create rooms for every employee.
    const [rooms, latestHiddenRoomIds] = await Promise.all([roomsPromise, hiddenIdsPromise]);
    if (rooms === null) return;
    hiddenRoomIdsRef.current = new Set(latestHiddenRoomIds.map(String));
    setHiddenRoomIds(Array.from(hiddenRoomIdsRef.current));
    visibleRoomIdsRef.current = rooms.filter(room => room?._id && !hiddenRoomIdsRef.current.has(String(room._id))).map(room => String(room._id));
    roomListLoadedRef.current = true;
    if (socket?.connected) await joinChatRooms(visibleRoomIdsRef.current);
    if (socketRevisionAtStart !== socketListRevisionRef.current) {
      // A message or room change arrived while this snapshot was in flight.
      // Discard it and let the serialized refresh loop fetch a current snapshot.
      fetchDataQueuedRef.current = true;
      return;
    }

    const groupRooms = rooms.filter(room => room.type === 'group');
    mutedRoomIdsRef.current = new Set(rooms.filter(room => room.isMuted).map(room => String(room._id)));
    muteExpiryRef.current = Object.fromEntries(rooms.filter(room => room.isMuted).map(room => [String(room._id), room.mutedUntil || null]));
    currentGroupIdsRef.current = new Set(groupRooms.map(room => String(room._id)));
    const oneToOneRooms = rooms.filter(room => room.type === 'one-to-one');
    const groupsWithMsg = groupRooms.map(room => ({
      ...room,
      type: 'group',
      lastMessage: hasRealMessage(room.lastMessage) ? {
        ...room.lastMessage,
        timestamp: room.lastMessage.timestamp || room.lastMessage.createdAt,
      } : null,
    }));
    setGroupChats(groupsWithMsg);

    const msgMap: Record<string, any> = {};
    const roomIdMap: Record<string, string> = {};
    const chats = oneToOneRooms.flatMap(room => {
      const counterpartId = room.user?.lv001 || room.participants?.find((id: string) => id !== auth?.user?.username);
      if (!counterpartId || !room._id) return [];
      const employee = data.find(user => user.userId === counterpartId);
      const roomId = String(room._id);
      roomIdMap[counterpartId] = roomId;
      if (hasRealMessage(room.lastMessage)) {
        msgMap[counterpartId] = {
          ...room.lastMessage,
          timestamp: room.lastMessage.timestamp || room.lastMessage.createdAt,
        };
      }
      return [{
        ...(employee || {} as User),
        userId: counterpartId,
        maNhanVien: employee?.maNhanVien || counterpartId,
        tenNhanVien: room.user?.name || employee?.tenNhanVien || counterpartId,
        avatar: room.user?.avatar || employee?.avatar,
        isMuted: Boolean(room.isMuted),
        mutedUntil: room.mutedUntil || null,
        isPinned: Boolean(room.isPinned),
        roomId,
        _id: roomId,
      }];
    });
    setConversationUsers(chats);
    setLastMessages(msgMap);
    setRoomIds(roomIdMap);
    currentRoomIdsRef.current = {
      ...roomIdMap,
      ...Object.fromEntries(rooms.map(room => [String(room._id), String(room._id)])),
    };
    for (const room of rooms) {
      if (room._id) setUnreadCount(String(room._id), Number(room.unreadCount) || 0);
    }
    if (socket) rooms.forEach(room => room._id && getUnreadCount(String(room._id)));
    console.log("Loaded conversations:", {direct: chats.length, groups: groupsWithMsg.length});
  };

  // Keep the initial load, reconnect refreshes and pull-to-refresh serialized.
  // Concurrent callers request one follow-up pass instead of racing to replace
  // conversation previews in whichever HTTP response happens to finish last.
  const fetchData = () => {
    if (fetchDataPromiseRef.current) {
      fetchDataQueuedRef.current = true;
      return fetchDataPromiseRef.current;
    }

    const activePromise = (async () => {
      try {
        do {
          fetchDataQueuedRef.current = false;
          await fetchDataOnce();
        } while (fetchDataQueuedRef.current);
      } finally {
        fetchDataPromiseRef.current = null;
      }
    })();
    fetchDataPromiseRef.current = activePromise;
    return activePromise;
  };
  fetchDataRef.current = fetchData;

  // Force reload data when detecting new users - với debounce
  const forceReloadData = async () => {
    if (isReloadingRef.current) {
      console.log("Already reloading, skipping...");
      return;
    }
    
    console.log("Force reloading data for new user detection...");
    isReloadingRef.current = true;
    
    try {
      await fetchData();
    } catch (error) {
      console.error(" Error force reloading data:", error);
    } finally {
      isReloadingRef.current = false;
    }
  };

  // Setup socket handlers - chỉ setup một lần khi component mount
  const setupSocketHandlers = () => {
    if (!socket || !auth?.user?.id) {
      console.log("Socket or auth not available for handlers setup");
      return;
    }

    const noteSocketListMutation = () => {
      socketListRevisionRef.current += 1;
      if (fetchDataPromiseRef.current) fetchDataQueuedRef.current = true;
    };

    // The initial fetch already starts from the screen effect. If it failed
    // before the first socket connection, retry once on connect; on every
    // later reconnect, refresh previews regardless of how recently the app
    // last fetched them so brief network drops cannot leave stale chats.
    let initialConnectHandled = Boolean(socket.connected);
    const reconnectHandler = () => {
      // Rejoin the last known visible rooms immediately. The cache is available
      // before the REST room list finishes loading after a Wi-Fi transition.
      void joinChatRooms(visibleRoomIdsRef.current);
      if (!initialConnectHandled) {
        initialConnectHandled = true;
        if (!roomListLoadedRef.current) void fetchDataRef.current?.();
        return;
      }
      void fetchDataRef.current?.();
    };
    socket.on('connect', reconnectHandler);
    socketReconnectHandlerRef.current = reconnectHandler;
    
    // Setup unread count handler
    const unreadHandler = (data: any) => {
      console.log("Cập nhật unread count:", data);
      setUnreadCount(data.roomId, data.unreadCount);
    };
    onUnreadCountResponse(unreadHandler);

    // Setup mark as read handler
    const markReadHandler = (data: any) => {
      console.log("Đánh dấu đã đọc thành công:", data);
      setUnreadCount(data.roomId, 0);
    };
    onMarkAsReadSuccess(markReadHandler);
    
    // Setup online user handlers
    const onlineUsersHandler = (onlineUsernames: string[]) => {
      console.log(" Online users list received:", onlineUsernames);
      console.log(" Current users in app:", currentUsersRef.current.map(u => ({ userId: u.userId, maNhanVien: u.maNhanVien, tenNhanVien: u.tenNhanVien })));
      // Tạo mapping từ username/maNhanVien sang userId để so sánh đúng
      const onlineUserIds = new Set<string>();
      onlineUsernames.forEach(username => {
        // The server includes the signed-in account in this broadcast, but
        // that account is intentionally absent from the contacts collection.
        if (auth?.user && (username === auth.user.id || username === auth.user.username)) {
          return;
        }

        // Thử tìm theo userId trước
        let user = currentUsersRef.current.find(u => u.userId === username);
        if (!user) {
          // Nếu không tìm thấy, thử tìm theo maNhanVien
          user = currentUsersRef.current.find(u => u.maNhanVien === username);
        }
        if (user) {
          onlineUserIds.add(user.userId);
          console.log(`Mapped ${username} -> ${user.userId} (${user.tenNhanVien})`);
        } else {
          console.log(`Could not map username: ${username} - user not in current user list`);
          console.log("Current user info:", { id: auth?.user?.id, username: auth?.user?.username });
          
          // Nếu users chưa được load, lưu lại để xử lý sau
          if (currentUsersRef.current.length === 0) {
            setPendingOnlineEvents(prev => [...prev, username]);
          }
        }
      });
      
      // The server sends an authoritative snapshot; replacing the set also
      // clears contacts whose offline event was missed while this screen slept.
      setOnlineUsers(onlineUserIds);
      
      console.log(" Final online users set:", Array.from(onlineUserIds));
    };
    
    const userOnlineHandler = (data: any) => {
      console.log(" User online event received:", data);
      console.log(" Data type:", typeof data);
      console.log(" Current users in ref:", currentUsersRef.current.map(u => ({ userId: u.userId, maNhanVien: u.maNhanVien, tenNhanVien: u.tenNhanVien })));
      
      // Extract userId từ object hoặc string
      let username: string;
      if (typeof data === 'string') {
        username = data;
      } else if (data && data.userId) {
        username = data.userId;
      } else {
        console.warn(" Invalid userOnline data format:", data);
        return;
      }
      
      console.log("Extracted username:", username);
      console.log(" Looking for user with maNhanVien or userId:", username);

      // The online event can be broadcast back to this client. The current
      // account is not part of the contacts list, so handle it before lookup.
      const currentUser = auth?.user;
      if (currentUser && (username === currentUser.id || username === currentUser.username)) {
        setOnlineUsers(prev => new Set([...prev, currentUser.id]));
        return;
      }
      
      // Thử tìm theo maNhanVien trước
      let user = currentUsersRef.current.find(u => u.maNhanVien === username);
      if (!user) {
        // Nếu không tìm thấy, thử tìm theo userId
        user = currentUsersRef.current.find(u => u.userId === username);
      }
      if (!user) {
        // Nếu vẫn không tìm thấy, thử tìm theo username của current user
        if (auth?.user?.username === username) {
          user = currentUsersRef.current.find(u => u.userId === auth.user.id || u.maNhanVien === auth.user.username);
        }
      }
      
      if (user) {
        console.log(`Found user: ${user.tenNhanVien} (${user.userId})`);
        const userId = user.userId;
        setOnlineUsers(prev => new Set([...prev, userId]));
      } else {
        console.log(` User not found for username: ${username}`);
        console.log(" Available users:", currentUsersRef.current.map(u => `${u.maNhanVien}(${u.userId})`));
        console.log("👤Current user info:", { id: auth?.user?.id, username: auth?.user?.username });
        
        // Nếu users chưa được load, lưu lại để xử lý sau
        if (currentUsersRef.current.length === 0) {
          console.log(`⏳ Users not loaded yet, saving ${username} for later processing`);
          setPendingOnlineEvents(prev => [...prev, username]);
        }
      }
    };
    
    const userOfflineHandler = (data: any) => {
      console.log("User offline event received:", data);
      console.log("Current users in ref:", currentUsersRef.current.map(u => ({ userId: u.userId, maNhanVien: u.maNhanVien, tenNhanVien: u.tenNhanVien })));
      
      // Extract userId từ object hoặc string
      let username: string;
      if (typeof data === 'string') {
        username = data;
      } else if (data && data.userId) {
        username = data.userId;
      } else {
        console.warn(" Invalid userOffline data format:", data);
        return;
      }

      // Ignore the current account's presence event: it is not shown as a
      // contact and will be updated by the normal socket connection lifecycle.
      const currentUser = auth?.user;
      if (currentUser && (username === currentUser.id || username === currentUser.username)) {
        setOnlineUsers(prev => {
          const next = new Set(prev);
          next.delete(currentUser.id);
          return next;
        });
        return;
      }
      
      // Thử tìm theo maNhanVien trước
      let user = currentUsersRef.current.find(u => u.maNhanVien === username);
      if (!user) {
        // Nếu không tìm thấy, thử tìm theo userId
        user = currentUsersRef.current.find(u => u.userId === username);
      }
      if (!user) {
        // Nếu vẫn không tìm thấy, thử tìm theo username của current user
        if (auth?.user?.username === username) {
          user = currentUsersRef.current.find(u => u.userId === auth.user.id || u.maNhanVien === auth.user.username);
        }
      }
      
      if (user) {
        console.log(`User going offline: ${user.tenNhanVien} (${user.userId})`);
        const userId = user.userId;
        setOnlineUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          return newSet;
        });
      } else {
        console.log(`User not found for offline event: ${username}`);
        console.log(" Current user info:", { id: auth?.user?.id, username: auth?.user?.username });
        
        // Nếu users chưa được load, lưu lại để xử lý sau
        if (currentUsersRef.current.length === 0) {
          console.log(` Users not loaded yet, cannot process offline event for ${username}`);
        }
      }
    };    handleOnlineUserEvents(socket, {
      onOnlineUsers: onlineUsersHandler,
      onUserOnline: userOnlineHandler,
      onUserOffline: userOfflineHandler
    });
    
    // Setup message handler - tối ưu hóa việc phát hiện user mới
    const messageHandler = (msg: any) => {
      const messageRoomId = msg.roomId == null ? '' : String(msg.roomId);
      if (messageRoomId && hiddenRoomIdsRef.current.has(messageRoomId)) return;
      console.log("=== Nhận tin nhắn mới ===", msg);
      noteSocketListMutation();
      
      if (msg.from !== auth?.user?.username) {
        const muteRoomId = String(msg.roomId);
        const expiry = muteExpiryRef.current[muteRoomId];
        const isMuted = mutedRoomIdsRef.current.has(muteRoomId) && (!expiry || new Date(expiry).getTime() > Date.now());
        if (!isMuted) mutedRoomIdsRef.current.delete(muteRoomId);
        const preferences = notificationPreferencesRef.current;
        const activeRoute = navigation.getCurrentRoute?.();
        const isOpenConversation = activeRoute?.name === 'ChatDetail' && String(activeRoute.params?.chatId || '') === messageRoomId;
        if (!isMuted && preferences.enabled && !isOpenConversation) {
          console.log("Showing notification for message from:", msg.from);
          if (preferences.vibrationEnabled) Vibration.vibrate(200);
          PushNotification.localNotification({
            channelId: "message-channel",
            title: `Tin nhắn từ ${msg.from}`,
            message: preferences.previewEnabled ? (msg.content || `Tin nhắn mới từ ${msg.from}!`) : 'Bạn có tin nhắn mới',
            playSound: preferences.soundEnabled,
            soundName: preferences.soundEnabled ? "default" : undefined,
            vibrate: preferences.vibrationEnabled,
          });
        }

        if (msg.roomId && socket) {
          console.log("Requesting unread count for:", msg.roomId);
          getUnreadCount(msg.roomId);
        }
      }
      
      // Kiểm tra user mới một cách thông minh hơn
      const currentRoomIds = new Set([
        ...Object.values(currentRoomIdsRef.current).map(String),
        ...Array.from(currentGroupIdsRef.current, String),
      ]);
      const currentUserIds = currentUsersRef.current.map(u => String(u.userId));
      // An empty conversation list is still a valid baseline. If the first
      // message arrives before any room has been loaded, reload so that new
      // direct and group conversations appear in the list.
      const incomingRoomId = messageRoomId;
      const incomingUserId = msg.from == null ? '' : String(msg.from);
      const isNewRoomId = !!incomingRoomId && !currentRoomIds.has(incomingRoomId);
      const isNewUser = !!incomingUserId && currentUserIds.length > 0 && !currentUserIds.includes(incomingUserId) && incomingUserId !== auth?.user?.username;
      
      if (isNewRoomId || isNewUser) {
        console.log("Phát hiện user/room mới! Scheduling gentle reload...");
        
        // Clear timeout cũ nếu có
        if (detectNewUserTimeoutRef.current) {
          clearTimeout(detectNewUserTimeoutRef.current);
        }
        
        // If a request is already in progress, noteSocketListMutation queued a
        // fresh pass. Otherwise keep the existing gentle debounce.
        if (!fetchDataPromiseRef.current) {
          detectNewUserTimeoutRef.current = setTimeout(() => {
            detectNewUserTimeoutRef.current = null;
            if (!isReloadingRef.current) {
              console.log(" Executing gentle reload for new user...");
              forceReloadData();
            }
          }, 2000);
        }
      } else {
        console.log(" Tin nhắn từ user/group đã biết, cập nhật last message và unread count");
        
        if (msg.roomId) {
          // Kiểm tra xem là tin nhắn từ user 1-1 hay group
          const userFromMessage = currentUsersRef.current.find(u => 
            String(currentRoomIdsRef.current[u.userId] || '') === incomingRoomId
          );
          
          const groupFromMessage = currentGroupIdsRef.current.has(incomingRoomId);
          
          if (userFromMessage) {
            console.log("Cập nhật last message cho user:", userFromMessage.userId);
            // Cập nhật last message cho user chat
            setLastMessages(prev => ({
              ...prev,
              [userFromMessage.userId]: {
                _id: msg._id,
                content: msg.content,
                type: msg.type,
                userId: msg.from,
                fileMeta: msg.fileMeta,
                location: msg.location,
                timestamp: msg.createdAt || new Date().toISOString()
              }
            }));
            const conversation = {...userFromMessage, roomId: msg.roomId, _id: msg.roomId};
            setConversationUsers(prev => [
              conversation,
              ...prev.filter(item => item.userId !== userFromMessage.userId),
            ]);
          } else if (groupFromMessage) {
            console.log("Cập nhật last message cho group:", msg.roomId);
            // Cập nhật last message cho group chat
            setGroupChats(prev => 
              prev.map(group => 
                String(group._id) === incomingRoomId 
                  ? {
                      ...group,
                      lastMessage: {
                        _id: msg._id,
                        content: msg.content,
                        type: msg.type,
                        userId: msg.from,
                        fileMeta: msg.fileMeta,
                        location: msg.location,
                        timestamp: msg.createdAt || new Date().toISOString()
                      }
                    }
                  : group
              )
            );
          }
          
          // Cập nhật unread count
          if (socket) {
            getUnreadCount(msg.roomId);
          }
        }
      }
    };
    
    onReceiveMessage(messageHandler);

    const messageUpdatedHandler = (message: any) => {
      const roomId = String(message?.roomId || '');
      const messageId = String(message?._id || '');
      if (!roomId || !messageId) return;
      noteSocketListMutation();
      const directUser = currentUsersRef.current.find(user => String(currentRoomIdsRef.current[user.userId] || '') === roomId);
      if (directUser) {
        setLastMessages(previous => {
          const current = previous[directUser.userId];
          if (String(current?._id || '') !== messageId) return previous;
          return {...previous, [directUser.userId]: {...current, content: message.content, editedAt: message.editedAt}};
        });
      }
      if (currentGroupIdsRef.current.has(roomId)) {
        setGroupChats(previous => previous.map(group => {
          const current = group.lastMessage;
          if (String(group._id) !== roomId || String(current?._id || '') !== messageId) return group;
          return {...group, lastMessage: {...current, content: message.content, editedAt: message.editedAt}};
        }));
      }
    };
    socket?.on('messageUpdated', messageUpdatedHandler);

    const messageDeletedHandler = (payload: any) => {
      const roomId = String(payload?.roomId || '');
      const messageId = String(payload?.messageId || '');
      if (!roomId || !messageId) return;
      noteSocketListMutation();
      const revokedPreview = (message: any) => ({...message, content: 'Tin nhắn đã thu hồi', type: 'text', fileMeta: undefined, deletedAt: payload.deletedAt || new Date().toISOString()});
      const directUser = currentUsersRef.current.find(user => String(currentRoomIdsRef.current[user.userId] || '') === roomId);
      if (directUser) {
        setLastMessages(previous => {
          const current = previous[directUser.userId];
          if (String(current?._id || '') !== messageId) return previous;
          return {...previous, [directUser.userId]: revokedPreview(current)};
        });
      }
      if (currentGroupIdsRef.current.has(roomId)) {
        setGroupChats(previous => previous.map(group => String(group._id) === roomId && String(group.lastMessage?._id || '') === messageId
          ? {...group, lastMessage: revokedPreview(group.lastMessage)}
          : group));
      }
    };
    socket?.on('messageDeleted', messageDeletedHandler);

    const messageHiddenHandler = (payload: any) => {
      if (String(payload?.userId || '') === String(auth?.user?.username || '')) {
        noteSocketListMutation();
        void fetchData();
      }
    };
    socket?.on('messageHidden', messageHiddenHandler);

    // Thêm lắng nghe sự kiện nhóm mới được tạo
    const groupCreatedHandler = (data: any) => {
      console.log("=== Nhóm mới được tạo ===", JSON.stringify(data, null, 2));
      
      // Giả sử server emit với cấu trúc dựa trên schema Room
      const groupData = data.room || data.group || data;  // Server có thể gửi 'room' thay vì 'group'
      const participants = groupData.participants || data.participants || [];
      
      console.log("Group data:", groupData);
      console.log("Participants:", participants);
      console.log("Current user ID:", auth?.user?.id);
      console.log("Current user username:", auth?.user?.username);
      
      // Kiểm tra nếu user hiện tại là thành viên (dựa trên participants từ schema)
      const isMember = participants.includes(auth?.user?.id) || participants.includes(auth?.user?.username);
      
      if (isMember && groupData?._id && groupData.type === 'group') {
        noteSocketListMutation();
        currentGroupIdsRef.current.add(String(groupData._id));
        console.log("User là thành viên nhóm mới, thêm vào danh sách");
        
        // Thêm nhóm mới vào state mà không reload
        setGroupChats(prev => {
          const newGroup = {
            _id: groupData._id,
            name: groupData.name,
            participants: participants,
            groupImage: groupData.groupImage,
            createdBy: groupData.createdBy,
            type: 'group',
            lastMessage: groupData.lastMessage || null
          };
          
          // Tránh trùng lặp
          const exists = prev.some(g => g._id === newGroup._id);
          if (!exists) {
            console.log("Thêm nhóm mới:", newGroup.name);
            return [newGroup, ...prev];
          } else {
            console.log("Nhóm đã tồn tại, bỏ qua");
            return prev;
          }
        });
        
        // Tự động tham gia phòng chat của nhóm mới
        if (socket && groupData._id) {
          socket.emit("joinRoom", { roomId: groupData._id });
          console.log("Tự động tham gia nhóm mới:", groupData._id);
        }
        
        // Lấy số lượng tin nhắn chưa đọc
        if (socket && groupData._id) {
          getUnreadCount(groupData._id);
        }
        
        // Nếu cần lastMessage, gọi API
        if (!groupData.lastMessage) {
          getLastMessageOfRoom(groupData._id).then(lastMsg => {
            setGroupChats(prev => 
              prev.map(g => 
                g._id === groupData._id ? { ...g, lastMessage: lastMsg } : g
              )
            );
          }).catch(err => console.log("Lỗi lấy lastMessage:", err));
        }
      } else {
        console.log("User không phải thành viên hoặc không phải nhóm");
      }
    };
    onGroupCreated(socket, groupCreatedHandler);  // Thêm dòng này

    const membersUpdatedHandler = (data: any) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      noteSocketListMutation();
      setGroupChats(previous => previous.map(group => String(group._id) === roomId
        ? {...group, participants: data.participants || group.participants}
        : group));
    };
    const groupRemovedHandler = (data: any) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      noteSocketListMutation();
      currentGroupIdsRef.current.delete(roomId);
      setGroupChats(previous => previous.filter(group => String(group._id) !== roomId));
      setUnreadCount(roomId, 0);
    };
    const roomDeletedHandler = (payload: any) => {
      const roomId = String(typeof payload === 'string' ? payload : payload?.roomId || payload?._id || '');
      if (!roomId) return;
      noteSocketListMutation();

      currentGroupIdsRef.current.delete(roomId);
      const directUser = currentUsersRef.current.find(user => String(currentRoomIdsRef.current[user.userId] || '') === roomId);
      if (directUser) {
        delete currentRoomIdsRef.current[directUser.userId];
        setLastMessages(previous => {
          if (!(directUser.userId in previous)) return previous;
          const next = {...previous};
          delete next[directUser.userId];
          return next;
        });
      }
      setGroupChats(previous => previous.filter(group => String(group._id) !== roomId));
      setConversationUsers(previous => previous.filter(user => String(user.roomId || user._id) !== roomId));
      setRoomIds(previous => Object.fromEntries(Object.entries(previous).filter(([, id]) => String(id) !== roomId)));
      setUnreadCount(roomId, 0);
    };
    socket?.on('groupMembersUpdated', membersUpdatedHandler);
    socket?.on('groupRemoved', groupRemovedHandler);
    socket?.on('roomDeleted', roomDeletedHandler);
    const groupRenamedHandler = (data: any) => {
      const roomId = String(data?.roomId || '');
      if (!roomId || typeof data?.name !== 'string') return;
      noteSocketListMutation();
      setGroupChats(previous => previous.map(group => String(group._id) === roomId ? {...group, name: data.name} : group));
    };
    const preferenceChangedHandler = (data: any) => {
      const roomId = String(data?.roomId || '');
      if (!roomId) return;
      noteSocketListMutation();
      if (data.isMuted) mutedRoomIdsRef.current.add(roomId);
      else mutedRoomIdsRef.current.delete(roomId);
      muteExpiryRef.current[roomId] = data.mutedUntil || null;
      setGroupChats(previous => previous.map(group => String(group._id) === roomId ? {...group, isMuted: !!data.isMuted, mutedUntil: data.mutedUntil || null, isPinned: !!data.isPinned} : group));
      setConversationUsers(previous => previous.map(user => String(user.roomId || user._id) === roomId ? {...user, isMuted: !!data.isMuted, mutedUntil: data.mutedUntil || null, isPinned: !!data.isPinned} : user));
      if (typeof data.isHidden === 'boolean') {
        const nextHiddenIds = new Set(hiddenRoomIdsRef.current);
        if (data.isHidden) nextHiddenIds.add(roomId);
        else nextHiddenIds.delete(roomId);
        hiddenRoomIdsRef.current = nextHiddenIds;
        setHiddenRoomIds(Array.from(nextHiddenIds));
        if (data.isHidden) {
          setGroupChats(previous => previous.filter(group => String(group._id) !== roomId));
          setConversationUsers(previous => previous.filter(user => String(user.roomId || user._id) !== roomId));
          setRoomIds(previous => Object.fromEntries(Object.entries(previous).filter(([, id]) => String(id) !== roomId)));
          setLastMessages(previous => {
            const next = {...previous};
            Object.entries(currentRoomIdsRef.current).forEach(([userId, id]) => {
              if (String(id) === roomId) delete next[userId];
            });
            return next;
          });
        } else {
          void fetchDataRef.current?.();
        }
      }
    };
    socket?.on('groupRenamed', groupRenamedHandler);
    socket?.on('chatPreferenceChanged', preferenceChangedHandler);
    socket?.on('groupImageChanged', (data: any) => {
      const roomId = String(data?.roomId || '');
      if (roomId) {
        noteSocketListMutation();
        setGroupChats(previous => previous.map(group => String(group._id) === roomId ? {...group, groupImage: data.groupImage || null} : group));
      }
    });
  };

  // Pull-to-refresh cho FlatList
  const handleRefresh = () => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  };

    // Đăng ký nhận tin nhắn mới - chỉ setup một lần
  useEffect(() => {
    roomListLoadedRef.current = false;
    if (!auth?.user?.id) return;

    console.log("Setting up socket handlers for user:", auth.user.id);
    
    void fetchDataRef.current?.();
    
    return () => {
      console.log("Cleaning up ChatListScreen socket handlers...");
      if (detectNewUserTimeoutRef.current) {
        clearTimeout(detectNewUserTimeoutRef.current);
        detectNewUserTimeoutRef.current = null;
      }
      if (socket && socketReconnectHandlerRef.current) {
        socket.off('connect', socketReconnectHandlerRef.current);
        socketReconnectHandlerRef.current = null;
      }
      // Cleanup handlers khi component unmount
      cleanupAllSocketHandlers();
    };
  }, [auth?.user?.id]);

  // Refresh room previews after returning from a chat or reconnecting.
  useFocusEffect(
    React.useCallback(() => {
      console.log("Focus effect triggered - refreshing conversation data");
      if (!auth?.user?.id) return;
      
      const timer = setTimeout(() => {
        if (Date.now() - lastDataFetchAtRef.current > 3000) {
          void fetchDataRef.current?.();
        }
        // Reload unread counts nếu đã có data
        if (socket?.connected && (Object.keys(roomIds).length > 0 || groupChats.length > 0)) {
          console.log("Focus effect: reloading unread counts...");
          
          // Reload cho user rooms
          Object.values(roomIds).forEach(roomId => {
            if (socket && roomId) {
              getUnreadCount(roomId);
            }
          });
          
          // Reload cho groups
          groupChats.forEach(group => {
            if (socket && group._id) {
              getUnreadCount(group._id);
            }
          });
        }
      }, 100);
      
      return () => {
        clearTimeout(timer);
      };
    }, [roomIds, groupChats, auth?.user?.id])
  );

  // Render từng item nhân viên/group  
  const friends: User[] = users || [];
  const conversations: Array<User & {roomId: string; _id: string}> = conversationUsers || [];
  const groups: any[] = groupChats || [];

  // Sắp xếp friends theo thời gian tin nhắn mới nhất
  const sortedFriends = [...friends].sort((a, b) => {
    const timeA = lastMessages[a.userId]?.timestamp ? new Date(lastMessages[a.userId].timestamp).getTime() : 0;
    const timeB = lastMessages[b.userId]?.timestamp ? new Date(lastMessages[b.userId].timestamp).getTime() : 0;
    return timeB - timeA; // Sắp xếp giảm dần (mới nhất lên đầu)
  });

  // Sắp xếp groups theo thời gian tin nhắn mới nhất
  const sortedConversations = [...conversations].sort((a, b) => {
    const timeA = lastMessages[a.userId]?.timestamp ? new Date(lastMessages[a.userId].timestamp).getTime() : 0;
    const timeB = lastMessages[b.userId]?.timestamp ? new Date(lastMessages[b.userId].timestamp).getTime() : 0;
    return timeB - timeA;
  });

  const sortedGroups = [...groups].sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
    const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
    return timeB - timeA; // Sắp xếp giảm dần (mới nhất lên đầu)
  });

  // Lọc dữ liệu dựa trên tab
  const matchesSearch = (item: any) => {
    const query = searchValue.trim().toLocaleLowerCase();
    if (!query) return true;
    const latestMessage = (item.itemType === 'group' || item.type === 'group')
      ? item.lastMessage
      : lastMessages[item.userId];
    const searchable = [
      item.tenNhanVien,
      item.name,
      item.maNhanVien,
      item.userId,
      latestMessage?.content,
      latestMessage?.fileMeta?.fileName,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.includes(query);
  };

  const getFilteredData = () => {
    if (activeTab === 'employees') {
      // Chỉ hiển thị nhân viên đang online
      return sortedFriends.filter(friend => onlineUsers.has(friend.userId) && matchesSearch(friend));
    } else if (activeTab === 'groups') {
      return sortedGroups.filter(matchesSearch);
    } else {
      // 'all' - kết hợp tất cả và sắp xếp theo thời gian gần nhất
      const allItems = [
        ...sortedConversations.map(friend => ({ ...friend, itemType: 'employee' })),
        ...sortedGroups.map(group => ({ ...group, itemType: 'group' }))
      ];
      
      // Sắp xếp theo thời gian tin nhắn gần nhất
      return allItems.filter(item => matchesSearch(item) &&
        (activeTab !== 'unread' || (unreadCounts[String(item.roomId || item._id)] || 0) > 0) &&
        (activeTab !== 'priority' || Boolean(item.isPinned))).sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        let timeA = 0;
        let timeB = 0;
        
        if (a.itemType === 'employee') {
          timeA = lastMessages[a.userId]?.timestamp ? new Date(lastMessages[a.userId].timestamp).getTime() : 0;
        } else {
          timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
        }
        
        if (b.itemType === 'employee') {
          timeB = lastMessages[b.userId]?.timestamp ? new Date(lastMessages[b.userId].timestamp).getTime() : 0;
        } else {
          timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
        }
        
        return timeB - timeA; // Sắp xếp giảm dần (mới nhất lên đầu)
      });
    }
  };

  const data = getFilteredData();
  const activeContacts = sortedFriends.filter(friend => onlineUsers.has(friend.userId)).slice(0, 12);

  const ensureRoomJoined = async (roomId: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const activeSocket = socket;
      if (!activeSocket?.connected) return true;

      try {
        const joined = await joinChatRooms([roomId]);
        if (joined.includes(roomId)) return true;
      } catch (error) {
        console.warn('Room join acknowledgement failed:', error);
      }

      if (!socket?.connected) return true;
      if (socket !== activeSocket) continue;

      Alert.alert('Không mở được cuộc trò chuyện', 'Không thể tham gia phòng chat. Vui lòng thử lại.');
      return false;
    }

    if (!socket?.connected) return true;
    Alert.alert('Không mở được cuộc trò chuyện', 'Kết nối chat vừa thay đổi. Vui lòng mở lại cuộc trò chuyện.');
    return false;
  };

  const openContactConversation = async (contact: User) => {
    try {
      const roomId = roomIds[contact.userId] || (await LayTaoPhongChat(contact.userId)).data._id;
      if (!(await ensureRoomJoined(String(roomId)))) return;
      if (socket) {
        markMessageAsRead(undefined, roomId);
        resetUnreadCount(roomId);
      }
      navigation.navigate("ChatDetail", {
        chatId: roomId,
        chatName: contact.tenNhanVien || contact.userId,
        chatType: 'one-to-one',
      });
    } catch (error) {
      console.error('Could not open online contact chat:', error);
      Alert.alert('Không mở được cuộc trò chuyện', 'Vui lòng thử lại sau.');
    }
  };

  const openConversationOptions = (item: any) => {
    const roomId = String(item.roomId || item._id || '');
    if (!roomId) return;
    const apply = async (action: 'pin' | 'mute') => {
      try {
        const preference = action === 'pin' ? await setRoomPin(roomId, !item.isPinned) : await setRoomMute(roomId, !item.isMuted);
        setGroupChats(previous => previous.map(room => String(room._id) === roomId ? {...room, ...preference} : room));
        setConversationUsers(previous => previous.map(room => String(room.roomId) === roomId ? {...room, ...preference} : room));
        if (preference.isMuted) mutedRoomIdsRef.current.add(roomId); else mutedRoomIdsRef.current.delete(roomId);
        muteExpiryRef.current[roomId] = preference.mutedUntil;
      } catch (error: any) {
        Alert.alert('Không cập nhật được cuộc trò chuyện', error?.response?.data?.error || 'Vui lòng thử lại.');
      }
    };
    Alert.alert(item.name || item.tenNhanVien || 'Cuộc trò chuyện', 'Tùy chọn', [
      {text: item.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu', onPress: () => { void apply('pin'); }},
      {text: item.isMuted ? 'Bật thông báo' : 'Tắt thông báo', onPress: () => { void apply('mute'); }},
      {text: 'Hủy', style: 'cancel'},
    ]);
  };

  // Helper function để render avatar với online indicator
  const renderAvatar = (avatarUri: string | undefined, userId: string, isOnline: boolean = false, displayName?: string, compact = false) => {
    const imageUri = avatarUri
      ? /^(https?:|data:|file:|content:)/i.test(avatarUri)
        ? avatarUri
        : /^(\/)?uploads\//i.test(avatarUri)
          ? `${constants.API_URLS.LAY_ANH}${avatarUri.replace(/^\/+/, '').replace(/^uploads\//i, '')}`
          : `data:image/png;base64,${avatarUri}`
      : undefined;
    return (
      <View style={[styles.avatarBox, compact && styles.avatarCompact]}>
        {imageUri ? <Image source={{uri: imageUri}} style={styles.avatar} /> : <View style={[styles.avatar, {backgroundColor: avatarColorFor(userId), alignItems: 'center', justifyContent: 'center'}]}><Text style={{fontSize: 17, color: '#42627f', fontWeight: '700'}}>{initialsFor(displayName || userId)}</Text></View>}
        {isOnline && (
          <View style={styles.onlineIndicator}>
            <View style={styles.onlineDot} />
          </View>
        )}
      </View>
    );
  };

  const renderGroupAvatar = (group: any) => <View style={styles.avatarBox}>
    {group.groupImage ? <Image source={{uri: /^(https?:|data:|file:|content:)/i.test(group.groupImage) ? group.groupImage : `${constants.API_URLS.LAY_ANH}${String(group.groupImage).replace(/^\/+/, '').replace(/^uploads\//i, '')}`}} style={styles.avatar} />
      : <View style={[styles.avatar, {backgroundColor: avatarColorFor(group._id || group.name), alignItems: 'center', justifyContent: 'center'}]}><Text style={{fontSize: 17, color: '#42627f', fontWeight: '700'}}>{initialsFor(group.name)}</Text></View>}
  </View>;

  // Component tab
  const renderTabs = () => (
    <View style={styles.tabContainer}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'all' && styles.activeTab]}
        onPress={() => setActiveTab('all')}
      >
        <Text numberOfLines={1} style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>Tất cả</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'priority' && styles.activeTab]}
        onPress={() => setActiveTab('priority')}
      >
        <Icon name="thumb-tack" size={12} color={activeTab === 'priority' ? '#1877e8' : '#666'} style={{marginRight: 5}} />
        <Text numberOfLines={1} style={[styles.tabText, activeTab === 'priority' && styles.activeTabText]}>Ưu tiên</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'unread' && styles.activeTab]}
        onPress={() => setActiveTab('unread')}
      >
        <Text numberOfLines={1} style={[styles.tabText, activeTab === 'unread' && styles.activeTabText]}>Chưa đọc</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'employees' && styles.activeTab]}
        onPress={() => setActiveTab('employees')}
      >
        <Text style={[styles.tabText, activeTab === 'employees' && styles.activeTabText]}>Online</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'groups' && styles.activeTab]}
        onPress={() => setActiveTab('groups')}
      >
        <Text style={[styles.tabText, activeTab === 'groups' && styles.activeTabText]}>Nhóm</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <SearchHeader
        rightType="chat"
        searchValue={searchValue}
        setSearchValue={setSearchValue}
        onRightPress={(key) => {
          if (key === "qrcode") { setQrScannerVisible(true); }
          else if (key === "addFriend") {
            navigation.navigate("Directory", {openTab: "discover"});
          }
          else if (key === "createGroup") {
            navigation.navigate("TaoNhom");
          }
          else if (key === "hiddenChats") {
            navigation.navigate("HiddenChats");
          }
        }}
      />
      {renderTabs()} {/* Thêm tabs ở đây */}
      {!!loadError && (
        <TouchableOpacity accessibilityRole="button" onPress={handleRefresh} style={{paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff4e5'}}>
          <Text style={{color: '#8a4b08', textAlign: 'center'}}>{loadError}</Text>
        </TouchableOpacity>
      )}
      {activeTab === 'employees' && !!employeeLoadError && (
        <TouchableOpacity accessibilityRole="button" onPress={handleRefresh} style={{paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff4e5'}}>
          <Text style={{color: '#8a4b08', textAlign: 'center'}}>{employeeLoadError}</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={data}
        ListHeaderComponent={activeTab === 'all' && !searchValue.trim() ? (
          <View style={styles.activeNowSection}>
            <View style={styles.activeNowHeading}>
              <View style={styles.activeNowTitleWrap}>
                <View style={styles.activeNowPulse} />
                <Text style={styles.activeNowTitle}>Bạn bè đang hoạt động</Text>
                {activeContacts.length > 0 && <Text style={styles.activeNowCount}>{activeContacts.length}</Text>}
              </View>
              <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Directory')}>
                <Text style={styles.activeNowSeeAll}>Danh bạ</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeNowScroller}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tạo nhóm chat" style={styles.activeNowContact} onPress={() => navigation.navigate('TaoNhom')}>
                <View style={styles.createGroupQuick}>
                  <Icon name="users" size={22} color="#1877e8" />
                  <View style={styles.createGroupQuickPlus}><Icon name="plus" size={9} color="#fff" /></View>
                </View>
                <Text numberOfLines={1} style={styles.activeNowName}>Tạo nhóm</Text>
              </TouchableOpacity>
              {activeContacts.map(contact => (
                <TouchableOpacity
                  key={contact.userId}
                  accessibilityRole="button"
                  accessibilityLabel={`Mở trò chuyện với ${contact.tenNhanVien || contact.userId}, đang hoạt động`}
                  style={styles.activeNowContact}
                  onPress={() => { void openContactConversation(contact); }}
                >
                  {renderAvatar(contact.avatar, contact.userId, true, contact.tenNhanVien, true)}
                  <Text numberOfLines={1} style={styles.activeNowName}>{contact.tenNhanVien || contact.userId}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}
        keyExtractor={(item, idx) =>
          'id' in item ? String(item.id) : ('header' in item ? item.header : ('_id' in item ? item._id : idx.toString()))
        }
        renderItem={({ item }) => {
          // Xử lý cho tab 'all' - không có header
          if (item.itemType === 'employee') {
            // Render employee
            const roomId = item.roomId || roomIds[item.userId];
            const unreadCount = unreadCounts[roomId] || 0;
            const hasUnread = unreadCount > 0;
            
            return (
              <TouchableOpacity
                onLongPress={() => openConversationOptions(item)}
                style={[
                  hasUnread ? styles.itemUnread : styles.item,
                  hasUnread ? styles.itemUnreadShadow : null
                ]}
                onPress={async () => {
                  try {
                    const roomId = item.roomId || roomIds[item.userId] || (await LayTaoPhongChat(item.userId)).data._id;
                    if (!(await ensureRoomJoined(String(roomId)))) return;
                    
                    // Đánh dấu tất cả tin nhắn trong room đã đọc khi vào chat
                    if (socket) {
                      markMessageAsRead(undefined, roomId);
                      // Reset unread count về 0
                      resetUnreadCount(roomId);
                    }
                    
                    navigation.navigate("ChatDetail", {
                      chatId: roomId,
                      chatName: item.tenNhanVien,
                      chatType: 'one-to-one'
                    });
                  } catch (error) {
                    console.error("Tạo phòng chat thất bại:", error);
                  }
                }}
              >
                <View style={styles.rowCenter}>
                  {/* Avatar */}
                  {renderAvatar(item.avatar, item.userId, onlineUsers.has(item.userId), item.tenNhanVien)}
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowSpaceBetween}>
                      <View style={{flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 8}}>
                        {(item.isPinned || item.isMuted) && <View style={{flexDirection: 'row', marginRight: 6}}>{item.isPinned && <Icon name="thumb-tack" size={12} color="#8190a0" />}{item.isMuted && <Icon name="bell-slash" size={12} color="#8190a0" style={{marginLeft: 5}} />}</View>}
                        <Text numberOfLines={1} style={[hasUnread ? styles.nameUnread : styles.name, {flexShrink: 1}]}>{item.tenNhanVien}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {/* Thời gian gửi tin nhắn gần nhất */}
                        {lastMessages[item.userId]?.timestamp && (
                          <Text style={[
                            styles.lastMsgTime,
                            hasUnread && { color: "#1976D2", fontWeight: "600" }
                          ]}>
                            {formatConversationTime(lastMessages[item.userId].timestamp)}
                          </Text>
                        )}
                        {/* Badge số lượng tin nhắn chưa đọc */}
                        {unreadCount > 0 && (
                          <View style={styles.unreadBadge}>
                            <Text style={styles.unreadText}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {/* Hiển thị tin nhắn gần nhất */}
                    {lastMessages[item.userId] ? (
                      <Text style={hasUnread ? styles.lastMessageUnread : styles.lastMessage} numberOfLines={1}>
                        {formatLastMessagePreview(lastMessages[item.userId], auth?.user?.username)}
                      </Text>
                    ) : (
                      <Text style={hasUnread ? styles.lastMessageUnread : styles.lastMessage}>Không có tin nhắn</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          } else if (item.itemType === 'group') {
            // Render group
            return (
              <TouchableOpacity 
                onLongPress={() => openConversationOptions(item)}
                style={[
                  (unreadCounts[item._id] || 0) > 0 ? styles.itemUnread : styles.item,
                  (unreadCounts[item._id] || 0) > 0 ? styles.itemUnreadShadow : null
                ]} 
                onPress={async () => {
                  if (!(await ensureRoomJoined(String(item._id)))) return;
                  // Đánh dấu tất cả tin nhắn trong group đã đọc khi vào chat
                  if (socket) {
                    markMessageAsRead(undefined, item._id);
                    // Reset unread count về 0
                    resetUnreadCount(item._id);
                  }
                  
                  navigation.navigate('ChatDetail', { 
                    chatId: item._id, 
                    chatName: item.name, 
                    chatType: 'group' 
                  });
                }}
              >
                <View style={styles.rowCenter}>
                  {renderGroupAvatar(item)}
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowSpaceBetween}>
                      <View style={{flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 8}}>
                        {(item.isPinned || item.isMuted) && <View style={{flexDirection: 'row', marginRight: 6}}>{item.isPinned && <Icon name="thumb-tack" size={12} color="#8190a0" />}{item.isMuted && <Icon name="bell-slash" size={12} color="#8190a0" style={{marginLeft: 5}} />}</View>}
                        <Text numberOfLines={1} style={[(unreadCounts[item._id] || 0) > 0 ? styles.nameUnread : styles.name, {flexShrink: 1}]}>{item.name}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {/* Thời gian gửi tin nhắn gần nhất cho group */}
                        {item.lastMessage?.timestamp && (
                          <Text style={[
                            styles.lastMsgTime,
                            (unreadCounts[item._id] || 0) > 0 && { color: "#1976D2", fontWeight: "600" }
                          ]}>
                            {formatConversationTime(item.lastMessage.timestamp)}
                          </Text>
                        )}
                        {/* Badge số lượng tin nhắn chưa đọc cho group */}
                        {(unreadCounts[item._id] || 0) > 0 && (
                          <View style={styles.unreadBadge}>
                            <Text style={styles.unreadText}>
                              {(unreadCounts[item._id] || 0) > 99 ? '99+' : (unreadCounts[item._id] || 0)}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <Text 
                      style={(unreadCounts[item._id] || 0) > 0 ? styles.lastMessageUnread : styles.lastMessage} 
                      numberOfLines={1}
                    >
                      {formatLastMessagePreview(item.lastMessage, auth?.user?.username, true)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          } else {
            // Fallback cho các tab khác (employees, groups) - giữ nguyên logic cũ
            if ('header' in item) {
              return <Text style={styles.sectionHeader}>{item.header}</Text>;
            } else if (item.type === 'group') {
              // Render group (giữ nguyên logic)
              return (
                <TouchableOpacity 
                  onLongPress={() => openConversationOptions(item)}
                  style={[
                    (unreadCounts[item._id] || 0) > 0 ? styles.itemUnread : styles.item,
                    (unreadCounts[item._id] || 0) > 0 ? styles.itemUnreadShadow : null
                  ]} 
                onPress={async () => {
                  if (!(await ensureRoomJoined(String(item._id)))) return;
                    // Đánh dấu tất cả tin nhắn trong group đã đọc khi vào chat
                    if (socket) {
                      markMessageAsRead(undefined, item._id);
                      // Reset unread count về 0
                      resetUnreadCount(item._id);
                    }
                    
                    navigation.navigate('ChatDetail', { 
                      chatId: item._id, 
                      chatName: item.name, 
                      chatType: 'group' 
                    });
                  }}
                >
                  <View style={styles.rowCenter}>
                    {renderGroupAvatar(item)}
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowSpaceBetween}>
                        <Text style={(unreadCounts[item._id] || 0) > 0 ? styles.nameUnread : styles.name}>
                          {item.name}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {/* Badge số lượng tin nhắn chưa đọc cho group */}
                          {(unreadCounts[item._id] || 0) > 0 && (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadText}>
                                {(unreadCounts[item._id] || 0) > 99 ? '99+' : (unreadCounts[item._id] || 0)}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Text 
                        style={(unreadCounts[item._id] || 0) > 0 ? styles.lastMessageUnread : styles.lastMessage} 
                        numberOfLines={1}
                      >
                        {formatLastMessagePreview(item.lastMessage, auth?.user?.username, true)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            } else {
              // Render employee (giữ nguyên logic)
              const roomId = item.roomId || roomIds[item.userId];
              const unreadCount = unreadCounts[roomId] || 0;
              const hasUnread = unreadCount > 0;
              
              return (
                <TouchableOpacity
                  style={[
                    hasUnread ? styles.itemUnread : styles.item,
                    hasUnread ? styles.itemUnreadShadow : null
                  ]}
                  onPress={async () => {
                    try {
                      const roomId = item.roomId || roomIds[item.userId] || (await LayTaoPhongChat(item.userId)).data._id;
                    if (!(await ensureRoomJoined(String(roomId)))) return;
                      
                      // Đánh dấu tất cả tin nhắn trong room đã đọc khi vào chat
                      if (socket) {
                        markMessageAsRead(undefined, roomId);
                        // Reset unread count về 0
                        resetUnreadCount(roomId);
                      }
                      
                      navigation.navigate("ChatDetail", {
                        chatId: roomId,
                        chatName: item.tenNhanVien,
                        chatType: "one-to-one"
                      });
                    } catch (error) {
                      console.error("Tạo phòng chat thất bại:", error);
                    }
                  }}
                >
                  <View style={styles.rowCenter}>
                    {/* Avatar */}
                    {renderAvatar(item.avatar, item.userId, onlineUsers.has(item.userId), item.tenNhanVien)}
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowSpaceBetween}>
                        <Text style={hasUnread ? styles.nameUnread : styles.name}>
                          {item.tenNhanVien}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {/* Thời gian gửi tin nhắn gần nhất */}
                          {lastMessages[item.userId]?.timestamp && (
                            <Text style={[
                              styles.lastMsgTime,
                              hasUnread && { color: "#1976D2", fontWeight: "600" }
                            ]}>
                              {formatConversationTime(lastMessages[item.userId].timestamp)}
                            </Text>
                          )}
                          {/* Badge số lượng tin nhắn chưa đọc */}
                          {unreadCount > 0 && (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadText}>
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {/* Hiển thị tin nhắn gần nhất */}
                      {lastMessages[item.userId] ? (
                        <Text style={hasUnread ? styles.lastMessageUnread : styles.lastMessage} numberOfLines={1}>
                          {formatLastMessagePreview(lastMessages[item.userId], auth?.user?.username)}
                        </Text>
                      ) : (
                        <Text style={hasUnread ? styles.lastMessageUnread : styles.lastMessage}>Không có tin nhắn</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }
          }
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        alwaysBounceVertical={true}
        ListEmptyComponent={
          loadError
            ? <Text style={{textAlign: 'center', margin: 20, color: '#666'}}>Chưa thể tải dữ liệu.</Text>
            : activeTab === 'employees' 
            ? <Text style={{textAlign: 'center', margin: 20, color: '#666'}}>Không có nhân viên nào đang online</Text>
            : activeTab === 'priority'
            ? <Text style={{textAlign: 'center', margin: 20, color: '#666'}}>Chưa có hội thoại ưu tiên. Nhấn giữ cuộc trò chuyện để ghim.</Text>
            : <Text style={{textAlign: 'center', margin: 10}}>Không có dữ liệu</Text>
        }
      />
      <QrScannerModal visible={qrScannerVisible} onClose={() => setQrScannerVisible(false)} onScan={value => { void handleInviteScan(value); }} />
    </View>
  );
}


