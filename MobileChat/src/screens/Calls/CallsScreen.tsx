import React, {useCallback, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {useAuthStore} from '../../auth/store/login.store';
import {CallHistoryEntry, getCallHistory} from '../../services/ChatAPI/api';
import {useStartCall} from '../../calls/CallProvider';
import {socket} from '../../utils/socket';
import {API_ORIGIN} from '../../contents/Api_URL';

type Filter = 'all' | 'missed';
function avatarUri(value?: string) {
  if (!value) return undefined;
  if (/^(https?:|data:|file:|content:)/i.test(value)) return value;
  if (/^(\/)?uploads\//i.test(value)) return `${API_ORIGIN}/Uploads/${value.replace(/^\/+/, '').replace(/^uploads\//i, '')}`;
  return `data:image/png;base64,${value}`;
}

function callTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'});
  return date.toDateString() === new Date().toDateString()
    ? `Hôm nay, ${time}`
    : date.toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit'}) + `, ${time}`;
}

function callDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export default function CallsScreen() {
  const navigation = useNavigation<any>();
  const startCall = useStartCall();
  const auth = useAuthStore(state => state.auth);
  const [calls, setCalls] = useState<CallHistoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const username = String(auth?.user?.username || '');

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setCalls(await getCallHistory());
    } catch {
      setError('Không thể tải lịch sử cuộc gọi. Chạm để thử lại.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    const activeSocket = socket;
    const callMessage = (message: any) => {
      if (message?.type === 'call') void load(true);
    };
    activeSocket?.on('receiveMessage', callMessage);
    return () => activeSocket?.off('receiveMessage', callMessage);
  }, [load]));

  const visibleCalls = useMemo(() => filter === 'all'
    ? calls
    : calls.filter(item => ['missed', 'no_answer'].includes(item.status) && item.caller !== username),
  [calls, filter, username]);

  const openChat = (item: CallHistoryEntry) => navigation.navigate('ChatList', {
    screen: 'ChatDetail',
    params: {chatId: item.roomId, chatName: item.title, chatType: item.roomType},
  });

  const statusLabel = (item: CallHistoryEntry) => {
    if (item.status === 'no_answer' || item.status === 'missed') return item.caller === username ? 'Không có phản hồi' : 'Cuộc gọi nhỡ';
    if (item.status === 'declined') return item.caller === username ? 'Đã bị từ chối' : 'Bạn đã từ chối';
    return item.caller === username ? 'Cuộc gọi đi' : 'Cuộc gọi đến';
  };

  const renderCall = ({item}: {item: CallHistoryEntry}) => {
    const missed = ['missed', 'no_answer'].includes(item.status) && item.caller !== username;
    const image = avatarUri(item.avatar);
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Mở cuộc trò chuyện với ${item.title}`} activeOpacity={0.8} onPress={() => openChat(item)} style={styles.row}>
      <View style={styles.avatarWrap}>
        {image ? <Image source={{uri: image}} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarLetter}>{item.title.trim().slice(0, 1).toUpperCase()}</Text></View>}
        {item.roomType === 'group' && <View style={styles.groupBadge}><Icon name="users" size={9} color="#fff" /></View>}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.name}>{item.title}</Text>
        <View style={styles.subline}>
          <Icon name={item.caller === username ? 'arrow-up' : 'arrow-down'} size={11} color={missed ? '#e34848' : '#7a8794'} />
          <Text numberOfLines={1} style={[styles.status, missed && styles.missed]}>{statusLabel(item)} · {callTime(item.startedAt)}{item.duration > 0 ? ` · ${callDuration(item.duration)}` : ''}</Text>
        </View>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Gọi ${item.title} bằng ${item.callType === 'video' ? 'video' : 'thoại'}`} onPress={() => startCall(item.roomId, item.title, item.callType === 'video', item.roomType)} style={styles.callButton}>
        <Icon name={item.callType === 'video' ? 'video-camera' : 'phone'} size={19} color="#1683ed" />
      </TouchableOpacity>
    </TouchableOpacity>;
  };

  return <View style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Cuộc gọi</Text>
      <Text style={styles.headerSubtitle}>Gọi thoại và video với bạn bè, nhóm của bạn</Text>
    </View>
    <View style={styles.filters}>
      {([{key: 'all', label: 'Tất cả'}, {key: 'missed', label: 'Cuộc gọi nhỡ'}] as Array<{key: Filter; label: string}>).map(option => <TouchableOpacity key={option.key} accessibilityRole="tab" accessibilityState={{selected: filter === option.key}} onPress={() => setFilter(option.key)} style={[styles.filter, filter === option.key && styles.filterActive]}>
        <Text style={[styles.filterText, filter === option.key && styles.filterTextActive]}>{option.label}</Text>
      </TouchableOpacity>)}
    </View>
    {!!error && <TouchableOpacity accessibilityRole="button" onPress={() => { void load(); }} style={styles.error}><Icon name="exclamation-circle" size={16} color="#ba3434" /><Text style={styles.errorText}>{error}</Text></TouchableOpacity>}
    {loading ? <View style={styles.loading}><ActivityIndicator color="#1683ed" /><Text style={styles.loadingText}>Đang tải cuộc gọi…</Text></View> : <FlatList
      data={visibleCalls}
      keyExtractor={item => item.id}
      renderItem={renderCall}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(true); }} />}
      ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><Icon name={filter === 'missed' ? 'phone' : 'phone-square'} size={27} color="#1683ed" /></View><Text style={styles.emptyTitle}>{filter === 'missed' ? 'Không có cuộc gọi nhỡ' : 'Chưa có cuộc gọi'}</Text><Text style={styles.emptyText}>Lịch sử cuộc gọi của bạn sẽ xuất hiện tại đây.</Text></View>}
    />}
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'},
  header: {backgroundColor: '#087bfa', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 17},
  headerTitle: {fontSize: 22, fontWeight: '700', color: '#fff'},
  headerSubtitle: {fontSize: 12, color: '#e3f0ff', marginTop: 5},
  filters: {height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8ef'},
  filter: {paddingHorizontal: 15, paddingVertical: 8, marginRight: 8, borderRadius: 18, backgroundColor: '#f1f4f7'},
  filterActive: {backgroundColor: '#e7f2ff'},
  filterText: {fontSize: 12, fontWeight: '600', color: '#738090'},
  filterTextActive: {color: '#087bfa'},
  row: {minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#edf0f3'},
  avatarWrap: {position: 'relative'},
  avatar: {width: 48, height: 48, borderRadius: 24},
  avatarFallback: {backgroundColor: '#e5f0fb', alignItems: 'center', justifyContent: 'center'},
  avatarLetter: {fontSize: 19, fontWeight: '700', color: '#2476c5'},
  groupBadge: {position: 'absolute', right: -2, bottom: -1, width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#fff', backgroundColor: '#438bd1', alignItems: 'center', justifyContent: 'center'},
  info: {flex: 1, minWidth: 0, marginLeft: 12},
  name: {fontSize: 15, fontWeight: '600', color: '#202a35'},
  subline: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  status: {flexShrink: 1, marginLeft: 6, fontSize: 12, color: '#7a8794'},
  missed: {color: '#d83d3d'},
  callButton: {width: 42, height: 42, borderRadius: 21, backgroundColor: '#edf6ff', alignItems: 'center', justifyContent: 'center', marginLeft: 8},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  loadingText: {fontSize: 13, color: '#8793a0', marginTop: 8},
  error: {flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff3f2'},
  errorText: {marginLeft: 8, color: '#a52d2d', fontSize: 12},
  empty: {alignItems: 'center', paddingHorizontal: 32, paddingTop: 86},
  emptyIcon: {width: 60, height: 60, borderRadius: 30, backgroundColor: '#eaf4ff', alignItems: 'center', justifyContent: 'center'},
  emptyTitle: {marginTop: 17, fontSize: 16, fontWeight: '700', color: '#273443'},
  emptyText: {marginTop: 7, maxWidth: 260, textAlign: 'center', fontSize: 13, lineHeight: 19, color: '#89939e'},
});
