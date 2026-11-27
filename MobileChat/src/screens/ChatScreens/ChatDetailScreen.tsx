import React, { useCallback, useLayoutEffect, useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, Modal, Image, Linking, PermissionsAndroid, Alert, ActivityIndicator, NativeModules, Share, Dimensions, AppState, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {errorCodes as documentPickerErrorCodes, isErrorWithCode as isDocumentPickerError, pick as pickDocument, types as documentTypes} from '@react-native-documents/picker';
import Icon from "react-native-vector-icons/FontAwesome";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import { sendMessage, retryQueuedMessage, onReceiveMessage, getFileType, uploadFile, uploadFiles, markMessageAsRead, onMarkAsReadSuccess, onMessageRead, offMarkAsReadEvents, offMessageRead, offReceiveMessage, socket } from "../../utils/socket";
import { useAuthStore } from "../../auth/store/login.store";
import { useUnreadStore } from "../../store/unreadStore";
import {TypingPresenceTimers} from '../../utils/typingPresence';
import { LayLichSuTinNhan, LayTatCaPhongChat, editChatMessage, deleteChatMessage, toggleChatMessageReaction, forwardChatMessage, updateLiveLocation, stopLiveLocation, getGroupPins, pinGroupMessage, unpinGroupMessage, getMessageContext, getGroupPoll, voteGroupPoll, addGroupPollOption, closeGroupPoll, getGroupMembers } from "../../services/ChatAPI/api";
import type {GroupMember, GroupPoll} from "../../services/ChatAPI/api";
import { styles } from './css/ChatDetailScreen.style';
import Video from 'react-native-video';
import Sound from 'react-native-sound';
import ImageViewing from 'react-native-image-viewing';
import MessageReadStatus from '../../components/MessageReadStatus';
import {loadRoomMessages, saveRoomMessages} from '../../services/ChatAPI/offlineCache';
import {getOutboxMessages, subscribeOutbox} from '../../services/ChatAPI/outbox';
import type {OutboxMessage} from '../../services/ChatAPI/outbox';
import {uploadInChunks} from '../../utils/uploadInChunks';
import {clearHiddenChatAccessToken, getHiddenChatAccessToken, setHiddenChatAccessToken} from '../../services/hiddenChatAccess';
import {API_ORIGIN} from '../../contents/Api_URL';
import {cacheMessageMedia, hasUncachedMedia, type MediaMessage} from '../../services/ChatAPI/localMedia';

const resolveApiAssetUrl = (value?: string | null) => {
  if (!value) return '';
  if (/^(https?:|file:|content:|data:)/i.test(value)) return value;
  return `${API_ORIGIN}/${value.replace(/^\/+/, '')}`;
};

const MAX_MEDIA_WIDTH = 320;
const MAX_MEDIA_HEIGHT = 320;
const PHOTO_GRID_WIDTH = Math.min(252, Math.max(180, Dimensions.get('window').width * 0.72));
const QUICK_EMOJI = ['😀', '😄', '🥰', '😍', '😂', '🤣', '😊', '😉', '😘', '😎', '🤔', '😮', '😢', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '👋', '❤️', '💙', '🎉', '🔥', '✅', '💯', '🌹', '☀️', '🎂', '☕', '🍀'];
const STICKER_PACK = [
  {id: 'hello', label: 'Xin chào', emoji: '👋'},
  {id: 'love', label: 'Yêu thương', emoji: '🥰'},
  {id: 'laugh', label: 'Cười vui', emoji: '😂'},
  {id: 'thanks', label: 'Cảm ơn', emoji: '🙏'},
  {id: 'yes', label: 'Đồng ý', emoji: '👍'},
  {id: 'celebrate', label: 'Ăn mừng', emoji: '🎉'},
  {id: 'wow', label: 'Ngạc nhiên', emoji: '🤩'},
  {id: 'sad', label: 'Buồn', emoji: '🥺'},
  {id: 'cool', label: 'Ngầu', emoji: '😎'},
  {id: 'fire', label: 'Tuyệt vời', emoji: '🔥'},
  {id: 'hug', label: 'Ôm nào', emoji: '🫂'},
  {id: 'goodnight', label: 'Ngủ ngon', emoji: '🌙'},
];
const GIF_PACK = [
  {id: 'wave', label: 'Vẫy tay chào', source: require('../../assets/gifs/wave.gif')},
  {id: 'heart', label: 'Gửi yêu thương', source: require('../../assets/gifs/heart.gif')},
  {id: 'celebrate', label: 'Ăn mừng', source: require('../../assets/gifs/celebrate.gif')},
];

function LinkedMessageText({content, style, mentions = []}: {content: string; style: any; mentions?: string[]}) {
  const mentionedUsers = new Set(mentions);
  const parts = content.split(/(https?:\/\/[^\s<>]+|@[A-Za-z0-9_.-]+)/gi);
  return <Text style={style}>{parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      const match = part.match(/^(.*?)([.,!?;:)]*)$/);
      const url = match?.[1] || part;
      return <Text key={index} style={{textDecorationLine: 'underline'}} onPress={() => { void Linking.openURL(url).catch(() => Alert.alert('Không mở được liên kết', 'Vui lòng thử lại.')); }}>{url}{match?.[2] || ''}</Text>;
    }
    if (part.startsWith('@') && mentionedUsers.has(part.slice(1))) return <Text key={index} style={{color: '#087bfa', fontWeight: '700'}}>{part}</Text>;
    return part;
  })}</Text>;
}
function firstHttpUrl(content: string) {
  const candidate = content.match(/https?:\/\/[^\s<>]+/i)?.[0];
  return candidate?.replace(/[.,!?;:)\]]+$/, '') || null;
}

function safeLinkCardDetails(url: string) {
  const match = url.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
  if (!match) return null;
  const authority = (match[1].split('@').pop() || '').toLowerCase();
  const hostname = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.split(':')[0];
  if (!hostname || /[\s<>]/.test(hostname)) return null;
  return {hostname, path: match[2] || '/'};
}

function RichLinkPreviewCard({url}: {url: string}) {
  const details = safeLinkCardDetails(url);
  if (!details) return null;
  return <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel={`Mở liên kết ${details.hostname}`}
    onPress={() => { void Linking.openURL(url).catch(() => Alert.alert('Không mở được liên kết', 'Vui lòng thử lại.')); }}
    style={styles.richLinkCard}
  >
    <View style={styles.richLinkHeader}>
      <Icon name="link" size={15} color="#2179ee" />
      <Text numberOfLines={1} style={styles.richLinkHost}>{details.hostname}</Text>
    </View>
    <Text numberOfLines={1} style={styles.richLinkPath}>{details.path}</Text>
    <View style={styles.richLinkAction}>
      <Text style={styles.richLinkActionText}>Mở liên kết</Text>
      <Icon name="external-link" size={12} color="#2179ee" />
    </View>
  </TouchableOpacity>;
}

function mergeMessages(existing: any[], incoming: any[]) {
  const withIds = new Map<string, any>();
  const withoutIds: any[] = [];
  [...existing, ...incoming].forEach(item => {
    if (item?._id) withIds.set(String(item._id), item);
    else withoutIds.push(item);
  });
  return [...withIds.values(), ...withoutIds].sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? left.timestamp ?? 0).getTime() || 0;
    const rightTime = new Date(right.createdAt ?? right.timestamp ?? 0).getTime() || 0;
    return leftTime - rightTime || String(left._id ?? '').localeCompare(String(right._id ?? ''));
  });
}

function getMediaStyle(width: number, height: number) {
  if (width > MAX_MEDIA_WIDTH || height > MAX_MEDIA_HEIGHT) {
    const ratio = Math.min(MAX_MEDIA_WIDTH / width, MAX_MEDIA_HEIGHT / height);
    return {
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    };
  }
  return { width, height };
}

function formatAudioTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function callStatusLabel(status?: string, content?: string) {
  if (status === 'no_answer' || status === 'missed') return 'Cuộc gọi nhỡ';
  if (status === 'declined') return 'Cuộc gọi bị từ chối';
  if (status === 'busy') return 'Người nhận đang bận';
  if (status === 'pending') return 'Đang gọi';
  if (status === 'answered') return 'Đã kết nối';
  if (String(content || '').toLocaleLowerCase().includes('không có phản hồi')) return 'Cuộc gọi nhỡ';
  if (String(content || '').toLocaleLowerCase().includes('từ chối')) return 'Cuộc gọi bị từ chối';
  return 'Cuộc gọi đã kết thúc';
}

function groupPinPreview(message: any) {
  if (message?.deletedAt) return 'Tin nhắn đã được thu hồi';
  if (message?.type === 'image') {
    const count = Array.isArray(message.fileMeta?.images) ? message.fileMeta.images.length : 0;
    return count > 1 ? `Ảnh (${count})` : 'Ảnh';
  }
  if (message?.type === 'video') return 'Video';
  if (message?.type === 'audio') return 'Tin nhắn thoại';
  if (message?.type === 'file') return message.fileMeta?.fileName || 'Tệp đính kèm';
  if (message?.type === 'location') return message.location?.isLive ? 'Vị trí trực tiếp' : 'Vị trí';
  if (message?.type === 'gif') return 'GIF';
  if (message?.type === 'sticker') return `Sticker ${message.content || ''}`.trim();
  return message?.content || 'Tin nhắn';
}

function getAudioWaveform(seed: string) {
  return Array.from({length: 30}, (_, index) => {
    const value = seed.charCodeAt(index % Math.max(seed.length, 1)) || index * 7;
    return 5 + ((value * (index + 3) + index * 11) % 18);
  });
}

type RecordedVoiceClip = {
  uri: string;
  fileName: string;
  type: string;
  duration: number;
};

type VoiceRecorderBridge = {
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<RecordedVoiceClip>;
  cancelRecording: () => Promise<boolean>;
};

type LocationBridge = {
  getCurrentLocation: () => Promise<{latitude: number; longitude: number; accuracy?: number; timestamp?: number}>;
  getFreshLocation: () => Promise<{latitude: number; longitude: number; accuracy?: number; timestamp?: number}>;
  startLiveLocationService: (roomId: string, sessionId: string, expiresAt: number, accessToken: string) => Promise<boolean>;
  stopLiveLocationService: (sessionId: string, notifyServer: boolean) => Promise<boolean>;
};

const voiceRecorder = NativeModules.MobileChatVoiceRecorder as VoiceRecorderBridge | undefined;
const locationBridge = NativeModules.MobileChatLocation as LocationBridge | undefined;

