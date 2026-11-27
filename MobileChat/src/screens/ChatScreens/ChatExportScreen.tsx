import React, {useState} from 'react';
import {ActivityIndicator, Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/FontAwesome';
import {MainTabsParamList} from '../../types/navigation';
import {ExportableChatMessage} from '../../services/ChatAPI/api';
import {EXPORT_HISTORY_MAX_PAGES, EXPORT_HISTORY_PAGE_SIZE, fetchExportHistory} from '../../services/ChatAPI/exportHistory';
import {useAuthStore} from '../../auth/store/login.store';

type Props = StackScreenProps<MainTabsParamList, 'ChatExport'>;
const formatCallDuration = (seconds?: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(Number(seconds))) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

const formatBody = (message: ExportableChatMessage) => {
  if (message.deletedAt) return 'Tin nhắn đã được thu hồi';
  const fileName = message.fileMeta?.fileName;
  switch (message.type) {
    case 'image': {
      const count = message.fileMeta?.images?.length || 1;
      const names = message.fileMeta?.images?.map(item => item.fileName).filter(Boolean) || (fileName ? [fileName] : []);
      return `[Ảnh${count > 1 ? ` x${count}` : ''}${names.length ? `: ${names.join(', ')}` : ''}]`;
    }
    case 'video': return `[Video${fileName ? `: ${fileName}` : ''}]`;
    case 'audio': return `[Tin nhắn thoại${fileName ? `: ${fileName}` : ''}]`;
    case 'file': return `[Tệp${fileName ? `: ${fileName}` : ''}]`;
    case 'sticker': return `[Sticker] ${message.content || ''}`.trim();
    case 'gif': return `[GIF${message.content ? `: ${message.content}` : ''}]`;
    case 'location': {
      const latitude = Number(message.location?.latitude);
      const longitude = Number(message.location?.longitude);
      return Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `[Vị trí] ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — https://maps.google.com/?q=${latitude},${longitude}`
        : '[Vị trí đã chia sẻ]';
    }
    case 'call': {
      const callType = message.call?.callType === 'video' ? 'video' : 'thoại';
      const statusLabels: Record<string, string> = {
        missed: 'nhỡ', no_answer: 'không được trả lời', declined: 'bị từ chối',
        answered: 'đã kết nối', ended: 'đã kết thúc', pending: 'đang gọi',
      };
      const status = statusLabels[String(message.call?.status || '')] || 'đã kết thúc';
      const duration = Number(message.call?.duration || 0);
      return `[Cuộc gọi ${callType}: ${status}${duration > 0 ? `, ${formatCallDuration(duration)}` : ''}]`;
    }
    default: return message.content?.trim() || `[${message.type || 'Tin nhắn'}]`;
  }
};

const formatMessage = (message: ExportableChatMessage, username?: string) => {
  const time = new Date(message.timestamp);
  const stamp = Number.isNaN(time.getTime()) ? message.timestamp : time.toLocaleString();
  const sender = message.userId === username ? 'Bạn' : (message.userId || 'Không rõ người gửi');
  const body = formatBody(message);
  const flags = [message.editedAt ? '(đã chỉnh sửa)' : '', message.forwardedFrom ? `(chuyển tiếp từ ${message.forwardedFrom.userId || 'người khác'})` : ''].filter(Boolean).join(' ');
  const reactions = Array.isArray(message.reactions) && message.reactions.length
    ? `\n    Cảm xúc: ${Object.entries(message.reactions.reduce((counts: Record<string, number>, reaction) => {
        counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
        return counts;
      }, {})).map(([emoji, count]) => `${emoji} × ${count}`).join(' ')}`
    : '';
  const reply = message.replyTo
    ? `\n    Trả lời ${message.replyTo.userId || 'tin nhắn'}: ${message.replyTo.content || message.replyTo.fileName || `[${message.replyTo.type || 'tin nhắn'}]`}`
    : '';
  return `[${stamp}] ${sender}: ${body}${flags ? ` ${flags}` : ''}${reply}${reactions}`;
};

export default function ChatExportScreen({route}: Props) {
  const username = useAuthStore(state => state.auth?.user?.username);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState('');

  const exportHistory = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setCount(null);
    setLimited(false);
    try {
      const {messages, limited} = await fetchExportHistory(route.params.chatId);
      if (!messages.length) {
        setCount(0);
        return;
      }
      // Sort all fetched pages together because the API reverses each page independently.
      const transcript = [
        `${route.params.chatName || 'Cuộc trò chuyện'} — lịch sử tin nhắn`,
        `Đã xuất ${messages.length} tin nhắn.`,
        '',
        ...messages
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || a._id.localeCompare(b._id))
          .map(message => formatMessage(message, username)),
        ...(limited ? ['', `Đã đạt giới hạn ${EXPORT_HISTORY_MAX_PAGES * 100} tin nhắn. Một số tin nhắn cũ hơn không được đưa vào bản xuất.`] : []),
      ].join('\n');
      setCount(messages.length);
      setLimited(limited);
      await Share.share({title: 'Lịch sử cuộc trò chuyện', message: transcript});
    } catch (reason: any) {
      setError(reason?.response?.data?.error || reason?.message || 'Không thể tải lịch sử. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return <View style={styles.page}>
    <View style={styles.icon}><Icon name="download" size={28} color="#2179ee" /></View>
    <Text style={styles.title}>Xuất lịch sử trò chuyện</Text>
    <Text style={styles.description}>Tạo bản văn bản gồm tối đa {(EXPORT_HISTORY_MAX_PAGES * EXPORT_HISTORY_PAGE_SIZE).toLocaleString()} tin nhắn gần nhất. Bản xuất ghi chú tệp, GIF, cuộc gọi và tọa độ vị trí; không đính kèm nội dung media.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {count !== null && !error && <Text style={styles.status}>{count ? `Đã chuẩn bị ${count.toLocaleString()} tin nhắn.` : 'Cuộc trò chuyện chưa có tin nhắn.'}</Text>}
    {limited && <Text style={styles.note}>Đã đạt giới hạn xuất; có thể còn tin nhắn cũ hơn trong lịch sử.</Text>}
    <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={exportHistory} style={[styles.button, loading && styles.disabled]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Tạo bản xuất</Text>}
    </TouchableOpacity>
    <Text style={styles.privacy}>Bản xuất được tạo trên thiết bị và mở bằng bảng chia sẻ của hệ thống.</Text>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#f6f8fb', padding: 24, alignItems: 'center', justifyContent: 'center'},
  icon: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#e7f1ff', alignItems: 'center', justifyContent: 'center', marginBottom: 18},
  title: {fontSize: 20, fontWeight: '700', color: '#202833', textAlign: 'center'},
  description: {fontSize: 15, lineHeight: 22, color: '#657180', textAlign: 'center', marginTop: 10, marginBottom: 20},
  status: {fontSize: 14, color: '#33734c', textAlign: 'center', marginBottom: 10},
  error: {fontSize: 14, color: '#b42318', textAlign: 'center', marginBottom: 12},
  note: {fontSize: 13, lineHeight: 19, color: '#8a5b00', textAlign: 'center', marginBottom: 12},
  button: {minWidth: 180, minHeight: 48, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#2179ee', alignItems: 'center', justifyContent: 'center'},
  disabled: {opacity: 0.65},
  buttonText: {fontSize: 15, fontWeight: '700', color: '#fff'},
  privacy: {fontSize: 12, lineHeight: 18, color: '#8994a0', textAlign: 'center', marginTop: 16},
});
