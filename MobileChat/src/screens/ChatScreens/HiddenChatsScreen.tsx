import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import {useFocusEffect} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {MainTabsParamList} from '../../types/navigation';
import {cancelHiddenChats as cancelHiddenChatsApi, getHiddenChatPinStatus, getHiddenRooms, setHiddenChatPin, setRoomHidden, unlockHiddenChats} from '../../services/ChatAPI/api';
import constants from '../../contents/Api_URL';
import {setHiddenChatAccessToken} from '../../services/hiddenChatAccess';

type Props = StackScreenProps<MainTabsParamList, 'HiddenChats'>;
type HiddenRoom = {_id: string; type: string; name?: string; groupImage?: string | null; user?: {name?: string; avatar?: string}};
type UnlockPhase = 'loading' | 'create' | 'confirm' | 'unlock' | 'changeCurrent' | 'changeCreate' | 'changeConfirm' | 'cancelCurrent' | 'list';

const imageUri = (value?: string | null) => {
  if (!value) return '';
  if (/^(https?:|data:|file:|content:)/i.test(value)) return value;
  return `${constants.API_URLS.LAY_ANH}${value.replace(/^\/+/, '').replace(/^uploads\//i, '')}`;
};

export default function HiddenChatsScreen({navigation, route}: Props) {
  const [phase, setPhase] = useState<UnlockPhase>('loading');
  const [pin, setPin] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const [pendingCurrentPin, setPendingCurrentPin] = useState('');
  const [rooms, setRooms] = useState<HiddenRoom[]>([]);
  const [unlockToken, setUnlockToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    setPhase('loading');
    setPin('');
    setPendingPin('');
    setPendingCurrentPin('');
    setRooms([]);
    setUnlockToken('');
    setError('');
    getHiddenChatPinStatus().then(status => {
      if (active) setPhase(status.hasPin && !route.params?.setupOnly ? 'unlock' : status.hasPin ? 'unlock' : 'create');
    }).catch((e: any) => {
      if (active) {
        setError(e?.response?.data?.error || 'Không tải được trạng thái mã khóa. Hãy thử lại.');
        setPhase('unlock');
      }
    });
    return () => {
      active = false;
      setRooms([]);
      setUnlockToken('');
    };
  }, [route.params?.setupOnly]));

  const openHiddenChats = async (value: string) => {
    const grant = await unlockHiddenChats(value);
    setHiddenChatAccessToken(grant.accessToken, grant.expiresIn);
    setUnlockToken(grant.accessToken);
    const hidden = await getHiddenRooms(grant.accessToken);
    setRooms(Array.isArray(hidden) ? hidden : []);
    setPhase('list');
    setPin('');
    setPendingPin('');
    setError('');
  };

  const submitPin = async () => {
    if (busy) return;
    if (!/^\d{4}$/.test(pin)) {
      setError('Mã khóa gồm 4 chữ số.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (phase === 'create') {
        setPendingPin(pin);
        setPin('');
        setPhase('confirm');
        return;
      }
      if (phase === 'confirm') {
        if (pin !== pendingPin) {
          setPin('');
          setPendingPin('');
          setPhase('create');
          setError('Hai lần nhập chưa khớp. Hãy tạo lại mã.');
          return;
        }
        await setHiddenChatPin(pin);
        if (route.params?.setupOnly) {
          navigation.goBack();
          return;
        }
        await openHiddenChats(pin);
        return;
      }
      if (phase === 'cancelCurrent') {
        await cancelHiddenChatsApi(pin);
        navigation.goBack();
        return;
      }
      if (phase === 'changeCurrent') {
        await unlockHiddenChats(pin);
        setPendingCurrentPin(pin);
        setPin('');
        setPhase('changeCreate');
        return;
      }
      if (phase === 'changeCreate') {
        setPendingPin(pin);
        setPin('');
        setPhase('changeConfirm');
        return;
      }
      if (phase === 'changeConfirm') {
        if (pin !== pendingPin) {
          setPin('');
          setPendingPin('');
          setPhase('changeCreate');
          setError('Hai lần nhập chưa khớp. Hãy nhập mã mới lại.');
          return;
        }
        await setHiddenChatPin(pin, pendingCurrentPin);
        await openHiddenChats(pin);
        setPendingCurrentPin('');
        return;
      }
      await openHiddenChats(pin);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Không thể mở khóa. Hãy thử lại.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const unhideRoom = (room: HiddenRoom) => {
    const name = room.type === 'group' ? room.name : room.user?.name;
    Alert.alert('Bỏ ẩn cuộc trò chuyện?', `“${name || 'Cuộc trò chuyện'}” sẽ xuất hiện lại trong danh sách chat.`, [
      {text: 'Hủy', style: 'cancel'},
      {text: 'Bỏ ẩn', onPress: async () => {
        try {
          await setRoomHidden(room._id, false);
          setRooms(previous => previous.filter(item => String(item._id) !== String(room._id)));
        } catch (e: any) {
          Alert.alert('Không bỏ ẩn được', e?.response?.data?.error || e?.message || 'Vui lòng thử lại.');
        }
      }},
    ]);
  };

  const requestCancelHiddenChats = () => {
    Alert.alert('Tắt trò chuyện ẩn?', 'Các cuộc trò chuyện sẽ hiện lại trong danh sách và mã khóa sẽ bị xóa. Bạn cần nhập mã hiện tại để xác nhận.', [
      {text: 'Giữ lại', style: 'cancel'},
      {text: 'Tiếp tục', style: 'destructive', onPress: () => { setPhase('cancelCurrent'); setPin(''); setError(''); }},
    ]);
  };

  const renderRoom = ({item}: {item: HiddenRoom}) => {
    const name = item.type === 'group' ? item.name || 'Nhóm trò chuyện' : item.user?.name || 'Cuộc trò chuyện';
    const avatar = imageUri(item.type === 'group' ? item.groupImage : item.user?.avatar);
    return <View style={styles.row}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Mở ${name}`} style={styles.roomOpen} onPress={() => navigation.navigate('ChatDetail', {chatId: String(item._id), chatType: item.type, chatName: name, hiddenChatAccessToken: unlockToken})}>
        {avatar ? <Image source={{uri: avatar}} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Icon name={item.type === 'group' ? 'users' : 'user'} size={18} color="#6c8aa6" /></View>}
        <View style={styles.roomText}><Text style={styles.roomName} numberOfLines={1}>{name}</Text><Text style={styles.roomMeta}>Cuộc trò chuyện được bảo vệ</Text></View>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Bỏ ẩn ${name}`} style={styles.unhideButton} onPress={() => unhideRoom(item)}>
        <Icon name="unlock" size={16} color="#2179ee" />
        <Text style={styles.unhideText}>Bỏ ẩn</Text>
      </TouchableOpacity>
    </View>;
  };

  const isPinForm = phase === 'create' || phase === 'confirm' || phase === 'unlock' || phase === 'changeCurrent' || phase === 'changeCreate' || phase === 'changeConfirm' || phase === 'cancelCurrent';
  const title = phase === 'create' ? 'Tạo mã khóa' : phase === 'confirm' ? 'Xác nhận mã khóa' : phase === 'changeCurrent' || phase === 'cancelCurrent' ? 'Nhập mã hiện tại' : phase === 'changeCreate' ? 'Tạo mã mới' : phase === 'changeConfirm' ? 'Xác nhận mã mới' : 'Mở trò chuyện ẩn';
  const actionLabel = phase === 'create' ? 'Tiếp tục' : phase === 'confirm' ? 'Tạo mã và mở khóa' : phase === 'changeCurrent' ? 'Tiếp tục' : phase === 'changeCreate' ? 'Tiếp tục' : phase === 'changeConfirm' ? 'Đổi mã và mở khóa' : phase === 'cancelCurrent' ? 'Tắt và hiện lại chat' : 'Mở khóa';
  const pinDescription = phase === 'create' ? 'Tạo mã 4 chữ số để khóa danh sách trò chuyện ẩn.' : phase === 'confirm' ? 'Nhập lại mã vừa tạo để xác nhận.' : phase === 'changeCurrent' ? 'Xác nhận mã hiện tại để tiếp tục.' : phase === 'cancelCurrent' ? 'Nhập mã hiện tại để bỏ ẩn toàn bộ chat và xóa mã khóa.' : phase === 'changeCreate' ? 'Chọn mã 4 chữ số mới.' : phase === 'changeConfirm' ? 'Nhập lại mã mới để xác nhận.' : 'Nhập mã 4 chữ số để xem các cuộc trò chuyện đã ẩn.';

  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {phase === 'loading' ? <View style={styles.center}><ActivityIndicator size="large" color="#2179ee" /></View> : null}
    {isPinForm ? <View style={styles.lockCard}>
      <View style={styles.lockIcon}><Icon name="lock" size={26} color="#2179ee" /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{pinDescription}</Text>
      <TextInput accessibilityLabel="Mã khóa 4 chữ số" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 4))} style={styles.pinInput} keyboardType="number-pad" secureTextEntry maxLength={4} autoFocus />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, busy && styles.disabledButton]} disabled={busy} onPress={() => { void submitPin(); }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{actionLabel}</Text>}
      </TouchableOpacity>
      {(phase === 'changeCurrent' || phase === 'changeCreate' || phase === 'changeConfirm') && <TouchableOpacity accessibilityRole="button" style={styles.cancelButton} onPress={() => { setPhase('list'); setPin(''); setPendingPin(''); setPendingCurrentPin(''); setError(''); }}><Text style={styles.cancelText}>Hủy đổi mã</Text></TouchableOpacity>}
      {phase === 'unlock' && <Text style={styles.helper}>Mở khóa chỉ có hiệu lực trong thời gian ngắn. Danh sách sẽ tự khóa khi bạn rời màn hình.</Text>}
    </View> : null}
    {phase === 'list' ? <>
      <View style={styles.listIntro}><View style={styles.listHeaderRow}><View style={styles.listTitleWrap}><Text style={styles.title}>Trò chuyện ẩn</Text><Text style={styles.description}>Mã khóa sẽ hết hạn sau 10 phút.</Text></View><TouchableOpacity accessibilityRole="button" style={styles.changePinButton} onPress={() => { setPhase('changeCurrent'); setPin(''); setError(''); }}><Icon name="key" size={14} color="#2179ee" /><Text style={styles.changePinText}>Đổi mã</Text></TouchableOpacity></View><TouchableOpacity accessibilityRole="button" style={styles.disableHiddenButton} onPress={requestCancelHiddenChats}><Icon name="eye" size={14} color="#bd4651" /><Text style={styles.disableHiddenText}>Tắt trò chuyện ẩn và hiện lại tất cả</Text></TouchableOpacity></View>
      <FlatList data={rooms} keyExtractor={item => String(item._id)} renderItem={renderRoom} contentContainerStyle={rooms.length ? styles.list : styles.emptyList} ListEmptyComponent={<View style={styles.center}><Icon name="comments-o" size={34} color="#bdc7d0" /><Text style={styles.emptyTitle}>Chưa có cuộc trò chuyện ẩn</Text><Text style={styles.description}>Mở thông tin cuộc trò chuyện rồi chọn “Ẩn cuộc trò chuyện”.</Text></View>} />
    </> : null}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#f3f6f9'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28},
  lockCard: {margin: 18, marginTop: 44, padding: 24, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', elevation: 2},
  lockIcon: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#eaf3ff', alignItems: 'center', justifyContent: 'center', marginBottom: 14},
  title: {fontSize: 20, color: '#203044', fontWeight: '700', textAlign: 'center'},
  description: {fontSize: 14, lineHeight: 20, color: '#718092', marginTop: 8, textAlign: 'center'},
  pinInput: {height: 56, width: 190, borderBottomWidth: 2, borderColor: '#2179ee', marginTop: 12, marginBottom: 8, color: '#1c2c3e', fontSize: 28, letterSpacing: 15, textAlign: 'center'},
  error: {fontSize: 13, color: '#c33f4d', textAlign: 'center', marginTop: 8},
  primaryButton: {height: 48, minWidth: 190, borderRadius: 14, backgroundColor: '#1683ed', alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingHorizontal: 24},
  primaryButtonText: {color: '#fff', fontWeight: '700', fontSize: 15},
  disabledButton: {opacity: 0.6},
  helper: {fontSize: 12, color: '#8a97a5', lineHeight: 17, textAlign: 'center', marginTop: 16},
  cancelButton: {paddingVertical: 12, paddingHorizontal: 16, marginTop: 4},
  cancelText: {color: '#68798b', fontSize: 14, fontWeight: '600'},
  listIntro: {paddingHorizontal: 18, paddingVertical: 18, flexDirection: 'column', alignItems: 'stretch'},
  listHeaderRow: {width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  listTitleWrap: {flex: 1, minWidth: 0},
  changePinButton: {flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, backgroundColor: '#eaf3ff'},
  changePinText: {color: '#2179ee', fontSize: 12, fontWeight: '700', marginLeft: 7},
  disableHiddenButton: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 12, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff0f1'},
  disableHiddenText: {fontSize: 12, color: '#bd4651', fontWeight: '600', marginLeft: 7},
  list: {paddingHorizontal: 12, paddingBottom: 24},
  emptyList: {flexGrow: 1},
  emptyTitle: {fontWeight: '700', color: '#425468', fontSize: 16, marginTop: 14},
  row: {minHeight: 78, backgroundColor: '#fff', borderRadius: 16, marginVertical: 5, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'},
  roomOpen: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center'},
  avatar: {width: 48, height: 48, borderRadius: 24},
  avatarFallback: {backgroundColor: '#eaf1f7', alignItems: 'center', justifyContent: 'center'},
  roomText: {flex: 1, marginLeft: 12},
  roomName: {fontSize: 15, color: '#203044', fontWeight: '600'},
  roomMeta: {fontSize: 12, color: '#8996a4', marginTop: 4},
  unhideButton: {alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, minHeight: 48},
  unhideText: {fontSize: 11, color: '#2179ee', marginTop: 4, fontWeight: '600'},
});