export default function ChatDetailScreen({ route, navigation }: { route: any, navigation: any }) {
  // UI state
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageUrls, setImageUrls] = useState<Array<{ uri: string }>>([]);
  const scrollRef = useRef<ScrollView>(null);
  const messageLayoutsRef = useRef<Record<string, number>>({});
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { chatId } = route.params;
  const hiddenChatAccessToken = route.params?.hiddenChatAccessToken;
  useEffect(() => {
    if (hiddenChatAccessToken) setHiddenChatAccessToken(hiddenChatAccessToken);
  }, [hiddenChatAccessToken]);
  const isGroupChat = route.params?.chatType === 'group';
  const [message, setMessage] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingPresenceTimersRef = useRef<TypingPresenceTimers | null>(null);
  if (!typingPresenceTimersRef.current) {
    typingPresenceTimersRef.current = new TypingPresenceTimers(userId => {
      setTypingUsers(previous => previous.filter(item => item !== userId));
    });
  }
  const [replyTarget, setReplyTarget] = useState<any | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [actionMessage, setActionMessage] = useState<any | null>(null);
  const [groupPins, setGroupPins] = useState<any[]>([]);
  const [groupBoardVisible, setGroupBoardVisible] = useState(false);
  const [groupPinsLoading, setGroupPinsLoading] = useState(false);
  const [groupPinBusyId, setGroupPinBusyId] = useState<string | null>(null);
  const [groupPinsError, setGroupPinsError] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<any | null>(null);
  const [forwardRooms, setForwardRooms] = useState<any[]>([]);
  const [forwardModalVisible, setForwardModalVisible] = useState(false);
  const [loadingForwardRooms, setLoadingForwardRooms] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{start: number; query: string} | null>(null);
  const composerInputRef = useRef<TextInput | null>(null);
  const [liveShareSession, setLiveShareSession] = useState<{sessionId: string; expiresAt: string} | null>(null);
  const [outboxMessages, setOutboxMessages] = useState<OutboxMessage[]>([]);
  const [outboxClock, setOutboxClock] = useState(Date.now());
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [olderHistoryError, setOlderHistoryError] = useState(false);
  const messageEpochRef = useRef(0);
  const localTypingActiveRef = useRef(false);
  const localTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingLatestEpochRef = useRef<number | null>(null);
  const syncingMessagesRef = useRef<number | null>(null);
  const messagesLoadedRef = useRef(false);
  const serverHistoryLoadedRef = useRef(false);
  const latestMessageRef = useRef<{ id: string; time: number } | null>(null);
  const shouldScrollToEndRef = useRef(false);
  const nearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const auth = useAuthStore(state => state.auth);
  const { resetUnreadCount } = useUnreadStore();
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [stickerTrayVisible, setStickerTrayVisible] = useState(false);
  const [gifTrayVisible, setGifTrayVisible] = useState(false);
  const [quickActionsVisible, setQuickActionsVisible] = useState(false);
  const [pollComposerVisible, setPollComposerVisible] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollAllowAddOptions, setPollAllowAddOptions] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pollHideResults, setPollHideResults] = useState(false);
  const [pollExpiryHours, setPollExpiryHours] = useState(0);
  const [pollBusyId, setPollBusyId] = useState<string | null>(null);
  const [pollSelections, setPollSelections] = useState<Record<string, string[]>>({});
  const [pollDetailMessageId, setPollDetailMessageId] = useState<string | null>(null);
  const [pollDetailData, setPollDetailData] = useState<GroupPoll | null>(null);
  const [pollDetailsLoading, setPollDetailsLoading] = useState(false);
  const [addPollOptionMessageId, setAddPollOptionMessageId] = useState<string | null>(null);
  const [newPollOption, setNewPollOption] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Array<{ uri: string, name: string, type: string }>>([]);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const voiceRecordingRef = useRef(false);
  const voiceStartedAtRef = useRef(0);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mediaSizes, setMediaSizes] = useState<{ [url: string]: { width: number, height: number } }>({});
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, {currentTime: number; duration: number}>>({});
  const audioPlayerRef = useRef<Sound | null>(null);
  const audioProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isGroupChat) {
      setGroupMembers([]);
      return;
    }
    let active = true;
    void getGroupMembers(String(chatId)).then(result => {
      if (active) setGroupMembers(result.members || []);
    }).catch(() => {
      if (active) setGroupMembers([]);
    });
    return () => { active = false; };
  }, [chatId, isGroupChat]);

  useEffect(() => {
    messageLayoutsRef.current = {};
    pendingJumpMessageIdRef.current = null;
    setHighlightedMessageId(null);
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [chatId]);

  const loadGroupPins = useCallback(async (showError = false) => {
    if (!isGroupChat || !chatId) {
      setGroupPins([]);
      setGroupPinsError(null);
      return;
    }
    setGroupPinsLoading(true);
    setGroupPinsError(null);
    try {
      const result = await getGroupPins(String(chatId));
      setGroupPins(Array.isArray(result.messages) ? result.messages : []);
    } catch (error: any) {
      const detail = error?.response?.data?.error || 'Vui lòng kiểm tra kết nối rồi thử lại.';
      setGroupPinsError(detail);
      if (showError) Alert.alert('Không tải được bảng tin nhóm', detail);
    } finally {
      setGroupPinsLoading(false);
    }
  }, [chatId, isGroupChat]);

  const stopLocalTyping = useCallback(() => {
    if (localTypingTimerRef.current) clearTimeout(localTypingTimerRef.current);
    localTypingTimerRef.current = null;
    if (localTypingActiveRef.current) socket?.emit('stopTyping', {roomId: chatId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
    localTypingActiveRef.current = false;
  }, [chatId]);

  const handleComposerChange = useCallback((text: string) => {
    setMessage(text);
    const match = text.match(/(?:^|\s)@([^\s@]*)$/);
    if (isGroupChat && !editTarget && match) {
      setMentionQuery({start: text.length - match[1].length - 1, query: match[1]});
    } else {
      setMentionQuery(null);
    }
    if (!text.trim() || !socket?.connected) {
      stopLocalTyping();
      return;
    }
    if (!localTypingActiveRef.current) {
      socket.emit('typing', {roomId: chatId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
      localTypingActiveRef.current = true;
    }
    if (localTypingTimerRef.current) clearTimeout(localTypingTimerRef.current);
    localTypingTimerRef.current = setTimeout(stopLocalTyping, 1400);
  }, [chatId, editTarget, isGroupChat, stopLocalTyping]);

  const insertMention = (username: string) => {
    if (!mentionQuery) return;
    const next = `${message.slice(0, mentionQuery.start)}@${username} `;
    setMessage(next);
    setMentionQuery(null);
    composerInputRef.current?.focus();
  };

  useEffect(() => {
    const accountId = String(auth?.user?.username || '');
    if (!accountId) {
      setOutboxMessages([]);
      return;
    }
    const refresh = (changedAccountId?: string) => {
      if (!changedAccountId || changedAccountId === accountId) setOutboxMessages(getOutboxMessages(accountId, chatId));
    };
    refresh();
    return subscribeOutbox(refresh);
  }, [auth?.user?.username, chatId]);

  useEffect(() => {
    if (!liveShareSession || !locationBridge) return;
    let mounted = true;
    let inFlight = false;
    let warned = false;
    let serviceActive = false;
    const updateOnce = async () => {
      if (AppState.currentState !== 'active') return;
      if (!mounted || inFlight) return;
      if (Date.now() >= new Date(liveShareSession.expiresAt).getTime()) {
        try { await stopLiveLocation(chatId, liveShareSession.sessionId); } catch { /* The server also expires sessions by timestamp. */ }
        try { await locationBridge.stopLiveLocationService(liveShareSession.sessionId, false); } catch { /* The service may already have stopped itself. */ }
        setLiveShareSession(current => current?.sessionId === liveShareSession.sessionId ? null : current);
        return;
      }
      inFlight = true;
      try {
        const location = await locationBridge.getFreshLocation();
        if (!mounted) return;
        await updateLiveLocation(chatId, liveShareSession.sessionId, location);
        warned = false;
      } catch (error: any) {
        if ([404, 409, 410].includes(error?.response?.status)) {
          const status = error?.response?.status === 410 ? 'expired' : 'stopped';
          try { await locationBridge.stopLiveLocationService(liveShareSession.sessionId, false); } catch { /* The service may already have stopped itself. */ }
          setMessages(previous => previous.map(item => String(item.location?.liveSessionId || '') === liveShareSession.sessionId
            ? {...item, location: {...item.location, isLive: false, status, stoppedAt: new Date().toISOString()}}
            : item));
          setLiveShareSession(current => current?.sessionId === liveShareSession.sessionId ? null : current);
        } else if (!warned) {
          warned = true;
          console.warn('Không cập nhật được vị trí trực tiếp:', error?.message || error);
        }
      } finally {
        inFlight = false;
      }
    };
    const startService = async () => {
      try {
        await locationBridge.startLiveLocationService(chatId, liveShareSession.sessionId, new Date(liveShareSession.expiresAt).getTime(), auth?.token || '');
        if (mounted) serviceActive = true;
      } catch (error: any) {
        if (!mounted) return;
        console.warn('Không khởi chạy được dịch vụ vị trí nền:', error?.message || error);
        Alert.alert('Chia sẻ vị trí nền không khả dụng', 'MobileChat sẽ cập nhật khi đang mở. Hãy kiểm tra quyền vị trí rồi thử lại.');
      }
    };
    void startService();
    const timer = setInterval(() => { if (!serviceActive) void updateOnce(); }, 10000);
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !serviceActive) void updateOnce();
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [liveShareSession, chatId, auth?.token]);

  useEffect(() => {
    if (!messagesLoadedRef.current) return;
    const activeMessage = [...messages].reverse().find(item => item.isMine
      && item.type === 'location'
      && item.location?.isLive
      && item.location?.status === 'active'
      && new Date(item.location?.expiresAt || 0).getTime() > Date.now());
    if (!activeMessage?.location?.liveSessionId) {
      setLiveShareSession(null);
      return;
    }
    const next = {sessionId: String(activeMessage.location.liveSessionId), expiresAt: new Date(activeMessage.location.expiresAt).toISOString()};
    setLiveShareSession(current => current?.sessionId === next.sessionId ? current : next);
  }, [messages, auth?.user?.username]);

  useEffect(() => {
    if (!outboxMessages.some(item => item.lastAttemptAt)) return;
    const timer = setInterval(() => setOutboxClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [outboxMessages]);

  useEffect(() => {
    if (!isVoiceRecording) {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
      return;
    }

    voiceTimerRef.current = setInterval(() => {
      setVoiceRecordingSeconds(Math.floor((Date.now() - voiceStartedAtRef.current) / 1000));
    }, 250);
    return () => {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    };
  }, [isVoiceRecording]);

  useEffect(() => () => {
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    if (voiceRecordingRef.current) {
      voiceRecordingRef.current = false;
      void voiceRecorder?.cancelRecording().catch(() => {});
    }
  }, []);

  const clearAudioProgressTimer = () => {
    if (audioProgressTimerRef.current) clearInterval(audioProgressTimerRef.current);
    audioProgressTimerRef.current = null;
  };

  const toggleAudioPlayback = (audioId: string, url: string) => {
    const currentPlayer = audioPlayerRef.current;
    if (currentPlayer && playingAudioId === audioId) {
      clearAudioProgressTimer();
      audioPlayerRef.current = null;
      setPlayingAudioId(null);
      setAudioProgress(previous => ({...previous, [audioId]: {...previous[audioId], currentTime: 0}}));
      currentPlayer.stop(() => currentPlayer.release());
      return;
    }

    if (currentPlayer) {
      clearAudioProgressTimer();
      audioPlayerRef.current = null;
      currentPlayer.stop(() => currentPlayer.release());
    }
    Sound.setCategory('Playback');
    setPlayingAudioId(audioId);
    const player = new Sound(url, '', error => {
      if (audioPlayerRef.current !== player) {
        player.release();
        return;
      }
      if (error) {
        clearAudioProgressTimer();
        audioPlayerRef.current = null;
        setPlayingAudioId(null);
        player.release();
        Alert.alert('Không phát được âm thanh', 'Hãy kiểm tra kết nối rồi thử lại.');
        return;
      }
      const duration = player.getDuration();
      setAudioProgress(previous => ({...previous, [audioId]: {currentTime: 0, duration}}));
      clearAudioProgressTimer();
      audioProgressTimerRef.current = setInterval(() => {
        if (audioPlayerRef.current !== player) return;
        player.getCurrentTime(currentTime => {
          if (audioPlayerRef.current === player) {
            setAudioProgress(previous => ({...previous, [audioId]: {currentTime, duration}}));
          }
        });
      }, 250);
      player.play(() => {
        if (audioPlayerRef.current === player) {
          clearAudioProgressTimer();
          audioPlayerRef.current = null;
          setPlayingAudioId(null);
          setAudioProgress(previous => ({...previous, [audioId]: {currentTime: duration, duration}}));
        }
        player.release();
      });
    });
    audioPlayerRef.current = player;
  };

  useEffect(() => () => {
    clearAudioProgressTimer();
    const player = audioPlayerRef.current;
    audioPlayerRef.current = null;
    if (player) player.stop(() => player.release());
  }, []);

  const openImageViewer = (clickedUrl: string) => {
    const allImageUrls = messages
      .filter(msg => msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'image')
      .flatMap(msg => Array.isArray(msg.fileMeta.images) && msg.fileMeta.images.length ? msg.fileMeta.images : [msg.fileMeta])
      .filter((item: any) => item?.fileUrl)
      .map((item: any) => ({uri: resolveApiAssetUrl(item.localUri || item.fileUrl)}));
    const index = allImageUrls.findIndex(img => img.uri === clickedUrl);
    setImageUrls(allImageUrls);
    setCurrentImageIndex(index >= 0 ? index : 0);
    setImageViewerVisible(true);
  };

  const openMapLocation = (latitude: number, longitude: number) => {
    const geoUrl = `geo:${latitude},${longitude}?q=${latitude},${longitude}`;
    void Linking.openURL(geoUrl).catch(() => {
      void Linking.openURL(`https://maps.google.com/?q=${latitude},${longitude}`).catch(() =>
        Alert.alert('Không mở được bản đồ', 'Hãy thử mở ứng dụng bản đồ trên thiết bị.'));
    });
  };

  const pickImages = () => {
    launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 20,
    }, (response) => {
      if (!response.didCancel && !response.errorCode && Array.isArray(response.assets)) {
        const files = response.assets
          .filter(a => a && a.uri)
          .map((a: Asset) => ({
            uri: a.uri ?? '',
            name: a.fileName != null ? String(a.fileName) : 'image.jpg',
            type: a.type ?? 'image/jpeg',
          }));
        setSelectedFiles(prev => [...prev, ...files]);
      }
      setImageModalVisible(false);
    });
  };

  const takePhoto = async () => {
    const { PermissionsAndroid, Platform } = require('react-native');
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Quyền truy cập Camera',
          message: 'Ứng dụng cần quyền truy cập camera để chụp ảnh/quay video.',
          buttonNeutral: 'Hỏi lại sau',
          buttonNegative: 'Hủy',
          buttonPositive: 'Đồng ý',
        },
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return;
      }
    }
    launchCamera({
      mediaType: 'mixed',
      videoQuality: 'high',
    }, (response) => {
      if (!response.didCancel && !response.errorCode && Array.isArray(response.assets)) {
        const files = response.assets
          .filter(a => a && a.uri)
          .map((a: Asset) => ({
            uri: a.uri ?? '',
            name: a.fileName != null
              ? String(a.fileName)
              : (a.type?.startsWith('video/') ? 'video.mp4' : 'image.jpg'),
            type: typeof a.type === 'string'
              ? a.type
              : (a.fileName && a.fileName.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'),
          }));
        setSelectedFiles(prev => [...prev, ...files]);
      }
      setImageModalVisible(false);
    });
  };

  const pickFile = async () => {
    try {
      const res = await pickDocument({
        type: [documentTypes.allFiles],
        allowMultiSelection: true,
      });
      const files = res.map((f: any) => ({
        uri: f.uri,
        name: f.name ?? 'file',
        type: f.type ?? 'application/octet-stream'
      }));
      setSelectedFiles(prev => [...prev, ...files]);
    } catch (err: any) {
      if (!(isDocumentPickerError(err) && err.code === documentPickerErrorCodes.OPERATION_CANCELED)) {
        console.warn('Lỗi chọn file:', err);
      }
    }
  };

  const mapHistoryMessages = useCallback((items: any[]) => items.map(msg => ({
    _id: msg._id,
    from: msg.userId ?? msg.from,
    to: chatId,
    content: msg.content,
    type: msg.type,
    poll: msg.poll,
    fileMeta: msg.fileMeta,
    location: msg.location,
    call: msg.call,
    replyTo: msg.replyTo,
    forwardedFrom: msg.forwardedFrom,
    reactions: msg.reactions ?? [],
    clientMessageId: msg.clientMessageId,
    editedAt: msg.editedAt ?? null,
    deletedAt: msg.deletedAt ?? null,
    deletedBy: msg.deletedBy ?? null,
    mentions: Array.isArray(msg.mentions) ? msg.mentions : [],
    createdAt: msg.createdAt ?? msg.timestamp ?? new Date().toISOString(),
    isMine: Boolean(auth?.user?.username && (msg.userId ?? msg.from) === auth.user.username),
  })), [auth, chatId]);

  const rememberLatestMessage = useCallback((items: any[]) => {
    items.forEach(item => {
      if (!item?._id) return;
      const time = new Date(item.createdAt ?? item.timestamp ?? 0).getTime() || 0;
      const id = String(item._id);
      const current = latestMessageRef.current;
      if (!current || time > current.time || (time === current.time && id.localeCompare(current.id) > 0)) {
        latestMessageRef.current = { id, time };
      }
    });
  }, []);

  // A fresh server page is authoritative. Local cache can outlive a recalled or
  // otherwise removed server message, so never let a cached ID remain the
  // incremental-sync cursor after a successful history request.
  const replaceLatestMessageCursor = useCallback((items: any[]) => {
    let latest: {id: string; time: number} | null = null;
    items.forEach(item => {
      if (!item?._id) return;
      const time = new Date(item.createdAt ?? item.timestamp ?? 0).getTime() || 0;
      const id = String(item._id);
      if (!latest || time > latest.time || (time === latest.time && id.localeCompare(latest.id) > 0)) {
        latest = {id, time};
      }
    });
    latestMessageRef.current = latest;
  }, []);

  const syncMissedMessages = useCallback(async () => {
    const epoch = messageEpochRef.current;
    if (syncingMessagesRef.current === epoch || !serverHistoryLoadedRef.current || !latestMessageRef.current) return;
    syncingMessagesRef.current = epoch;
    let cursor = latestMessageRef.current.id;
    try {
      for (let batch = 0; batch < 100; batch += 1) {
        const data = await LayLichSuTinNhan(chatId, 100, 1, { after: cursor });
        if (epoch !== messageEpochRef.current || !Array.isArray(data?.messages)) return;
        const incoming = mapHistoryMessages(data.messages);
        if (data.cursorReset) {
          replaceLatestMessageCursor(incoming);
          setHasMoreHistory(Boolean(data.hasMore));
          if (nearBottomRef.current) shouldScrollToEndRef.current = true;
          setMessages(incoming);
          break;
        }
        if (incoming.length) {
          rememberLatestMessage(incoming);
          if (nearBottomRef.current) shouldScrollToEndRef.current = true;
          setMessages(previous => mergeMessages(previous, incoming));
        }
        const nextCursor = data.nextCursor || incoming.at(-1)?._id;
        if (!data.hasMore || !nextCursor || String(nextCursor) === cursor) break;
        cursor = String(nextCursor);
      }
    } catch (err) {
      if ((err as any)?.response?.status === 404) {
        try {
          // A recalled/deleted marker can still be present in the local cache.
          // Rebase from the latest server page rather than retrying that stale ID.
          const latestData = await LayLichSuTinNhan(chatId, 100, 1);
          if (epoch !== messageEpochRef.current || !Array.isArray(latestData?.messages)) return;
          const latest = mapHistoryMessages(latestData.messages);
          replaceLatestMessageCursor(latest);
          setHasMoreHistory(Boolean(latestData.hasMore));
          if (nearBottomRef.current) shouldScrollToEndRef.current = true;
          setMessages(latest);
        } catch (recoveryError) {
          console.warn('Không thể khôi phục đồng bộ hội thoại sau cursor 404', recoveryError);
        }
      } else {
        console.warn('Không đồng bộ được tin nhắn mới', err);
      }
    } finally {
      if (syncingMessagesRef.current === epoch) syncingMessagesRef.current = null;
    }
  }, [chatId, mapHistoryMessages, rememberLatestMessage, replaceLatestMessageCursor]);

  const loadOlderMessages = async () => {
    const epoch = messageEpochRef.current;
    const before = messages.find(item => item?._id)?._id;
    if (!before || loadingOlderRef.current || !hasMoreHistory) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderHistoryError(false);
    try {
      const data = await LayLichSuTinNhan(chatId, 25, 1, { before: String(before) });
      if (epoch !== messageEpochRef.current || !Array.isArray(data?.messages)) return;
      const older = mapHistoryMessages(data.messages);
      rememberLatestMessage(older);
      shouldScrollToEndRef.current = false;
      setMessages(previous => mergeMessages(previous, older));
      setHasMoreHistory(Boolean(data.hasMore));
    } catch (err) {
      if (epoch === messageEpochRef.current) setOlderHistoryError(true);
      console.warn('Không lấy được tin nhắn cũ hơn', err);
    } finally {
      loadingOlderRef.current = false;
      if (epoch === messageEpochRef.current) setLoadingOlder(false);
    }
  };

  const loadLatestMessages = useCallback(async (epoch = messageEpochRef.current) => {
    if (loadingLatestEpochRef.current === epoch) return;
    loadingLatestEpochRef.current = epoch;
    setHistoryError(false);
    setLoadingHistory(true);
    try {
      // The offline message cache is capped at 100, so reload the full cached
      // window and replace it with server history. Merging here would preserve
      // messages removed from the server in a stale local cache.
      const data = await LayLichSuTinNhan(chatId, 100, 1);
      if (epoch !== messageEpochRef.current || !Array.isArray(data?.messages)) return;
      const history = mapHistoryMessages(data.messages);
      replaceLatestMessageCursor(history);
      messagesLoadedRef.current = true;
      serverHistoryLoadedRef.current = true;
      shouldScrollToEndRef.current = true;
      setMessages(history);
      setHasMoreHistory(Boolean(data.hasMore));
      setHistoryError(false);
      setOlderHistoryError(false);
      if (socket?.connected) void syncMissedMessages();
    } catch (err) {
      if (epoch === messageEpochRef.current) setHistoryError(true);
      console.warn('Không lấy được lịch sử tin nhắn', err);
    } finally {
      if (loadingLatestEpochRef.current === epoch) loadingLatestEpochRef.current = null;
      if (epoch === messageEpochRef.current) setLoadingHistory(false);
    }
  }, [chatId, mapHistoryMessages, replaceLatestMessageCursor, syncMissedMessages]);

  useEffect(() => {
    const epoch = ++messageEpochRef.current;
    setMessages([]);
    setLiveShareSession(null);
    setHasMoreHistory(false);
    setHistoryError(false);
    setOlderHistoryError(false);
    setLoadingHistory(false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    syncingMessagesRef.current = null;
    messagesLoadedRef.current = false;
    serverHistoryLoadedRef.current = false;
    latestMessageRef.current = null;
    shouldScrollToEndRef.current = false;
    nearBottomRef.current = true;

    const cached = auth?.user?.username ? loadRoomMessages(auth.user.username, chatId) : [];
    if (cached.length) {
      const cachedMessages = mapHistoryMessages(cached);
      rememberLatestMessage(cachedMessages);
      messagesLoadedRef.current = true;
      setMessages(cachedMessages);
      setHasMoreHistory(true);
    }

    void loadLatestMessages(epoch);

    const currentSocket = socket;
    const joinRoom = () => currentSocket?.emit('joinRoom', {roomId: chatId, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined});
    const markRoomRead = () => {
      if (!currentSocket?.connected) return;
      markMessageAsRead(undefined, chatId);
      resetUnreadCount(chatId);
    };
    const handleConnect = () => {
      joinRoom();
      // Refresh the current server page on reconnect so edits, recalls, and
      // reactions missed while offline are reconciled along with new messages.
      void loadLatestMessages();
      markRoomRead();
    };
    if (currentSocket?.connected) {
      joinRoom();
      markRoomRead();
    }
    currentSocket?.on('connect', handleConnect);

    // KHÔNG đăng ký onReceiveMessage handler ở đây nữa để tránh xung đột với ChatListScreen
    // ChatListScreen sẽ xử lý việc nhận tin nhắn và cập nhật unread count

    // Chỉ lắng nghe sự kiện tin nhắn được đánh dấu đã đọc
    const handleReadSuccess = (data: any) => {
      console.log('Tin nhắn đã được đánh dấu đã đọc:', data);
    };
    onMarkAsReadSuccess(handleReadSuccess);

    // Lắng nghe sự kiện tin nhắn được đọc bởi người khác
    const handleRead = (data: any) => {
      console.log('Tin nhắn được đọc bởi người khác:', data);
      // Cập nhật UI để hiển thị trạng thái đã đọc
    };
    onMessageRead(handleRead);

    return () => {
      if (messageEpochRef.current === epoch) messageEpochRef.current += 1;
      messagesLoadedRef.current = false;
      currentSocket?.off('connect', handleConnect);
      // Chỉ cleanup handlers của ChatDetail
      offMessageRead(handleRead);
      offMarkAsReadEvents(handleReadSuccess);
    };
  }, [chatId, auth, loadLatestMessages, rememberLatestMessage, syncMissedMessages, resetUnreadCount, mapHistoryMessages]);

  // Thêm một useEffect để refresh messages định kỳ khi đang ở trong chat
  useFocusEffect(
    React.useCallback(() => {
      console.log("ChatDetail focused - setting up message refresh");

      const messageHandler = (msg: any) => {
        if (!auth || !auth.user) return;
        if (String(msg.roomId) === String(chatId)) {
          console.log("ChatDetail: Adding new message to UI", msg);
          const incoming = mapHistoryMessages([msg]);
          rememberLatestMessage(incoming);
          if (nearBottomRef.current) shouldScrollToEndRef.current = true;
          setMessages(previous => mergeMessages(previous, incoming));

          // Reset unread count trong store local
          if (msg.roomId === chatId && msg.from !== auth.user.username) {
            resetUnreadCount(chatId);
            markMessageAsRead(undefined, chatId);
          }
        }
      };

      // Đăng ký handler tạm thời khi focus
      onReceiveMessage(messageHandler);
      const currentSocket = socket;
      const currentUserId = String(auth?.user?.username || '');
      const typingHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId)) return;
        const userId = String(payload?.userId || '');
        if (!userId || userId === currentUserId) return;
        typingPresenceTimersRef.current?.start(userId);
        setTypingUsers(previous => previous.includes(userId) ? previous : [...previous, userId]);
      };
      const stopTypingHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId)) return;
        const userId = String(payload?.userId || '');
        if (!userId) return;
        typingPresenceTimersRef.current?.stop(userId);
        setTypingUsers(previous => previous.filter(item => item !== userId));
      };
      const updateHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || !payload?._id) return;
        setMessages(previous => mergeMessages(previous, mapHistoryMessages([payload])));
      };
      const deletedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || !payload?.messageId) return;
        setMessages(previous => previous.map(item => String(item._id) === String(payload.messageId)
          ? {...item, content: '', deletedAt: payload.deletedAt || new Date().toISOString(), deletedBy: payload.deletedBy, reactions: []}
          : item));
      };
      const hiddenHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || String(payload?.userId) !== String(auth?.user?.username || '')) return;
        setMessages(previous => previous.filter(item => String(item._id) !== String(payload.messageId)));
      };
      const reactionHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || !payload?.messageId) return;
        setMessages(previous => previous.map(item => String(item._id) === String(payload.messageId)
          ? {...item, reactions: payload.reactions || []}
          : item));
      };
      const groupRemovedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId)) return;
        Alert.alert('Bạn đã bị xóa khỏi nhóm', 'Cuộc trò chuyện nhóm sẽ đóng.', [{text: 'Đóng', onPress: () => navigation.goBack()}]);
      };
      const roomDeletedHandler = (payload: any) => {
        const roomId = String(typeof payload === 'string' ? payload : payload?.roomId || payload?._id || '');
        if (roomId !== String(chatId)) return;
        Alert.alert('Cuộc trò chuyện đã bị xóa', 'Phòng chat này không còn khả dụng.', [{text: 'Đóng', onPress: () => navigation.goBack()}]);
      };
      const hiddenAccessEnded = (payload: any) => {
        if (String(payload?.roomId || '') !== String(chatId)) return;
        clearHiddenChatAccessToken();
        navigation.goBack();
      };
      const groupRenamedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || typeof payload?.name !== 'string') return;
        navigation.setParams({chatName: payload.name});
      };
      const groupPinUpdatedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId)) return;
        void loadGroupPins();
      };
      const pollUpdatedHandler = (payload: any) => {
        const messageId = String(payload?.messageId || '');
        if (String(payload?.roomId) !== String(chatId) || !messageId) return;
        void getGroupPoll(String(chatId), messageId).then(poll => {
          setMessages(previous => previous.map(item => String(item._id) === messageId ? {...item, poll, content: poll.question} : item));
          setPollSelections(previous => ({...previous, [messageId]: [...(poll.selectedOptionIds || [])]}));
        }).catch(() => {});
      };
      const liveLocationUpdatedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || !payload?.sessionId || !payload?.location) return;
        setMessages(previous => previous.map(item => String(item.location?.liveSessionId || '') === String(payload.sessionId)
          ? {...item, location: {...item.location, ...payload.location}}
          : item));
      };
      const liveLocationStoppedHandler = (payload: any) => {
        if (String(payload?.roomId) !== String(chatId) || !payload?.sessionId) return;
        const status = payload.status === 'expired' ? 'expired' : 'stopped';
        if (locationBridge) void locationBridge.stopLiveLocationService(String(payload.sessionId), false).catch(() => {});
        setMessages(previous => previous.map(item => String(item.location?.liveSessionId || '') === String(payload.sessionId)
          ? {...item, location: {...item.location, isLive: false, status, stoppedAt: new Date().toISOString()}}
          : item));
        setLiveShareSession(current => current?.sessionId === String(payload.sessionId) ? null : current);
      };
      currentSocket?.on('userTyping', typingHandler);
      currentSocket?.on('userStoppedTyping', stopTypingHandler);
      currentSocket?.on('messageUpdated', updateHandler);
      currentSocket?.on('messageDeleted', deletedHandler);
      currentSocket?.on('messageHidden', hiddenHandler);
      currentSocket?.on('messageReactionUpdated', reactionHandler);
      currentSocket?.on('groupRemoved', groupRemovedHandler);
      currentSocket?.on('roomDeleted', roomDeletedHandler);
      currentSocket?.on('hiddenChatAccessExpired', hiddenAccessEnded);
      currentSocket?.on('hiddenChatAccessRevoked', hiddenAccessEnded);
      currentSocket?.on('groupRenamed', groupRenamedHandler);
      currentSocket?.on('groupPinUpdated', groupPinUpdatedHandler);
      currentSocket?.on('pollUpdated', pollUpdatedHandler);
      currentSocket?.on('liveLocationUpdated', liveLocationUpdatedHandler);
      currentSocket?.on('liveLocationStopped', liveLocationStoppedHandler);
      void loadLatestMessages();
      void loadGroupPins();

      return () => {
        console.log("ChatDetail unfocused - removing message handler");
        // Cleanup handler khi unfocus
        stopLocalTyping();
        typingPresenceTimersRef.current?.clear();
        setTypingUsers([]);
        offReceiveMessage(messageHandler);
        currentSocket?.off('userTyping', typingHandler);
        currentSocket?.off('userStoppedTyping', stopTypingHandler);
        currentSocket?.off('messageUpdated', updateHandler);
        currentSocket?.off('messageDeleted', deletedHandler);
        currentSocket?.off('messageHidden', hiddenHandler);
        currentSocket?.off('messageReactionUpdated', reactionHandler);
        currentSocket?.off('groupRemoved', groupRemovedHandler);
        currentSocket?.off('roomDeleted', roomDeletedHandler);
        currentSocket?.off('hiddenChatAccessExpired', hiddenAccessEnded);
        currentSocket?.off('hiddenChatAccessRevoked', hiddenAccessEnded);
        if (route.params?.hiddenChatAccessToken) currentSocket?.emit('leaveRoom', {roomId: chatId});
        currentSocket?.off('groupRenamed', groupRenamedHandler);
        currentSocket?.off('groupPinUpdated', groupPinUpdatedHandler);
        currentSocket?.off('pollUpdated', pollUpdatedHandler);
        currentSocket?.off('liveLocationUpdated', liveLocationUpdatedHandler);
        currentSocket?.off('liveLocationStopped', liveLocationStoppedHandler);
      };
    }, [chatId, auth, mapHistoryMessages, rememberLatestMessage, loadLatestMessages, loadGroupPins, navigation, route.params?.hiddenChatAccessToken, stopLocalTyping, resetUnreadCount])
  );

  useLayoutEffect(() => {
    navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } });

    // Cleanup khi rời khỏi màn hình
    return () => {
      navigation.getParent()?.setOptions({ tabBarStyle: undefined });

      // Đảm bảo unread count được reset khi rời khỏi màn hình
      resetUnreadCount(chatId);
    };
  }, [navigation, chatId, resetUnreadCount]);

  useEffect(() => {
    if (auth?.user?.username && messages.length) {
      saveRoomMessages(auth.user.username, chatId, messages);
    }
  }, [auth?.user?.username, chatId, messages]);

  useEffect(() => {
    const accountId = String(auth?.user?.username || '');
    const token = auth?.token;
    if (!accountId || !token) return;

    const pending = messages.filter(message => hasUncachedMedia(message as MediaMessage)).slice(0, 24);
    if (!pending.length) return;

    let active = true;
    void Promise.all(pending.map(message => cacheMessageMedia(accountId, message as MediaMessage, token)))
      .then(cached => {
        if (!active) return;
        const replacements = new Map<string, MediaMessage>(cached.map(message => [String(message._id || ''), message] as const));
        const hasCachedCopy = cached.some(message => {
          const meta = message.fileMeta;
          return Boolean(meta?.localUri || meta?.images?.some(image => image.localUri));
        });
        if (!hasCachedCopy) return;

        setMessages(previous => {
          let changed = false;
          const next = previous.map(message => {
            const replacement = replacements.get(String(message._id || ''));
            if (!replacement?.fileMeta || replacement.fileMeta === message.fileMeta) return message;
            changed = true;
            return {...message, fileMeta: replacement.fileMeta};
          });
          if (changed) saveRoomMessages(accountId, String(chatId), next);
          return changed ? next : previous;
        });
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, [auth?.user?.username, auth?.token, chatId, messages]);

  useEffect(() => {
    messages.forEach(msg => {
      if (msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'image' && msg.fileMeta.fileUrl) {
        const url = resolveApiAssetUrl(msg.fileMeta.localUri || msg.fileMeta.fileUrl);
        if (!mediaSizes[url]) {
          Image.getSize(url, (width, height) => {
            setMediaSizes(sizes => ({ ...sizes, [url]: getMediaStyle(width, height) }));
          }, () => {
            setMediaSizes(sizes => ({ ...sizes, [url]: { width: MAX_MEDIA_WIDTH, height: MAX_MEDIA_HEIGHT } }));
          });
        }
      }
    });
  }, [messages, mediaSizes]);

  const handleSend = async (includeText = true): Promise<boolean> => {
    if (sendingRef.current) return false;
    stopLocalTyping();
    const textToSend = includeText ? message.trim() : '';
    if (editTarget) {
      if (!textToSend || selectedFiles.length) return false;
      sendingRef.current = true;
      setSending(true);
      try {
        const updated = await editChatMessage(String(editTarget._id), textToSend);
        setMessages(previous => mergeMessages(previous, mapHistoryMessages([updated])));
        setMessage('');
        setEditTarget(null);
        return true;
      } catch (error: any) {
        Alert.alert('Không sửa được tin nhắn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    }
    if (!textToSend && selectedFiles.length === 0) return false;
    const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
    sendingRef.current = true;
    setSending(true);
    let completed = true;
    let fileFailed = false;
    try {
      if (textToSend) {
        try {
          const typedMentionUsernames = new Set(Array.from(textToSend.matchAll(/(?:^|\s)@([A-Za-z0-9_.-]+)/g), match => match[1]));
          const mentionUserIds = isGroupChat ? groupMembers.filter(member => typedMentionUsernames.has(member.username)).map(member => member.username) : [];
          await sendMessage(chatId, textToSend, 'text', undefined, replyToId, undefined, undefined, mentionUserIds);
          setMessage('');
          setMentionQuery(null);
        } catch (error: any) {
          completed = false;
          Alert.alert('Không gửi được tin nhắn', error?.message || 'Vui lòng thử lại.');
        }
      }
      if (selectedFiles.length > 0) {
        const canGroupPhotos = selectedFiles.length > 1 && selectedFiles.every(file => file.type.startsWith('image/'));
        if (canGroupPhotos) {
          const unsentPhotos = await uploadInChunks(selectedFiles, 5, async batch => {
            const uploaded = batch.length === 1
              ? await uploadFile(batch[0], chatId, replyToId)
              : await uploadFiles(batch, chatId, replyToId);
            return Boolean(uploaded);
          });
          setSelectedFiles(unsentPhotos);
          if (unsentPhotos.length > 0) {
            fileFailed = true;
            completed = false;
          }
        } else {
          const failedFiles: typeof selectedFiles = [];
          for (const file of selectedFiles) {
            const fileMeta = await uploadFile(file, chatId, replyToId);
            if (!fileMeta) failedFiles.push(file);
          }
          setSelectedFiles(failedFiles);
          if (failedFiles.length) {
            fileFailed = true;
            completed = false;
          }
        }
        if (fileFailed) {
          Alert.alert('Không gửi được tệp đính kèm', 'Vui lòng thử lại các tệp còn trong khay.');
        }
      }
      if (completed) setReplyTarget(null);
      return completed;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const closeMessageActions = () => setActionMessage(null);

  const sendSticker = async (emoji: string) => {
    if (sendingRef.current || editTarget) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
      await sendMessage(chatId, emoji, 'sticker', undefined, replyToId);
      setReplyTarget(null);
      setStickerTrayVisible(false);
    } catch (error: any) {
      Alert.alert('Không gửi được sticker', error?.message || 'Vui lòng kiểm tra kết nối rồi thử lại.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const sendGif = async (gifId: string) => {
    if (sendingRef.current || editTarget) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
      await sendMessage(chatId, gifId, 'gif', undefined, replyToId);
      setReplyTarget(null);
      setGifTrayVisible(false);
    } catch (error: any) {
      Alert.alert('Không gửi được GIF', error?.message || 'Vui lòng kiểm tra kết nối rồi thử lại.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const shareCurrentLocation = async () => {
    if (Platform.OS !== 'android' || !locationBridge) {
      Alert.alert('Không hỗ trợ chia sẻ vị trí', 'Chia sẻ vị trí hiện chỉ hỗ trợ trên Android.');
      return;
    }
    try {
      const permissions = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);
      const granted = Object.values(permissions).some(value => value === PermissionsAndroid.RESULTS.GRANTED);
      if (!granted) {
        const blocked = Object.values(permissions).some(value => value === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        Alert.alert(
          'Chưa có quyền vị trí',
          'Cho phép MobileChat truy cập vị trí khi bạn chọn chia sẻ để gửi vị trí hiện tại.',
          blocked ? [{text: 'Để sau', style: 'cancel'}, {text: 'Mở cài đặt', onPress: () => { void Linking.openSettings(); }}] : [{text: 'Đóng'}],
        );
        return;
      }
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      const location = await locationBridge.getCurrentLocation();
      const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
      await sendMessage(chatId, 'Vị trí đã chia sẻ', 'location', undefined, replyToId, location);
      setReplyTarget(null);
    } catch (error: any) {
      if (error?.code === 'E_LOCATION_UNAVAILABLE') {
        Alert.alert('Đang tắt dịch vụ vị trí', 'Bật dịch vụ vị trí của thiết bị rồi thử lại.');
      } else if (error?.code === 'E_LOCATION_TIMEOUT') {
        Alert.alert('Chưa lấy được vị trí', 'Thiết bị chưa xác định được vị trí hiện tại. Hãy kiểm tra GPS hoặc kết nối mạng rồi thử lại.');
      } else {
        Alert.alert('Không chia sẻ được vị trí', error?.message || 'Vui lòng thử lại.');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const stopLiveLocationSharing = async () => {
    const active = liveShareSession;
    if (!active) return;
    try {
      const result = await stopLiveLocation(chatId, active.sessionId);
      const status = result.status === 'expired' ? 'expired' : 'stopped';
      if (locationBridge) {
        try { await locationBridge.stopLiveLocationService(active.sessionId, false); } catch { /* The server stop already succeeded. */ }
      }
      setMessages(previous => previous.map(item => String(item.location?.liveSessionId || '') === active.sessionId
        ? {...item, location: {...item.location, isLive: false, status, stoppedAt: new Date().toISOString()}}
        : item));
      setLiveShareSession(current => current?.sessionId === active.sessionId ? null : current);
    } catch (error: any) {
      if (error?.response?.status === 410) {
        if (locationBridge) void locationBridge.stopLiveLocationService(active.sessionId, false).catch(() => {});
        setMessages(previous => previous.map(item => String(item.location?.liveSessionId || '') === active.sessionId
          ? {...item, location: {...item.location, isLive: false, status: 'expired', stoppedAt: new Date().toISOString()}}
          : item));
        setLiveShareSession(current => current?.sessionId === active.sessionId ? null : current);
        return;
      }
      Alert.alert('Không dừng được chia sẻ vị trí', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    }
  };

  const startLiveLocation = async (durationMinutes: 15 | 60) => {
    if (Platform.OS !== 'android' || !locationBridge) {
      Alert.alert('Không hỗ trợ chia sẻ vị trí trực tiếp', 'Tính năng này hiện chỉ hỗ trợ trên Android.');
      return;
    }
    if (liveShareSession) {
      Alert.alert('Đang chia sẻ vị trí', 'Hãy dừng phiên hiện tại trước khi bắt đầu phiên mới.');
      return;
    }
    const permissions = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
    const granted = Object.values(permissions).some(value => value === PermissionsAndroid.RESULTS.GRANTED);
    if (!granted) {
      const blocked = Object.values(permissions).some(value => value === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
      Alert.alert(
        'Chưa có quyền vị trí',
        'Cho phép MobileChat truy cập vị trí để cập nhật vị trí trực tiếp trong cuộc trò chuyện.',
        blocked ? [{text: 'Để sau', style: 'cancel'}, {text: 'Mở cài đặt', onPress: () => { void Linking.openSettings(); }}] : [{text: 'Đóng'}],
      );
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const location = await locationBridge.getFreshLocation();
      const sessionId = `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
      const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
      await sendMessage(chatId, 'Đang chia sẻ vị trí trực tiếp', 'location', undefined, replyToId, {
        ...location,
        liveSessionId: sessionId,
        isLive: true,
        expiresAt,
      });
      setLiveShareSession({sessionId, expiresAt});
      setReplyTarget(null);
    } catch (error: any) {
      Alert.alert('Không thể chia sẻ vị trí trực tiếp', error?.response?.data?.error || error?.message || 'Vui lòng kiểm tra GPS và thử lại.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const chooseLiveLocationDuration = () => {
    if (liveShareSession) {
      Alert.alert('Đang chia sẻ vị trí', 'Hãy dừng phiên hiện tại trước khi bắt đầu phiên mới.');
      return;
    }
    Alert.alert('Chia sẻ vị trí trực tiếp', 'Chọn thời gian chia sẻ. Bạn có thể dừng bất cứ lúc nào.', [
      {text: '15 phút', onPress: () => { void startLiveLocation(15); }},
      {text: '1 giờ', onPress: () => { void startLiveLocation(60); }},
      {text: 'Hủy', style: 'cancel'},
    ]);
  };

  const confirmRetryOutboxMessage = (id: string) => {
    retryQueuedMessage(id);
  };

  const openComposerQuickAction = (action: 'file' | 'location' | 'liveLocation' | 'sticker' | 'gif' | 'poll') => {
    setQuickActionsVisible(false);
    setTimeout(() => {
      if (action === 'file') void pickFile();
      else if (action === 'location') void shareCurrentLocation();
      else if (action === 'liveLocation') chooseLiveLocationDuration();
      else if (action === 'sticker') setStickerTrayVisible(true);
      else if (action === 'gif') setGifTrayVisible(true);
      else setPollComposerVisible(true);
    }, 240);
  };

  const sendGroupPoll = async () => {
    const question = pollQuestion.trim();
    const options = pollOptions.map(item => item.trim());
    if (!question) return Alert.alert('Thiếu câu hỏi', 'Nhập nội dung bình chọn trước khi gửi.');
    if (options.length < 2 || options.some(item => !item)) return Alert.alert('Thiếu lựa chọn', 'Nhập ít nhất hai lựa chọn, không để trống.');
    if (new Set(options.map(item => item.toLocaleLowerCase())).size !== options.length) return Alert.alert('Lựa chọn bị trùng', 'Mỗi lựa chọn cần có nội dung khác nhau.');
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const endAt = pollExpiryHours ? new Date(Date.now() + pollExpiryHours * 60 * 60 * 1000).toISOString() : null;
      await sendMessage(chatId, question, 'poll', undefined, undefined, undefined, {
        question,
        options,
        allowMultiple: pollAllowMultiple,
        allowAddOptions: pollAllowAddOptions,
        anonymous: pollAnonymous,
        hideResultsUntilVote: pollHideResults,
        endAt,
      });
      setPollComposerVisible(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollAllowMultiple(false);
      setPollAllowAddOptions(false);
      setPollAnonymous(false);
      setPollHideResults(false);
      setPollExpiryHours(0);
    } catch (error: any) {
      Alert.alert('Không gửi được bình chọn', error?.message || error?.response?.data?.error || 'Kiểm tra kết nối rồi thử lại.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const applyPollUpdate = (messageId: string, poll: GroupPoll) => {
    setMessages(previous => previous.map(item => String(item._id) === String(messageId) ? {...item, poll, content: poll.question} : item));
    setPollSelections(previous => ({...previous, [String(messageId)]: [...(poll.selectedOptionIds || [])]}));
  };

  const refreshGroupPoll = async (messageId: string) => {
    try {
      const poll = await getGroupPoll(String(chatId), String(messageId));
      applyPollUpdate(String(messageId), poll);
    } catch { /* a later chat refresh will retry if the message is no longer available */ }
  };

  const openPollDetails = async (messageId: string) => {
    setPollDetailMessageId(messageId);
    setPollDetailData(null);
    setPollDetailsLoading(true);
    try {
      setPollDetailData(await getGroupPoll(String(chatId), messageId));
    } catch (error: any) {
      setPollDetailMessageId(null);
      Alert.alert('Không tải được kết quả', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setPollDetailsLoading(false);
    }
  };

  const togglePollSelection = (messageId: string, optionId: string, poll: GroupPoll) => {
    setPollSelections(previous => {
      const current = previous[messageId] ?? poll.selectedOptionIds ?? [];
      if (current.includes(optionId)) return {...previous, [messageId]: current.filter(id => id !== optionId)};
      return {...previous, [messageId]: poll.allowMultiple ? [...current, optionId] : [optionId]};
    });
  };

  const submitPollVote = async (messageId: string, optionIds: string[]) => {
    if (pollBusyId) return;
    setPollBusyId(messageId);
    try {
      const poll = await voteGroupPoll(String(chatId), messageId, optionIds);
      applyPollUpdate(messageId, poll);
    } catch (error: any) {
      Alert.alert('Không cập nhật được bình chọn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
      void refreshGroupPoll(messageId);
    } finally {
      setPollBusyId(null);
    }
  };

  const saveNewPollOption = async () => {
    const messageId = addPollOptionMessageId;
    const text = newPollOption.trim();
    if (!messageId || !text || pollBusyId) return;
    setPollBusyId(messageId);
    try {
      const poll = await addGroupPollOption(String(chatId), messageId, text);
      applyPollUpdate(messageId, poll);
      setAddPollOptionMessageId(null);
      setNewPollOption('');
    } catch (error: any) {
      Alert.alert('Không thêm được lựa chọn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setPollBusyId(null);
    }
  };

  const confirmClosePoll = (messageId: string) => Alert.alert('Kết thúc bình chọn?', 'Thành viên sẽ không thể thay đổi lựa chọn sau khi kết thúc.', [
    {text: 'Hủy', style: 'cancel'},
    {text: 'Kết thúc', style: 'destructive', onPress: () => {
      setPollBusyId(messageId);
      void closeGroupPoll(String(chatId), messageId).then(poll => applyPollUpdate(messageId, poll)).catch((error: any) => {
        Alert.alert('Không kết thúc được bình chọn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
      }).finally(() => setPollBusyId(null));
    }},
  ]);

  const shareSelectedMessage = async () => {
    const selected = actionMessage;
    closeMessageActions();
    const rawUrl = selected?.fileMeta?.fileUrl;
    const url = resolveApiAssetUrl(rawUrl);
    const sharedContent = selected?.type === 'gif'
      ? `[GIF] ${GIF_PACK.find(item => item.id === selected.content)?.label || ''}`.trim()
      : selected?.content;
    const text = [sharedContent, url].filter(Boolean).join('\n');
    if (!text) return;
    try { await Share.share({message: text}); }
    catch { Alert.alert('Không thể chia sẻ tin nhắn', 'Vui lòng thử lại.'); }
  };

  const replyToSelectedMessage = () => {
    if (!actionMessage) return;
    setReplyTarget(actionMessage);
    setEditTarget(null);
    setMessage('');
    closeMessageActions();
  };

  const toggleGroupPin = async (selected: any, closeActions = false) => {
    const messageId = selected?._id ? String(selected._id) : '';
    if (!isGroupChat || !messageId || selected.deletedAt) return;
    const isPinned = groupPins.some(item => String(item._id) === messageId);
    setGroupPinBusyId(messageId);
    try {
      const result = isPinned
        ? await unpinGroupMessage(String(chatId), messageId)
        : await pinGroupMessage(String(chatId), messageId);
      setGroupPins(Array.isArray(result.messages) ? result.messages : []);
      if (closeActions) closeMessageActions();
    } catch (error: any) {
      Alert.alert(isPinned ? 'Không bỏ ghim được' : 'Không ghim được tin nhắn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setGroupPinBusyId(null);
    }
  };

  const openPinnedMessage = async (pinned: any) => {
    if (!pinned?._id) return;
    const messageId = String(pinned._id);
    try {
      const result = await getMessageContext(String(chatId), messageId);
      const contextMessages = mapHistoryMessages(Array.isArray(result.messages) ? result.messages : []);
      if (contextMessages.length) {
        pendingJumpMessageIdRef.current = messageId;
        setMessages(previous => mergeMessages(previous, contextMessages));
      }
      setGroupBoardVisible(false);
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToMessage(messageId)));
    } catch (error: any) {
      Alert.alert('Không mở được tin đã ghim', error?.response?.data?.error || error?.message || 'Tin nhắn có thể đã bị xóa.');
      void loadGroupPins();
    }
  };

  const scrollToMessage = (messageId: string) => {
    const offset = messageLayoutsRef.current[messageId];
    if (offset === undefined) {
      pendingJumpMessageIdRef.current = messageId;
      return;
    }
    pendingJumpMessageIdRef.current = null;
    scrollRef.current?.scrollTo({y: Math.max(0, offset - 76), animated: true});
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 2200);
  };

  const editSelectedMessage = () => {
    if (!actionMessage?.isMine || actionMessage.type !== 'text' || actionMessage.deletedAt) return;
    setEditTarget(actionMessage);
    setReplyTarget(null);
    setSelectedFiles([]);
    setMessage(String(actionMessage.content || ''));
    closeMessageActions();
  };

  const reactToSelectedMessage = async (emoji: string, target: any = actionMessage) => {
    const selected = target;
    if (!selected?._id || selected.deletedAt) return;
    closeMessageActions();
    try {
      const result = await toggleChatMessageReaction(String(selected._id), emoji);
      setMessages(previous => previous.map(item => String(item._id) === String(selected._id)
        ? {...item, reactions: result.reactions || []}
        : item));
    } catch (error: any) {
      Alert.alert('Không cập nhật được cảm xúc', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    }
  };

  const confirmDeleteSelectedMessage = (scope: 'me' | 'everyone') => {
    const selected = actionMessage;
    closeMessageActions();
    if (!selected?._id) return;
    const title = scope === 'everyone' ? 'Thu hồi tin nhắn?' : 'Xóa tin nhắn khỏi phía bạn?';
    Alert.alert(title, 'Thao tác này sẽ cập nhật lịch sử trò chuyện.', [
      {text: 'Hủy', style: 'cancel'},
      {text: scope === 'everyone' ? 'Thu hồi' : 'Xóa', style: 'destructive', onPress: async () => {
        try {
          const result = await deleteChatMessage(String(selected._id), scope);
          if (scope === 'me') setMessages(previous => previous.filter(item => String(item._id) !== String(selected._id)));
          else setMessages(previous => previous.map(item => String(item._id) === String(selected._id)
            ? {...item, content: '', deletedAt: result.deletedAt || new Date().toISOString(), reactions: []}
            : item));
        } catch (error: any) {
          Alert.alert('Không xóa được tin nhắn', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        }
      }},
    ]);
  };

  const openForwardPicker = async () => {
    setForwardTarget(actionMessage);
    closeMessageActions();
    setLoadingForwardRooms(true);
    setForwardModalVisible(true);
    try {
      const rooms = await LayTatCaPhongChat();
      setForwardRooms(Array.isArray(rooms) ? rooms.filter((room: any) => String(room._id) !== String(chatId)) : []);
    } catch (error: any) {
      setForwardModalVisible(false);
      Alert.alert('Không tải được danh sách chat', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setLoadingForwardRooms(false);
    }
  };

  const forwardToRoom = async (room: any) => {
    if (!forwardTarget?._id) return;
    try {
      await forwardChatMessage(String(forwardTarget._id), String(room._id));
      setForwardModalVisible(false);
      setForwardTarget(null);
      Alert.alert('Đã chuyển tiếp', 'Tin nhắn đã được gửi vào cuộc trò chuyện.');
    } catch (error: any) {
      Alert.alert('Không chuyển tiếp được', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    }
  };

  const startVoiceRecording = async () => {
    if (Platform.OS !== 'android') return;
    if (!voiceRecorder) {
      Alert.alert('Ghi âm chưa sẵn sàng', 'Hãy cài lại bản Android mới nhất rồi thử lại.');
      return;
    }
    if (sendingRef.current || voiceRecordingRef.current) return;
    voiceRecordingRef.current = true;

    try {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Cho phép ghi âm',
          message: 'MobileChat cần quyền microphone để ghi tin nhắn thoại.',
          buttonNegative: 'Từ chối',
          buttonPositive: 'Cho phép',
        },
      );
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        voiceRecordingRef.current = false;
        Alert.alert('Chưa có quyền microphone', 'Bạn có thể cấp quyền microphone trong phần cài đặt ứng dụng.');
        return;
      }

      await voiceRecorder.startRecording();
      voiceStartedAtRef.current = Date.now();
      setVoiceRecordingSeconds(0);
      setIsVoiceRecording(true);
    } catch (error: any) {
      voiceRecordingRef.current = false;
      Alert.alert('Không thể bắt đầu ghi âm', error?.message || 'Hãy kiểm tra quyền microphone rồi thử lại.');
    }
  };

  const cancelVoiceRecording = async () => {
    if (!voiceRecordingRef.current) return;
    voiceRecordingRef.current = false;
    setIsVoiceRecording(false);
    setVoiceRecordingSeconds(0);
    try {
      await voiceRecorder?.cancelRecording();
    } catch (error) {
      console.warn('Could not cancel voice recording:', error);
    }
  };

  const stopAndSendVoiceRecording = async () => {
    if (!voiceRecordingRef.current || !voiceRecorder || sendingRef.current) return;
    voiceRecordingRef.current = false;
    sendingRef.current = true;
    setIsVoiceRecording(false);
    setSending(true);

    try {
      const clip = await voiceRecorder.stopRecording();
      const voiceFile = {uri: clip.uri, name: clip.fileName, type: clip.type || 'audio/mp4', duration: clip.duration};
      const replyToId = replyTarget?._id ? String(replyTarget._id) : undefined;
      const result = await uploadFile(voiceFile, chatId, replyToId);
      if (!result) {
        setSelectedFiles(previous => [...previous, voiceFile]);
        Alert.alert('Chưa gửi được tin nhắn thoại', 'Bản ghi đã được giữ trong khung soạn. Chạm nút gửi để thử lại.');
        return;
      }
      setReplyTarget(null);
    } catch (error: any) {
      const tooShort = error?.code === 'E_RECORDING_TOO_SHORT';
      Alert.alert(
        tooShort ? 'Tin nhắn thoại quá ngắn' : 'Không thể gửi tin nhắn thoại',
        tooShort ? 'Hãy ghi âm ít nhất một giây rồi gửi.' : (error?.message || 'Hãy thử ghi âm lại.'),
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const matchedServerIds = new Set<string>();
  const pendingMatchForServer = new Map<string, OutboxMessage>();
  outboxMessages.forEach(item => {
    if (!item.lastAttemptAt) return;
    const sentAt = new Date(item.lastAttemptAt || item.createdAt).getTime();
    const match = messages.find(candidate => {
      const candidateId = String(candidate._id || '');
      const candidateTime = new Date(candidate.createdAt || candidate.timestamp || 0).getTime();
      const sameClientMessageId = String(candidate.clientMessageId || '') === item.id;
      return candidateId && !matchedServerIds.has(candidateId) && candidate.isMine &&
        (sameClientMessageId || (candidate.type === item.type && String(candidate.content || '') === item.content &&
          Math.abs(candidateTime - sentAt) <= 2 * 60 * 1000));
    });
    if (match?._id) {
      const id = String(match._id);
      matchedServerIds.add(id);
      pendingMatchForServer.set(id, item);
    }
  });
  const displayedMessages = mergeMessages(
    messages.map(item => {
      const pending = pendingMatchForServer.get(String(item._id || ''));
      return {...item, isPending: Boolean(pending), lastAttemptAt: pending?.lastAttemptAt, outboxId: pending?.id};
    }),
    outboxMessages.filter(item => !Array.from(pendingMatchForServer.values()).some(match => match.id === item.id)).map(item => ({
      _id: `outbox:${item.id}`,
      from: item.accountId,
      to: item.roomId,
      content: item.content,
      mentions: item.mentions || [],
      type: item.type,
      createdAt: item.createdAt,
      isMine: true,
      isPending: true,
      lastAttemptAt: item.lastAttemptAt,
      outboxId: item.id,
    })),
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 50 : 70}
    >
      {liveShareSession && <View style={{minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#eaf3ff', borderBottomWidth: 1, borderBottomColor: '#d2e5fb'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}><Icon name="location-arrow" size={15} color="#2179ee" /><Text style={{marginLeft: 8, color: '#245b91', fontSize: 13, fontWeight: '600'}}>Đang chia sẻ vị trí trực tiếp</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dừng chia sẻ vị trí trực tiếp" onPress={() => { void stopLiveLocationSharing(); }} style={{paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: '#fff'}}><Text style={{fontSize: 12, fontWeight: '700', color: '#bd4651'}}>Dừng</Text></TouchableOpacity>
      </View>}
      {isGroupChat && <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Mở bảng tin nhóm"
        onPress={() => { setGroupBoardVisible(true); void loadGroupPins(true); }}
        style={styles.groupPinBanner}
      >
        <View style={styles.groupPinBannerIcon}><Icon name="thumb-tack" size={16} color="#2179ee" /></View>
        <View style={styles.groupPinBannerCopy}>
          <Text style={styles.groupPinTitle}>Bảng tin nhóm</Text>
          <Text numberOfLines={1} style={styles.groupPinSubtitle}>{groupPins.length ? `${groupPins.length} tin quan trọng được ghim` : 'Ghim tin nhắn quan trọng để cả nhóm dễ tìm'}</Text>
        </View>
        <Text style={styles.groupPinCount}>{groupPins.length}</Text>
        <Icon name="chevron-right" size={13} color="#8b98a6" />
      </TouchableOpacity>}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const remaining = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
          nearBottomRef.current = remaining < 120;
          setShowScrollToBottom(remaining > 240);
        }}
        onContentSizeChange={() => {
          if (messagesLoadedRef.current && shouldScrollToEndRef.current) {
            shouldScrollToEndRef.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        <View style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {loadingHistory || loadingOlder ? <ActivityIndicator size="small" color="#2179ee" /> : historyError ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => { void loadLatestMessages(); }}><Text style={{ color: '#2179ee' }}>Không tải được tin nhắn. Chạm để thử lại</Text></TouchableOpacity>
          ) : olderHistoryError ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => { void loadOlderMessages(); }}><Text style={{ color: '#2179ee' }}>Không tải được tin nhắn cũ. Chạm để thử lại</Text></TouchableOpacity>
          ) : hasMoreHistory ? (
            <TouchableOpacity onPress={loadOlderMessages}><Text style={{ color: '#2179ee' }}>Xem tin nhắn cũ hơn</Text></TouchableOpacity>
          ) : null}
        </View>
        {messagesLoadedRef.current && messages.length === 0 && !historyError && (
          <Text style={{ color: '#888', textAlign: 'center', marginTop: 24 }}>Chưa có tin nhắn trong cuộc trò chuyện này.</Text>
        )}
        {displayedMessages.map((msg, idx) => {
          const isRevoked = Boolean(msg.deletedAt);
          const isImage = !isRevoked && msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'image' && msg.fileMeta.fileUrl;
          const imageItems = Array.isArray(msg.fileMeta?.images) && msg.fileMeta.images.length ? msg.fileMeta.images : (isImage ? [msg.fileMeta] : []);
          const isVideo = !isRevoked && msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'video' && msg.fileMeta.fileUrl;
          const isAudio = !isRevoked && msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'audio' && msg.fileMeta.fileUrl;
          const isFile = !isRevoked && msg.fileMeta?.fileType && getFileType(msg.fileMeta.fileType) === 'file' && msg.fileMeta.fileUrl;
          const isCall = !isRevoked && msg.type === 'call';
          const isPoll = !isRevoked && msg.type === 'poll';
          const poll = isPoll && msg.poll ? msg.poll as GroupPoll : null;
          const pollMessageId = String(msg._id || '');
          const selectedPollOptionIds = poll ? pollSelections[pollMessageId] ?? poll.selectedOptionIds ?? [] : [];
          const pollTotalVotes = poll?.options.reduce((total, option) => total + Number(option.voteCount || 0), 0) || 0;
          const isSticker = !isRevoked && msg.type === 'sticker';
          const isGif = !isRevoked && msg.type === 'gif';
          const gifAsset = isGif ? GIF_PACK.find(item => item.id === msg.content) : undefined;
          const isLocation = !isRevoked && msg.type === 'location';
          const richLinkUrl = !isRevoked && msg.type === 'text' && msg.content ? firstHttpUrl(String(msg.content)) : null;
          const callIsVideo = msg.call?.callType === 'video' || String(msg.content || '').toLocaleLowerCase().includes('video');
          const callDuration = Number(msg.call?.duration || 0);
          const audioId = String(msg._id || `${msg.createdAt}-${idx}`);
          const audioData = audioProgress[audioId];
          const audioDuration = audioData?.duration || Number(msg.fileMeta?.duration) || 0;
          const audioPosition = audioData?.currentTime || 0;
          const audioRatio = audioDuration > 0 ? Math.min(1, audioPosition / audioDuration) : 0;
          const waveform = getAudioWaveform(audioId);
          const date = new Date(msg.createdAt || msg.timestamp);
          const previousDate = idx > 0 ? new Date(messages[idx - 1].createdAt || messages[idx - 1].timestamp) : null;
          const showDate = !Number.isNaN(date.getTime()) && (!previousDate || Number.isNaN(previousDate.getTime()) || date.toDateString() !== previousDate.toDateString());
          const url = msg.fileMeta?.fileUrl ? resolveApiAssetUrl(msg.fileMeta.localUri || msg.fileMeta.fileUrl) : null;

          const containerStyle = [
            styles.messageContainer,
            msg.isMine ? styles.messageMine : styles.messageOther
          ];

          let bubbleStyle;
          if (isSticker) {
            bubbleStyle = styles.messageBubbleSticker;
          } else if (isGif) {
            bubbleStyle = styles.messageBubbleFile;
          } else if (isLocation || isPoll) {
            bubbleStyle = styles.messageBubbleFile;
          } else if (isRevoked || isCall || !msg.fileMeta || (!isImage && !isVideo && !isAudio && !isFile)) {
            bubbleStyle = msg.isMine
              ? styles.messageBubbleMine
              : styles.messageBubbleOther;
          } else {
            bubbleStyle = styles.messageBubbleFile;
          }

          return (
            <React.Fragment key={msg._id ? String(msg._id) : `${msg.createdAt}-${idx}`}>
            {showDate && <Text style={{alignSelf: 'center', overflow: 'hidden', backgroundColor: '#dce5ed', color: '#667685', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 12, marginVertical: 10, fontSize: 12}}>{date.toLocaleDateString('vi-VN', {weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'})}</Text>}
            <View
              style={[containerStyle, highlightedMessageId === String(msg._id || '') && {paddingVertical: 6, borderRadius: 14, backgroundColor: '#fff2c6'}]}
              onLayout={event => {
                const messageId = String(msg._id || '');
                if (!messageId) return;
                messageLayoutsRef.current[messageId] = event.nativeEvent.layout.y;
                if (pendingJumpMessageIdRef.current === messageId) requestAnimationFrame(() => scrollToMessage(messageId));
              }}
            >
              {!msg.isMine && (
                <Text style={styles.senderName}>{msg.from}</Text>
              )}
              <TouchableOpacity activeOpacity={1} delayLongPress={350} onLongPress={() => !isRevoked && !msg.isPending && setActionMessage(msg)} style={bubbleStyle}>
                {!isRevoked && msg.replyTo && (
                  <View style={styles.replyPreview}>
                    <Text numberOfLines={1} style={styles.replyPreviewAuthor}>{msg.replyTo.userId || 'Tin nhắn'}</Text>
                    <Text numberOfLines={2} style={styles.replyPreviewContent}>
                      {msg.replyTo.type === 'gif' ? 'GIF' : msg.replyTo.content || msg.replyTo.fileName || ({ image: 'Ảnh', video: 'Video', audio: 'Tin nhắn thoại', file: 'Tệp', call: 'Cuộc gọi', sticker: 'Sticker', location: 'Vị trí', poll: 'Bình chọn' } as Record<string, string>)[msg.replyTo.type] || 'Tin nhắn'}
                    </Text>
                  </View>
                )}
                {isRevoked ? (
                  <Text style={styles.revokedMessage}>Tin nhắn đã được thu hồi</Text>
                ) : msg.content && (!isImage && !isVideo && !isAudio && !isFile && !isCall && !isSticker && !isLocation && !isGif && !isPoll) ? (
                  <LinkedMessageText content={String(msg.content)} mentions={msg.mentions} style={msg.isMine ? styles.messageTextMine : styles.messageTextOther} />
                ) : null}
                {richLinkUrl && <RichLinkPreviewCard url={richLinkUrl} />}
                {poll && <View style={styles.groupPollCard}>
                  <View style={styles.groupPollTitleRow}>
                    <View style={styles.groupPollIcon}><Icon name="bar-chart" size={15} color="#2179ee" /></View>
                    <Text style={styles.groupPollTitle}>Bình chọn</Text>
                    {poll.anonymous && <Text style={styles.groupPollBadge}>Ẩn danh</Text>}
                  </View>
                  <Text style={styles.groupPollQuestion}>{poll.question || msg.content}</Text>
                  <Text style={styles.groupPollMeta}>
                    {poll.allowMultiple ? 'Có thể chọn nhiều đáp án' : 'Chọn một đáp án'}
                    {poll.endAt ? ` · Hạn ${new Date(poll.endAt).toLocaleString('vi-VN', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}` : ''}
                  </Text>
                  {poll.options.map(option => {
                    const selected = selectedPollOptionIds.includes(option.id);
                    const count = Number(option.voteCount || 0);
                    const percent = !poll.resultsHidden && pollTotalVotes > 0 ? Math.round(count / pollTotalVotes * 100) : 0;
                    return <TouchableOpacity
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${selected ? 'Đã chọn' : 'Chọn'} ${option.text}`}
                      disabled={!poll.isOpen || pollBusyId === pollMessageId}
                      onPress={() => togglePollSelection(pollMessageId, option.id, poll)}
                      style={[styles.groupPollOption, selected && styles.groupPollOptionSelected]}
                    >
                      <View style={styles.groupPollOptionLabelRow}>
                        <Icon name={selected ? 'check-circle' : 'circle-o'} size={17} color={selected ? '#2179ee' : '#9aa8b6'} />
                        <Text style={styles.groupPollOptionLabel}>{option.text}</Text>
                        {!poll.resultsHidden && <Text style={styles.groupPollCount}>{count}</Text>}
                      </View>
                      {!poll.resultsHidden && <View style={styles.groupPollProgressTrack}><View style={[styles.groupPollProgressFill, {width: `${percent}%`}]} /></View>}
                    </TouchableOpacity>;
                  })}
                  {poll.resultsHidden && <Text style={styles.groupPollMeta}>Kết quả sẽ hiện sau khi bạn bình chọn</Text>}
                  <View style={styles.groupPollFooter}>
                    {poll.isOpen ? <>
                      <TouchableOpacity
                        disabled={pollBusyId === pollMessageId || (!selectedPollOptionIds.length && !poll.selectedOptionIds.length)}
                        onPress={() => { void submitPollVote(pollMessageId, selectedPollOptionIds); }}
                        style={[styles.groupPollVoteButton, (!selectedPollOptionIds.length && !poll.selectedOptionIds.length) && styles.groupPollDisabledButton]}
                      >
                        {pollBusyId === pollMessageId ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.groupPollVoteText}>{poll.selectedOptionIds.length ? 'Cập nhật phiếu' : 'Bình chọn'}</Text>}
                      </TouchableOpacity>
                      {!!poll.selectedOptionIds.length && <TouchableOpacity disabled={pollBusyId === pollMessageId} onPress={() => { void submitPollVote(pollMessageId, []); }} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>Rút phiếu</Text></TouchableOpacity>}
                    </> : <Text style={styles.groupPollClosed}>{poll.closedAt ? 'Đã kết thúc' : 'Đã hết hạn'}</Text>}
                  </View>
                  {(poll.allowAddOptions && poll.isOpen && poll.options.length < 10) && <TouchableOpacity onPress={() => { setNewPollOption(''); setAddPollOptionMessageId(pollMessageId); }} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>+ Thêm lựa chọn</Text></TouchableOpacity>}
                  {poll.createdBy === String(auth?.user?.username || '') && poll.isOpen && <TouchableOpacity disabled={pollBusyId === pollMessageId} onPress={() => confirmClosePoll(pollMessageId)} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>Kết thúc bình chọn</Text></TouchableOpacity>}
                  {!poll.resultsHidden && <TouchableOpacity onPress={() => { void openPollDetails(pollMessageId); }} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>{poll.anonymous ? 'Xem kết quả chi tiết' : 'Xem người bình chọn'}</Text></TouchableOpacity>}
                </View>}
                {isSticker && <Text accessibilityLabel="Sticker" style={styles.stickerMessage}>{msg.content || '🙂'}</Text>}
                {isGif && <View style={styles.gifMessageCard}>
                  {gifAsset ? <Image source={gifAsset.source} style={styles.gifMessageImage} resizeMode="cover" /> : <Text style={styles.gifUnavailable}>GIF không khả dụng</Text>}
                  <Text style={styles.gifTag}>GIF</Text>
                </View>}
                {isLocation && <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Mở vị trí trên bản đồ"
                  delayLongPress={350}
                  onLongPress={() => !isRevoked && !msg.isPending && setActionMessage(msg)}
                  onPress={() => {
                    const latitude = Number(msg.location?.latitude);
                    const longitude = Number(msg.location?.longitude);
                    if (Number.isFinite(latitude) && Number.isFinite(longitude)) openMapLocation(latitude, longitude);
                    else Alert.alert('Vị trí không khả dụng', 'Tin nhắn này không có tọa độ hợp lệ.');
                  }}
                  style={styles.locationCard}
                >
                  <View style={styles.locationMapPreview}>
                    <View style={[styles.locationRoad, {top: '42%', left: -10, right: -10, height: 13, transform: [{rotate: '-8deg'}]}]} />
                    <View style={[styles.locationRoad, {top: -8, bottom: -8, left: '58%', width: 12, transform: [{rotate: '12deg'}]}]} />
                    <View style={styles.locationMarker}><Icon name="map-marker" size={31} color="#e34e4e" /></View>
                  </View>
                  <View style={{paddingHorizontal: 11, paddingVertical: 9}}>
                    <Text style={styles.locationTitle}>{msg.location?.liveSessionId ? 'Vị trí trực tiếp' : 'Vị trí đã chia sẻ'}</Text>
                    <Text style={styles.locationCoordinates}>{Number(msg.location?.latitude).toFixed(5)}, {Number(msg.location?.longitude).toFixed(5)}</Text>
                    {msg.location?.liveSessionId && <Text style={styles.locationOpenLabel}>
                      {msg.location?.isLive && msg.location?.status === 'active' && new Date(msg.location?.expiresAt || 0).getTime() > Date.now()
                        ? `Đang cập nhật · hết hạn ${new Date(msg.location.expiresAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`
                        : msg.location?.status === 'expired' || new Date(msg.location?.expiresAt || 0).getTime() <= Date.now()
                          ? 'Đã hết thời gian chia sẻ'
                          : 'Đã dừng chia sẻ'}
                    </Text>}
                    <Text style={styles.locationOpenLabel}>Chạm để mở bản đồ</Text>
                  </View>
                </TouchableOpacity>}
                {msg.forwardedFrom && !isRevoked && (
                  <Text style={styles.forwardedLabel}>↪ Đã chuyển tiếp</Text>
                )}

                {isCall && (
                  <View style={styles.callMessage}>
                    <View style={styles.callMessageIcon}><Icon name={callIsVideo ? 'video-camera' : 'phone'} size={17} color="#fff" /></View>
                    <View style={{flex: 1}}>
                      <Text style={styles.callMessageTitle}>{callIsVideo ? 'Cuộc gọi video' : 'Cuộc gọi thoại'}</Text>
                      <Text style={styles.callMessageStatus}>{callStatusLabel(msg.call?.status, msg.content)}{callDuration > 0 ? ` · ${formatAudioTime(callDuration)}` : ''}</Text>
                    </View>
                  </View>
                )}

                {isImage && imageItems.length > 1 && (
                  <View style={{width: PHOTO_GRID_WIDTH, flexDirection: 'row', flexWrap: 'wrap', gap: 3}}>
                    {imageItems.slice(0, 5).map((item: any, imageIndex: number) => {
                      const imageUrl = resolveApiAssetUrl(item.localUri || item.fileUrl);
                      const cellSize = (PHOTO_GRID_WIDTH - 3) / 2;
                      return <TouchableOpacity key={`${imageUrl}-${imageIndex}`} accessibilityRole="imagebutton" accessibilityLabel={`Mở ảnh ${imageIndex + 1} trong nhóm ảnh`} onPress={() => openImageViewer(imageUrl)}>
                        <Image source={{uri: imageUrl}} style={{width: cellSize, height: cellSize, borderRadius: 6, backgroundColor: '#e6ebf0'}} resizeMode="cover" />
                      </TouchableOpacity>;
                    })}
                  </View>
                )}
                {isImage && imageItems.length <= 1 && url && (
                  <TouchableOpacity
                    delayLongPress={350}
                    onLongPress={() => !isRevoked && setActionMessage(msg)}
                    onPress={() => openImageViewer(url)}
                  >
                    <Image
                      source={{ uri: url }}
                      style={[
                        styles.messageImage,
                        {
                          width: mediaSizes[url]?.width || 320,
                          height: mediaSizes[url]?.height || 200,
                        }
                      ]}
                    />
                  </TouchableOpacity>
                )}

                {isVideo && url && (
                  <View style={[styles.messageVideoContainer, {position: 'relative'}]}>
                    <Video
                      source={{ uri: url }}
                      style={styles.messageVideo}
                      controls
                      resizeMode="contain"
                    />
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Thao tác tin nhắn video"
                      onPress={() => setActionMessage(msg)}
                      style={{position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 2}}
                    >
                      <Icon name="ellipsis-h" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                )}

                {isAudio && url && (
                  <TouchableOpacity
                    accessibilityLabel={playingAudioId === audioId ? 'Dừng tin nhắn thoại' : 'Phát tin nhắn thoại'}
                    delayLongPress={350}
                    onLongPress={() => !isRevoked && setActionMessage(msg)}
                    onPress={() => toggleAudioPlayback(audioId, url)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, width: 280, maxWidth: '100%' }}
                  >
                    <Icon name={playingAudioId === audioId ? 'pause' : 'play'} size={19} color="#2179ee" />
                    <View style={{ height: 28, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginHorizontal: 11 }}>
                      {waveform.map((height, barIndex) => (
                        <View key={`${audioId}-wave-${barIndex}`} style={{ width: 3, height, borderRadius: 2, backgroundColor: barIndex / waveform.length <= audioRatio && playingAudioId === audioId ? '#2179ee' : '#b8c5d2' }} />
                      ))}
                    </View>
                    <Text style={[styles.fileMeta, { minWidth: 35, textAlign: 'right' }]}>
                      {audioDuration ? formatAudioTime(playingAudioId === audioId ? audioPosition : audioDuration) : '--:--'}
                    </Text>
                  </TouchableOpacity>
                )}

                {isFile && msg.fileMeta?.fileName && (
                  <TouchableOpacity
                    delayLongPress={350}
                    onLongPress={() => !isRevoked && setActionMessage(msg)}
                    onPress={() => {
                      if (url) Linking.openURL(url).catch(err => console.warn("Không mở được file:", err));
                    }}
                    style={styles.messageFileLink}
                  >
                    <Icon name="file" size={24} color="#2179ee" style={styles.messageFileIcon} />
                    <Text style={styles.messageFileText}>
                      {msg.fileMeta?.fileName ?? 'Không rõ tên file'}
                    </Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              {msg.isPending && msg.outboxId && msg.lastAttemptAt && outboxClock - new Date(msg.lastAttemptAt).getTime() >= 30000 && (
                <TouchableOpacity accessibilityRole="button" onPress={() => confirmRetryOutboxMessage(String(msg.outboxId))} style={{paddingVertical: 4, paddingHorizontal: 8}}>
                  <Text style={{fontSize: 12, color: '#b36b00'}}>Thử gửi lại</Text>
                </TouchableOpacity>
              )}
              {Array.isArray(msg.reactions) && msg.reactions.length > 0 && !isRevoked && (
                <View style={styles.reactionChips}>
                  {Object.entries(msg.reactions.reduce((counts: Record<string, number>, item: any) => {
                    counts[item.emoji] = (counts[item.emoji] || 0) + 1;
                    return counts;
                  }, {})).map(([emoji, count]) => (
                    <TouchableOpacity key={emoji} style={styles.reactionChip} onPress={() => { void reactToSelectedMessage(emoji, msg); }}>
                      <Text style={styles.reactionChipText}>{emoji} {String(count)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.timestamp}>{new Date(msg.createdAt).toLocaleTimeString()}{msg.editedAt ? ' · đã sửa' : ''}{msg.isPending ? (msg.lastAttemptAt ? ' · Chờ xác nhận' : ' · Chờ gửi') : ''}</Text>
              {/* Hiển thị trạng thái đã đọc */}
              <MessageReadStatus
                messageId={msg._id || `${idx}`}
                roomId={chatId}
                isGroup={route.params?.chatType === 'group'}
                isMine={msg.isMine && !isRevoked && !msg.isPending}
                currentUserId={String(auth?.user?.username || '')}
              />
            </View>
            </React.Fragment>
          );
        })}
      </ScrollView>
      {showScrollToBottom && <TouchableOpacity accessibilityLabel="Xuống tin nhắn mới nhất" onPress={() => scrollRef.current?.scrollToEnd({animated: true})} style={{position: 'absolute', right: 16, bottom: insets.bottom + 80, width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4}}><Icon name="angle-double-down" size={22} color="#2179ee" /></TouchableOpacity>}
      <View style={[styles.inputContainer, { flexDirection: 'column', alignItems: 'stretch', paddingBottom: insets.bottom + 8 }]}>
        {(replyTarget || editTarget) && (
          <View style={styles.replyComposer}>
            <View style={styles.replyComposerText}>
              <Text style={styles.replyComposerTitle}>{editTarget ? 'Chỉnh sửa tin nhắn' : `Trả lời ${replyTarget.from || 'tin nhắn'}`}</Text>
              <Text numberOfLines={1} style={styles.replyComposerContent}>
                {editTarget ? editTarget.content : (replyTarget.type === 'gif' ? 'GIF' : replyTarget.type === 'poll' ? 'Bình chọn' : (replyTarget.content || replyTarget.fileMeta?.fileName || 'Tin nhắn'))}
              </Text>
            </View>
            <TouchableOpacity accessibilityLabel="Đóng" onPress={() => { setReplyTarget(null); if (editTarget) { setEditTarget(null); setMessage(''); } }}>
              <Icon name="times" size={18} color="#777" />
            </TouchableOpacity>
          </View>
        )}
        {selectedFiles.length > 0 && (
          <View style={styles.selectedFilesRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {selectedFiles.map((file, idx) => (
                file.type.startsWith('image/') ? (
                  <View key={idx} style={styles.selectedFileImageBox}>
                    <Image source={{ uri: file.uri }} style={styles.selectedFileImage} />
                    <TouchableOpacity
                      style={styles.removeFileBtn}
                      disabled={sending}
                      onPress={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== idx))}
                    >
                      <Icon name="times" size={16} color="#2179ee" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View key={idx} style={styles.selectedFileBox}>
                    <Icon name="file" size={32} color="#2179ee" />
                    <Text numberOfLines={1} style={styles.selectedFileText}>{file.name ?? 'Không rõ tên file'}</Text>
                    <TouchableOpacity
                      style={styles.removeFileBtn}
                      disabled={sending}
                      onPress={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== idx))}
                    >
                      <Icon name="times" size={16} color="#2179ee" />
                    </TouchableOpacity>
                  </View>
                )
              ))}
            </ScrollView>
          </View>
        )}
        {typingUsers.length > 0 && <View style={{height: 20, justifyContent: 'center', paddingHorizontal: 14}}>
          <Text style={{fontSize: 12, color: '#818c98'}}>{route.params?.chatType === 'group'
            ? typingUsers.length > 1 ? `${typingUsers.length} thành viên đang nhập…` : 'Một thành viên đang nhập…'
            : `${route.params?.chatName || 'Đối phương'} đang nhập…`}</Text>
        </View>}
        {mentionQuery && groupMembers.some(member => `${member.name} ${member.username}`.toLocaleLowerCase().includes(mentionQuery.query.toLocaleLowerCase())) && <View style={{marginHorizontal: 12, marginBottom: 8, maxHeight: 190, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e4eaf1', overflow: 'hidden', elevation: 5}}>
          {groupMembers.filter(member => `${member.name} ${member.username}`.toLocaleLowerCase().includes(mentionQuery.query.toLocaleLowerCase())).slice(0, 6).map(member => <TouchableOpacity key={member.username} accessibilityRole="button" accessibilityLabel={`Gắn thẻ ${member.name || member.username}`} onPress={() => insertMention(member.username)} style={{minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8edf2'}}>
            <View style={{width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf5ff', marginRight: 10}}><Icon name="user" size={15} color="#2179ee" /></View>
            <View style={{flex: 1}}><Text numberOfLines={1} style={{fontSize: 14, fontWeight: '600', color: '#273444'}}>{member.name || member.username}</Text><Text style={{fontSize: 12, color: '#8793a0', marginTop: 2}}>@{member.username}</Text></View>
            <Icon name="at" size={17} color="#9aa8b6" />
          </TouchableOpacity>)}
        </View>}
        <View style={styles.inputRow}>
          <TouchableOpacity accessibilityLabel="Biểu tượng cảm xúc" style={styles.iconButton} disabled={sending || isVoiceRecording} onPress={() => setEmojiPickerVisible(true)}>
            <Icon name="smile-o" size={25} color="#2179ee" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} disabled={sending || isVoiceRecording || !!editTarget} onPress={() => setImageModalVisible(true)}>
            <Icon name="image" size={26} color="#2179ee" />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Thêm tệp, sticker, GIF hoặc vị trí" style={styles.iconButton} disabled={sending || isVoiceRecording || !!editTarget} onPress={() => setQuickActionsVisible(true)}>
            <Icon name="plus-circle" size={25} color="#2179ee" />
          </TouchableOpacity>
          {isVoiceRecording ? (
            <View style={styles.voiceRecordingStatus}>
              <View style={styles.voiceRecordingDot} />
              <Text style={styles.voiceRecordingText}>Đang ghi âm {formatAudioTime(voiceRecordingSeconds)}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Hủy ghi âm" onPress={() => { void cancelVoiceRecording(); }}>
                <Icon name="times" size={18} color="#c62828" />
              </TouchableOpacity>
            </View>
          ) : (
            <TextInput
              ref={composerInputRef}
              style={styles.textInput}
              placeholder="Nhập tin nhắn..."
              placeholderTextColor="#888"
              value={message}
              editable={!sending}
              onChangeText={handleComposerChange}
              onBlur={stopLocalTyping}
              onSubmitEditing={() => { void handleSend(); }}
              returnKeyType="send"
            />
          )}
          {Platform.OS === 'android' && !editTarget && (
            <TouchableOpacity
              style={[styles.iconButton, isVoiceRecording && styles.voiceStopButton]}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={isVoiceRecording ? 'Dừng và gửi tin nhắn thoại' : 'Ghi âm tin nhắn thoại'}
              onPress={() => { void (isVoiceRecording ? stopAndSendVoiceRecording() : startVoiceRecording()); }}
            >
              {isVoiceRecording
                ? <Icon name="stop" size={20} color="#fff" />
                : <Icon name="microphone" size={24} color="#2179ee" />}
            </TouchableOpacity>
          )}
          {!isVoiceRecording && (
            <TouchableOpacity style={styles.iconButton} disabled={sending} onPress={() => { void handleSend(); }}>
              {sending ? <ActivityIndicator size="small" color="#2179ee" /> : <Icon name={editTarget ? 'check' : 'send'} size={26} color="#2179ee" />}
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Modal visible={quickActionsVisible} transparent animationType="fade" onRequestClose={() => setQuickActionsVisible(false)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setQuickActionsVisible(false)} />
          <View style={styles.actionModalSheet}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={styles.actionModalTitle}>Thêm vào tin nhắn</Text>
              <TouchableOpacity accessibilityLabel="Đóng tiện ích" onPress={() => setQuickActionsVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
            </View>
            <View style={styles.quickActionGrid}>
              {[
                {id: 'file' as const, label: 'Tệp', icon: 'paperclip'},
                {id: 'location' as const, label: 'Vị trí', icon: 'map-marker'},
                {id: 'liveLocation' as const, label: 'Vị trí trực tiếp', icon: 'location-arrow'},
                {id: 'sticker' as const, label: 'Sticker', icon: 'gift'},
                {id: 'gif' as const, label: 'GIF', icon: 'film'},
                ...(isGroupChat ? [{id: 'poll' as const, label: 'Bình chọn', icon: 'bar-chart'}] : []),
              ].map(item => <TouchableOpacity
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => openComposerQuickAction(item.id)}
                style={styles.quickActionTile}
              >
                <Icon name={item.icon} size={24} color="#2179ee" />
                <Text style={styles.quickActionLabel}>{item.label}</Text>
              </TouchableOpacity>)}
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={pollComposerVisible} transparent animationType="slide" onRequestClose={() => setPollComposerVisible(false)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setPollComposerVisible(false)} />
          <View style={[styles.actionModalSheet, {maxHeight: '92%'}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={styles.actionModalTitle}>Tạo bình chọn nhóm</Text>
              <TouchableOpacity accessibilityLabel="Đóng tạo bình chọn" onPress={() => setPollComposerVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.groupPollFormLabel}>Câu hỏi</Text>
              <TextInput
                value={pollQuestion}
                onChangeText={setPollQuestion}
                maxLength={160}
                placeholder="Bạn muốn hỏi điều gì?"
                placeholderTextColor="#929eaa"
                style={[styles.groupPollFormInput, {minHeight: 56}]}
                multiline
              />
              <View style={styles.groupPollFormSectionTitle}>
                <Text style={styles.groupPollFormLabel}>Lựa chọn</Text>
                <Text style={styles.groupPollMeta}>{pollOptions.filter(item => item.trim()).length}/10</Text>
              </View>
              {pollOptions.map((option, index) => <View key={`poll-option-${index}`} style={styles.groupPollFormOptionRow}>
                <TextInput
                  value={option}
                  onChangeText={value => setPollOptions(previous => previous.map((item, current) => current === index ? value : item))}
                  maxLength={100}
                  placeholder={`Lựa chọn ${index + 1}`}
                  placeholderTextColor="#929eaa"
                  style={[styles.groupPollFormInput, {flex: 1}]}
                />
                {pollOptions.length > 2 && <TouchableOpacity accessibilityLabel={`Xóa lựa chọn ${index + 1}`} onPress={() => setPollOptions(previous => previous.filter((_, current) => current !== index))} style={{padding: 10}}><Icon name="times" size={16} color="#788492" /></TouchableOpacity>}
              </View>)}
              {pollOptions.length < 10 && <TouchableOpacity onPress={() => setPollOptions(previous => [...previous, ''])} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>+ Thêm lựa chọn</Text></TouchableOpacity>}

              <Text style={[styles.groupPollFormLabel, {marginTop: 15}]}>Thời hạn</Text>
              <View style={styles.groupPollExpiryRow}>
                {[{hours: 0, label: 'Không giới hạn'}, {hours: 1, label: '1 giờ'}, {hours: 24, label: '1 ngày'}, {hours: 168, label: '7 ngày'}].map(item => <TouchableOpacity key={item.hours} onPress={() => setPollExpiryHours(item.hours)} style={[styles.groupPollExpiryChip, pollExpiryHours === item.hours && styles.groupPollExpiryChipSelected]}><Text style={[styles.groupPollExpiryText, pollExpiryHours === item.hours && styles.groupPollExpiryTextSelected]}>{item.label}</Text></TouchableOpacity>)}
              </View>

              <Text style={[styles.groupPollFormLabel, {marginTop: 15}]}>Cài đặt</Text>
              {[
                {label: 'Cho phép chọn nhiều đáp án', value: pollAllowMultiple, toggle: () => setPollAllowMultiple(value => !value)},
                {label: 'Cho phép thêm lựa chọn', value: pollAllowAddOptions, toggle: () => setPollAllowAddOptions(value => !value)},
                {label: 'Bình chọn ẩn danh', value: pollAnonymous, toggle: () => setPollAnonymous(value => !value)},
                {label: 'Ẩn kết quả đến khi bình chọn', value: pollHideResults, toggle: () => setPollHideResults(value => !value)},
              ].map(item => <TouchableOpacity key={item.label} onPress={item.toggle} style={styles.groupPollSettingRow}>
                <Text style={styles.groupPollSettingLabel}>{item.label}</Text>
                <Icon name={item.value ? 'check-square' : 'square-o'} size={19} color={item.value ? '#2179ee' : '#9aa8b6'} />
              </TouchableOpacity>)}
              <TouchableOpacity disabled={sending} onPress={() => { void sendGroupPoll(); }} style={[styles.groupPollCreateButton, sending && {opacity: 0.65}]}>
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.groupPollCreateButtonText}>Gửi bình chọn</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={!!addPollOptionMessageId} transparent animationType="fade" onRequestClose={() => setAddPollOptionMessageId(null)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setAddPollOptionMessageId(null)} />
          <View style={styles.actionModalSheet}>
            <Text style={styles.actionModalTitle}>Thêm lựa chọn</Text>
            <TextInput value={newPollOption} onChangeText={setNewPollOption} maxLength={100} autoFocus placeholder="Nhập lựa chọn mới" placeholderTextColor="#929eaa" style={styles.groupPollFormInput} />
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14}}>
              <TouchableOpacity onPress={() => setAddPollOptionMessageId(null)} style={styles.groupPollTextButton}><Text style={styles.groupPollTextButtonLabel}>Hủy</Text></TouchableOpacity>
              <TouchableOpacity disabled={!newPollOption.trim() || pollBusyId === addPollOptionMessageId} onPress={() => { void saveNewPollOption(); }} style={styles.groupPollVoteButton}>
                <Text style={styles.groupPollVoteText}>Thêm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!pollDetailMessageId} transparent animationType="slide" onRequestClose={() => setPollDetailMessageId(null)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setPollDetailMessageId(null)} />
          <View style={[styles.actionModalSheet, {maxHeight: '82%'}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={styles.actionModalTitle}>{pollDetailData?.anonymous ? 'Kết quả ẩn danh' : 'Người bình chọn'}</Text>
              <TouchableOpacity accessibilityLabel="Đóng chi tiết bình chọn" onPress={() => setPollDetailMessageId(null)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
            </View>
            {pollDetailsLoading ? <ActivityIndicator style={{marginVertical: 24}} color="#2179ee" /> : pollDetailData ? <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.groupPollQuestion}>{pollDetailData.question}</Text>
              {pollDetailData.options.map(option => <View key={option.id} style={styles.groupPollDetailOption}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                  <Text style={styles.groupPollOptionLabel}>{option.text}</Text>
                  <Text style={styles.groupPollCount}>{option.voteCount ?? 0}</Text>
                </View>
                {pollDetailData.anonymous ? <Text style={styles.groupPollMeta}>Lượt chọn được giữ ẩn danh</Text> : option.voters?.length ? option.voters.map(voter => <View key={voter.username} style={styles.groupPollVoterRow}>
                  <View style={styles.groupPollVoterAvatar}><Text style={styles.groupPollVoterInitial}>{(voter.name || voter.username).trim().slice(0, 1).toLocaleUpperCase()}</Text></View>
                  <View style={{flex: 1}}>
                    <Text numberOfLines={1} style={styles.groupPollOptionLabel}>{voter.name || voter.username}</Text>
                    <Text numberOfLines={1} style={styles.groupPollMeta}>@{voter.username}</Text>
                  </View>
                </View>) : <Text style={styles.groupPollMeta}>Chưa có lượt chọn</Text>}
              </View>)}
            </ScrollView> : null}
          </View>
        </View>
      </Modal>
      <Modal visible={emojiPickerVisible} transparent animationType="slide" onRequestClose={() => setEmojiPickerVisible(false)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setEmojiPickerVisible(false)} />
          <View style={styles.actionModalSheet}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}><Text style={styles.actionModalTitle}>Biểu tượng cảm xúc</Text><TouchableOpacity accessibilityLabel="Đóng" onPress={() => setEmojiPickerVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity></View>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12}}>
              {QUICK_EMOJI.map(emoji => <TouchableOpacity key={emoji} accessibilityLabel={emoji} onPress={() => setMessage(previous => previous + emoji)} style={{width: '12.5%', alignItems: 'center', paddingVertical: 10}}><Text style={{fontSize: 25}}>{emoji}</Text></TouchableOpacity>)}
            </View>
            <TouchableOpacity style={styles.actionCancelButton} onPress={() => setEmojiPickerVisible(false)}><Text style={styles.actionCancelText}>Xong</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={stickerTrayVisible} transparent animationType="slide" onRequestClose={() => setStickerTrayVisible(false)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setStickerTrayVisible(false)} />
          <View style={styles.actionModalSheet}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={styles.actionModalTitle}>Sticker của bạn</Text>
              <TouchableOpacity accessibilityLabel="Đóng sticker" onPress={() => setStickerTrayVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
            </View>
            <Text style={{fontSize: 12, color: '#788492', marginTop: 3}}>Bộ biểu cảm có sẵn</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 12}}>
              {STICKER_PACK.map(sticker => <TouchableOpacity
                key={sticker.id}
                accessibilityRole="button"
                accessibilityLabel={`Gửi sticker ${sticker.label}`}
                disabled={sending}
                onPress={() => { void sendSticker(sticker.emoji); }}
                style={{width: '31%', minHeight: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f3f7fb', marginBottom: 8}}
              >
                <Text style={{fontSize: 42}}>{sticker.emoji}</Text>
                <Text style={{fontSize: 11, color: '#586575', marginTop: 2}}>{sticker.label}</Text>
              </TouchableOpacity>)}
            </View>
            <TouchableOpacity style={styles.actionCancelButton} onPress={() => setStickerTrayVisible(false)}><Text style={styles.actionCancelText}>Đóng</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={gifTrayVisible} transparent animationType="slide" onRequestClose={() => setGifTrayVisible(false)}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setGifTrayVisible(false)} />
          <View style={styles.actionModalSheet}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={styles.actionModalTitle}>GIF có sẵn</Text>
              <TouchableOpacity accessibilityLabel="Đóng GIF" onPress={() => setGifTrayVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
            </View>
            <Text style={{fontSize: 12, color: '#788492', marginTop: 3}}>Chọn ảnh động để gửi vào cuộc trò chuyện</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 12}}>
              {GIF_PACK.map(gif => <TouchableOpacity
                key={gif.id}
                accessibilityRole="button"
                accessibilityLabel={`Gửi GIF: ${gif.label}`}
                disabled={sending}
                onPress={() => { void sendGif(gif.id); }}
                style={{width: '48%', alignItems: 'center', borderRadius: 12, backgroundColor: '#f3f7fb', padding: 7, marginBottom: 9}}
              >
                <Image source={gif.source} style={styles.gifPickerImage} resizeMode="cover" />
                <Text style={{fontSize: 11, color: '#586575', marginTop: 4}}>{gif.label}</Text>
              </TouchableOpacity>)}
            </View>
            <TouchableOpacity style={styles.actionCancelButton} onPress={() => setGifTrayVisible(false)}><Text style={styles.actionCancelText}>Đóng</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={imageModalVisible} transparent animationType="slide" onRequestClose={() => setImageModalVisible(false)}>
        <View style={styles.imageModalOverlay}>
          <View style={styles.imageModalContainer}>
            <Text style={styles.imageModalTitle}>Gửi ảnh</Text>
            <View style={styles.imageModalActions}>
              <TouchableOpacity disabled={sending} onPress={takePhoto} style={styles.imageModalActionBtn}>
                <Icon name="camera" size={32} color="#2179ee" />
                <Text style={styles.imageModalActionText}>Chụp ảnh / Quay video</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={sending} onPress={pickImages} style={styles.imageModalActionBtn}>
                <Icon name="image" size={32} color="#2179ee" />
                <Text style={styles.imageModalActionText}>Chọn ảnh</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.imageModalSendBtn} disabled={sending || selectedFiles.length === 0} onPress={async () => {
              const sent = await handleSend(false);
              if (sent) setImageModalVisible(false);
            }}>
              <Text style={[styles.imageModalSendText, (sending || selectedFiles.length === 0) && {opacity: 0.5}]}>{sending ? 'Đang gửi…' : 'Gửi'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageModalCloseBtn} onPress={() => setImageModalVisible(false)}>
              <Text style={styles.imageModalCloseText}>Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={groupBoardVisible && isGroupChat} transparent animationType="slide" onRequestClose={() => setGroupBoardVisible(false)}>
        <View style={styles.groupPinOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={() => setGroupBoardVisible(false)} />
          <View style={styles.groupPinSheet}>
            <View style={styles.groupPinHeader}>
              <View style={{flex: 1}}>
                <Text style={styles.actionModalTitle}>Bảng tin nhóm</Text>
                <Text style={{color: '#788492', fontSize: 12}}>{groupPins.length} tin nhắn được ghim cho thành viên nhóm</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng bảng tin nhóm" onPress={() => setGroupBoardVisible(false)} hitSlop={8}>
                <Icon name="times" size={20} color="#697582" />
              </TouchableOpacity>
            </View>
            {groupPinsLoading ? <View style={styles.groupPinLoading}><ActivityIndicator color="#2179ee" /></View> : groupPins.length ? (
              <ScrollView style={styles.groupPinList} contentContainerStyle={{paddingBottom: 10}}>
                {groupPins.map((pin: any) => {
                  const id = String(pin._id);
                  const timestamp = Date.parse(String(pin.timestamp || ''));
                  const timeLabel = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '';
                  return <View key={id} style={styles.groupPinEntry}>
                    <TouchableOpacity accessibilityRole="button" style={styles.groupPinEntryBody} onPress={() => { void openPinnedMessage(pin); }}>
                      <View style={styles.groupPinEntryMeta}>
                        <Text numberOfLines={1} style={styles.groupPinEntrySender}>{pin.userId || 'Thành viên nhóm'}</Text>
                        {!!timeLabel && <Text style={styles.groupPinEntryTime}>{timeLabel}</Text>}
                      </View>
                      <Text numberOfLines={3} style={styles.groupPinEntryContent}>{groupPinPreview(pin)}</Text>
                      <Text style={{marginTop: 7, color: '#2179ee', fontSize: 12, fontWeight: '600'}}>Xem trong cuộc trò chuyện</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Bỏ ghim tin nhắn"
                      disabled={groupPinBusyId === id}
                      onPress={() => { void toggleGroupPin(pin); }}
                      style={styles.groupPinRemove}
                    >
                      {groupPinBusyId === id ? <ActivityIndicator size="small" color="#657383" /> : <Icon name="times" size={15} color="#657383" />}
                    </TouchableOpacity>
                  </View>;
                })}
              </ScrollView>
            ) : groupPinsError ? (
              <View style={styles.groupPinEmpty}>
                <Text style={{color: '#657383', fontSize: 13, textAlign: 'center'}}>{groupPinsError}</Text>
                <TouchableOpacity style={{marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: '#edf5ff'}} onPress={() => { void loadGroupPins(true); }}>
                  <Text style={{color: '#2179ee', fontSize: 13, fontWeight: '700'}}>Thử tải lại</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.groupPinEmpty}>
                <View style={styles.groupPinBannerIcon}><Icon name="thumb-tack" size={19} color="#2179ee" /></View>
                <Text style={{marginTop: 10, color: '#283746', fontSize: 14, fontWeight: '600'}}>Chưa có tin nhắn được ghim</Text>
                <Text style={{marginTop: 5, color: '#788492', fontSize: 12, textAlign: 'center'}}>Nhấn giữ một tin nhắn trong nhóm rồi chọn “Ghim lên bảng tin”.</Text>
              </View>
            )}
            <TouchableOpacity style={styles.actionCancelButton} onPress={() => setGroupBoardVisible(false)}><Text style={styles.actionCancelText}>Đóng</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={!!actionMessage} transparent animationType="fade" onRequestClose={closeMessageActions}>
        <View style={styles.actionModalOverlay}>
          <TouchableOpacity style={styles.actionModalBackdrop} activeOpacity={1} onPress={closeMessageActions} />
          <View style={styles.actionModalSheet}>
            <Text style={styles.actionModalTitle}>Thao tác tin nhắn</Text>
            <View style={styles.quickReactions}>
              {['❤️', '👍', '😂', '😮', '😢', '🙏'].map(emoji => (
                <TouchableOpacity key={emoji} style={styles.quickReactionButton} onPress={() => { void reactToSelectedMessage(emoji); }}>
                  <Text style={styles.quickReactionText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.messageActionRow} onPress={replyToSelectedMessage}><Text style={styles.messageActionText}>Trả lời</Text></TouchableOpacity>
            {actionMessage?.isMine && actionMessage?.type === 'text' && !actionMessage?.deletedAt && (
              <TouchableOpacity style={styles.messageActionRow} onPress={editSelectedMessage}><Text style={styles.messageActionText}>Chỉnh sửa</Text></TouchableOpacity>
            )}
            {isGroupChat && actionMessage?._id && actionMessage?.type !== 'call' && !actionMessage?.deletedAt && (
              <TouchableOpacity disabled={groupPinBusyId === String(actionMessage._id)} style={styles.messageActionRow} onPress={() => { void toggleGroupPin(actionMessage, true); }}>
                <Text style={styles.messageActionText}>{groupPins.some(item => String(item._id) === String(actionMessage._id)) ? 'Bỏ ghim khỏi bảng tin nhóm' : 'Ghim lên bảng tin nhóm'}</Text>
              </TouchableOpacity>
            )}
            {!actionMessage?.deletedAt && actionMessage?.type !== 'call' && actionMessage?.type !== 'poll' && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => { void openForwardPicker(); }}><Text style={styles.messageActionText}>Chuyển tiếp</Text></TouchableOpacity>
            )}
            {!actionMessage?.deletedAt && !!(actionMessage?.content || actionMessage?.fileMeta?.fileUrl) && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => { void shareSelectedMessage(); }}><Text style={styles.messageActionText}>Chia sẻ ra ứng dụng khác</Text></TouchableOpacity>
            )}
            {!actionMessage?.deletedAt && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => confirmDeleteSelectedMessage('me')}><Text style={styles.messageActionText}>Xóa ở phía tôi</Text></TouchableOpacity>
            )}
            {actionMessage?.isMine && !actionMessage?.deletedAt && (
              <TouchableOpacity style={styles.messageActionRow} onPress={() => confirmDeleteSelectedMessage('everyone')}><Text style={[styles.messageActionText, styles.destructiveAction]}>Thu hồi với mọi người</Text></TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionCancelButton} onPress={closeMessageActions}><Text style={styles.actionCancelText}>Đóng</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={forwardModalVisible} transparent animationType="slide" onRequestClose={() => { setForwardModalVisible(false); setForwardTarget(null); }}>
        <View style={styles.forwardModalOverlay}>
          <View style={styles.forwardModalSheet}>
            <View style={styles.forwardModalHeader}>
              <Text style={styles.actionModalTitle}>Chuyển tiếp đến</Text>
              <TouchableOpacity onPress={() => { setForwardModalVisible(false); setForwardTarget(null); }}><Icon name="times" size={20} color="#666" /></TouchableOpacity>
            </View>
            {loadingForwardRooms ? <ActivityIndicator style={{marginVertical: 28}} color="#2179ee" /> : (
              <ScrollView style={styles.forwardRoomList}>
                {forwardRooms.map(room => {
                  const roomName = room.name || room.user?.name || room.participants?.find((id: string) => String(id) !== String(auth?.user?.username)) || 'Cuộc trò chuyện';
                  return (
                    <TouchableOpacity key={String(room._id)} style={styles.forwardRoomRow} onPress={() => { void forwardToRoom(room); }}>
                      <View style={styles.forwardRoomAvatar}><Icon name={room.type === 'group' ? 'users' : 'user'} size={18} color="#2179ee" /></View>
                      <View style={{flex: 1}}>
                        <Text numberOfLines={1} style={styles.forwardRoomName}>{roomName}</Text>
                        {!!room.lastMessage?.content && <Text numberOfLines={1} style={styles.forwardRoomPreview}>{room.lastMessage.content}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {!forwardRooms.length && <Text style={styles.forwardEmpty}>Không có cuộc trò chuyện khác.</Text>}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <ImageViewing
        images={imageUrls}
        imageIndex={currentImageIndex}
        visible={imageViewerVisible}
        onRequestClose={() => setImageViewerVisible(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        backgroundColor="black"
      />
    </KeyboardAvoidingView>
  );
}
