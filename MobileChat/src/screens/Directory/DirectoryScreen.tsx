import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Image, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {useAuthStore} from '../../auth/store/login.store';
import {connectSocket} from '../../utils/socket';
import {LayTaoPhongChat} from '../../services/ChatAPI/api';
import {acceptFriend, deleteRequest, discoverUsers, DiscoverUser, FriendEntry, FriendsResponse, listFriends, removeFriend, requestFriend} from '../../services/FriendsAPI/api';

type Tab = 'friends' | 'requests' | 'discover';
type Row = {user: DiscoverUser; id: string | null};
const empty: FriendsResponse = {friends: [], incoming: [], outgoing: []};

export default function DirectoryScreen({route}: {route?: {params?: {openTab?: Tab; searchUsername?: string}}}) {
  const navigation = useNavigation<any>();
  const auth = useAuthStore(state => state.auth);
  const [tab, setTab] = useState<Tab>('friends');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<FriendsResponse>(empty);
  const [people, setPeople] = useState<DiscoverUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const refresh = useCallback(async (search: string) => {
    const id = ++sequence.current;
    setLoading(true); setError('');
    try {
      const [relations, discovered] = await Promise.all([listFriends(), discoverUsers(search)]);
      if (sequence.current !== id) return;
      setData(relations); setPeople(discovered);
    } catch {
      if (sequence.current === id) setError('Không thể tải danh bạ. Vui lòng thử lại.');
    } finally {
      if (sequence.current === id) setLoading(false);
    }
  }, []);
  const queryRef = useRef(query); queryRef.current = query;
  useFocusEffect(useCallback(() => { refresh(queryRef.current); }, [refresh]));
  useEffect(() => {
    const requestedTab = route?.params?.openTab;
    const searchUsername = route?.params?.searchUsername;
    if (searchUsername) {
      setTab('discover');
      setQuery(searchUsername);
    } else if (requestedTab) {
      setTab(requestedTab);
    }
    if (requestedTab || searchUsername) navigation.setParams({openTab: undefined, searchUsername: undefined});
  }, [navigation, route?.params?.openTab, route?.params?.searchUsername]);
  useEffect(() => {
    const timer = setTimeout(() => refresh(query), 350);
    return () => clearTimeout(timer);
  }, [query, refresh]);
  useEffect(() => {
    if (!auth?.token || !auth.user?.username) return;
    const s = connectSocket(auth.user.username, auth.token);
    const changed = () => refresh(queryRef.current);
    s.on('friendship:changed', changed);
    return () => { s.off('friendship:changed', changed); sequence.current++; };
  }, [auth?.token, auth?.user?.username, refresh]);

  const run = async (username: string, operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(username);
    try { await operation(); await refresh(queryRef.current); }
    catch (e: any) { Alert.alert('Không thể thực hiện', e?.response?.data?.error || 'Vui lòng kiểm tra kết nối và thử lại.'); }
    finally { setBusy(null); }
  };
  const openChat = (user: DiscoverUser) => run(user.username, async () => {
    const room = await LayTaoPhongChat(user.username);
    navigation.navigate('ChatList', {screen: 'ChatDetail', params: {chatId: room.data._id, chatName: user.name, chatType: 'one-to-one'}});
  });
  const asRow = (entry: FriendEntry, relation: DiscoverUser['relationship']): Row => ({id: entry.id, user: {...entry.user, relationship: relation, relationshipId: entry.id}});
  const filter = (row: Row) => `${row.user.name} ${row.user.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const rows: Row[] = tab === 'discover' ? people.map(user => ({user, id: user.relationshipId})) : tab === 'friends' ? data.friends.map(item => asRow(item, 'friends')).filter(filter) : [...data.incoming.map(item => asRow(item, 'incoming')), ...data.outgoing.map(item => asRow(item, 'outgoing'))].filter(filter);

  const button = (title: string, onPress: () => void, outlined = false, loading = false) => <TouchableOpacity accessibilityRole="button" disabled={!!busy} style={[styles.button, outlined && styles.outline, !!busy && styles.disabled]} onPress={onPress}>{loading ? <ActivityIndicator size="small" color={outlined ? '#59636e' : '#087bfa'} /> : <Text style={[styles.buttonText, outlined && styles.outlineText]}>{title}</Text>}</TouchableOpacity>;
  const renderItem = ({item}: {item: Row}) => {
    const {user, id} = item;
    return <View style={styles.row}>
      {user.avatar ? <Image source={{uri: user.avatar}} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.initial}>{(user.name || user.username).charAt(0).toUpperCase()}</Text></View>}
      <View style={styles.info}><Text style={styles.name} numberOfLines={1}>{user.name || user.username}</Text><Text style={styles.meta} numberOfLines={1}>{user.relationship === 'incoming' ? 'Đã gửi bạn lời mời' : user.relationship === 'outgoing' ? 'Đã gửi lời mời' : user.online ? 'Đang hoạt động' : user.username}</Text>{busy === user.username && <Text style={styles.pending}>Đang cập nhật...</Text>}</View>
      <View style={styles.rowActions}>
        {user.relationship === 'none' && button('Kết bạn', () => run(user.username, () => requestFriend(user.username)), false, busy === user.username)}
        {user.relationship === 'incoming' && id && <>{button('Từ chối', () => run(user.username, () => deleteRequest(id)), true, busy === user.username)}{button('Đồng ý', () => run(user.username, () => acceptFriend(id)))}</>}
        {user.relationship === 'outgoing' && id && button('Thu hồi', () => run(user.username, () => deleteRequest(id)), true, busy === user.username)}
        {user.relationship === 'friends' && <>{button('Nhắn tin', () => openChat(user), false, busy === user.username)}{id && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Hủy kết bạn với ${user.name}`} style={styles.more} onPress={() => Alert.alert('Hủy kết bạn', `Hủy kết bạn với ${user.name}?`, [{text: 'Không', style: 'cancel'}, {text: 'Hủy kết bạn', style: 'destructive', onPress: () => run(user.username, () => removeFriend(id))}])}><Icon name="ellipsis-v" size={19} color="#777" /></TouchableOpacity>}</>}
      </View>
    </View>;
  };

  const placeholder = tab === 'friends' ? 'Tìm trong danh sách bạn bè' : tab === 'requests' ? 'Tìm trong lời mời kết bạn' : 'Tìm tên hoặc tài khoản';
  const emptyState = () => {
    const title = tab === 'friends' ? 'Chưa có bạn bè' : tab === 'requests' ? 'Chưa có lời mời nào' : query.trim() ? 'Không tìm thấy người dùng' : 'Tìm bạn bè trên Zalo';
    const description = tab === 'friends' ? 'Kết nối với mọi người để trò chuyện dễ dàng hơn.' : tab === 'requests' ? 'Lời mời kết bạn mới sẽ xuất hiện tại đây.' : query.trim() ? 'Thử tìm bằng tên hoặc tài khoản khác.' : 'Nhập tên hoặc tài khoản để tìm người bạn muốn kết nối.';
    return <View style={styles.emptyState}><View style={styles.emptyIcon}><Icon name={tab === 'requests' ? 'envelope-o' : tab === 'discover' ? 'search' : 'users'} size={25} color="#1684f8" /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text>{tab === 'friends' && <TouchableOpacity accessibilityRole="button" style={styles.emptyCta} onPress={() => setTab('discover')}><Text style={styles.emptyCtaText}>Tìm bạn bè</Text></TouchableOpacity>}</View>;
  };
  return <View style={styles.page}>
    <View style={styles.header}><Text style={styles.headerTitle}>Danh bạ</Text><View style={styles.search}><Icon name="search" color="#8592a0" size={16} /><TextInput style={styles.input} placeholder={placeholder} value={query} onChangeText={setQuery} autoCapitalize="none" accessibilityLabel={placeholder} returnKeyType="search" />{!!query && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Xóa nội dung tìm kiếm" onPress={() => setQuery('')} hitSlop={8}><Icon name="times-circle" color="#89939e" size={17} /></TouchableOpacity>}</View></View>
    <View style={styles.tabs}>
      {([{key: 'friends', label: 'Bạn bè'}, {key: 'requests', label: 'Lời mời'}, {key: 'discover', label: 'Tìm bạn'}] as Array<{key: Tab; label: string}>).map(item => <TouchableOpacity key={item.key} accessibilityRole="tab" accessibilityState={{selected: tab === item.key}} onPress={() => {setTab(item.key); setQuery('');}} style={[styles.tab, tab === item.key && styles.activeTab]}><Text style={[styles.tabText, tab === item.key && styles.activeText]}>{item.label}</Text>{item.key === 'requests' && data.incoming.length > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{data.incoming.length > 99 ? '99+' : data.incoming.length}</Text></View>}</TouchableOpacity>)}
    </View>
    {!!error && <TouchableOpacity accessibilityRole="button" onPress={() => refresh(query)} style={styles.errorBox}><Icon name="exclamation-circle" size={17} color="#b33b36" /><Text style={styles.error}>{error}  Thử tải lại</Text></TouchableOpacity>}
    <FlatList data={rows} keyExtractor={item => item.user.username} renderItem={renderItem} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh(query)} />}
      ListHeaderComponent={tab === 'discover' ? <View style={styles.suggestionHeader}><Text style={styles.suggestionTitle}>{query.trim() ? 'Kết quả trên mọi máy chủ' : 'Gợi ý từ cùng máy chủ CouchDB'}</Text></View> : null}
      ListEmptyComponent={!loading && !error ? emptyState : null}
      ListFooterComponent={busy ? <View style={styles.footerBusy}><ActivityIndicator size="small" color="#1684f8" /><Text style={styles.footerBusyText}>Đang cập nhật danh bạ</Text></View> : null} />
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'}, header: {backgroundColor: '#087bfa', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12}, headerTitle: {color: '#fff', fontWeight: '600', fontSize: 21, marginBottom: 10},
  search: {height: 42, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12}, input: {flex: 1, paddingLeft: 9, color: '#1d2732'},
  tabs: {flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#dce0e5'}, tab: {flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 2, borderColor: 'transparent'}, activeTab: {borderColor: '#087bfa'}, tabText: {color: '#697582'}, activeText: {color: '#087bfa', fontWeight: '600'}, badge: {backgroundColor: '#f04444', minWidth: 18, height: 18, paddingHorizontal: 5, marginLeft: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center'}, badgeText: {color: '#fff', fontSize: 10, fontWeight: '700'},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e2e5e8'}, avatar: {height: 48, width: 48, borderRadius: 24}, avatarFallback: {backgroundColor: '#dceafa', alignItems: 'center', justifyContent: 'center'}, initial: {fontSize: 20, fontWeight: '600', color: '#257bd8'}, info: {flex: 1, marginLeft: 10}, name: {fontSize: 15, fontWeight: '600', color: '#17202a'}, meta: {fontSize: 12, color: '#89939e', marginTop: 4},
  rowActions: {flexDirection: 'row', alignItems: 'center', flexShrink: 0}, button: {minWidth: 62, minHeight: 34, backgroundColor: '#e8f3ff', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 18, marginLeft: 5, alignItems: 'center', justifyContent: 'center'}, outline: {backgroundColor: '#f0f1f3'}, buttonText: {fontSize: 12, color: '#087bfa', fontWeight: '600'}, outlineText: {color: '#59636e'}, disabled: {opacity: 0.5}, more: {paddingHorizontal: 10, paddingVertical: 8}, pending: {color: '#1684f8', fontSize: 11, marginTop: 3},
  suggestionHeader: {paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#f4f8fc'}, suggestionTitle: {fontSize: 12, color: '#607080', fontWeight: '600'},
  emptyState: {alignItems: 'center', paddingHorizontal: 34, paddingTop: 72}, emptyIcon: {height: 58, width: 58, borderRadius: 29, backgroundColor: '#eaf4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 16}, emptyTitle: {fontSize: 16, fontWeight: '700', color: '#263442'}, emptyDescription: {fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#89939e', marginTop: 7}, emptyCta: {marginTop: 18, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#087bfa'}, emptyCtaText: {fontSize: 13, fontWeight: '600', color: '#fff'}, errorBox: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff3f2', paddingHorizontal: 14, paddingVertical: 10}, error: {color: '#a32626', marginLeft: 8, fontSize: 13}, footerBusy: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14}, footerBusyText: {fontSize: 12, color: '#89939e', marginLeft: 8},
});
