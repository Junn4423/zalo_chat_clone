import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/FontAwesome';
import {MainTabsParamList} from '../../types/navigation';
import {getMessageContext, searchRoomMessages} from '../../services/ChatAPI/api';
import {useAuthStore} from '../../auth/store/login.store';
import {API_ORIGIN} from '../../contents/Api_URL';
import {getLocalMediaUri} from '../../services/ChatAPI/localMedia';

type Result = Awaited<ReturnType<typeof searchRoomMessages>>['messages'][number];
type Props = StackScreenProps<MainTabsParamList, 'SearchMessages'>;

export default function SearchMessagesScreen({route}: Props) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<Result[]>([]);
  const [context, setContext] = useState<Result[]>([]);
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchId = useRef(0);
  const list = useRef<FlatList<Result>>(null);
  const username = useAuthStore(state => state.auth?.user?.username);
  const targetId = matches[index]?._id;

  useEffect(() => {
    let active = true;
    if (!targetId) { setContext([]); return; }
    setContext([]);
    getMessageContext(route.params.chatId, targetId).then(data => {
      if (active) setContext(data.messages);
    }).catch(() => { if (active) setError('Không thể tải nội dung cuộc trò chuyện.'); });
    return () => { active = false; };
  }, [route.params.chatId, targetId]);

  const search = async () => {
    const query = input.trim();
    const id = ++searchId.current;
    setTerm(query); setMatches([]); setContext([]); setIndex(0); setPage(0); setTotal(0); setHasMore(false); setError('');
    if (!query) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await searchRoomMessages(route.params.chatId, query);
      if (id !== searchId.current) return;
      setMatches(data.messages); setPage(data.page); setTotal(data.total); setHasMore(data.hasMore);
    } catch {
      if (id === searchId.current) setError('Không thể tìm tin nhắn. Vui lòng thử lại.');
    } finally {
      if (id === searchId.current) setLoading(false);
    }
  };

  const next = async () => {
    if (index + 1 < matches.length) { setIndex(index + 1); return; }
    if (!hasMore || loading) return;
    const id = searchId.current;
    setLoading(true); setError('');
    try {
      const data = await searchRoomMessages(route.params.chatId, term, page + 1);
      if (id !== searchId.current) return;
      const added = data.messages.filter(item => !matches.some(old => old._id === item._id));
      setMatches([...matches, ...added]); setPage(data.page); setHasMore(data.hasMore); setTotal(data.total);
      if (added.length) setIndex(matches.length);
    } catch {
      if (id === searchId.current) setError('Không thể tải thêm kết quả. Vui lòng thử lại.');
    } finally {
      if (id === searchId.current) setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="Từ khóa tìm tin nhắn" style={styles.input} value={input} onChangeText={setInput} maxLength={100} placeholder="Tìm trong cuộc trò chuyện" returnKeyType="search" onSubmitEditing={search} />
        <TouchableOpacity onPress={search} style={styles.searchButton}><Text style={styles.searchButtonText}>Tìm</Text></TouchableOpacity>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        ref={list}
        data={context}
        keyExtractor={item => item._id}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { const n = context.findIndex(item => item._id === targetId); if (n >= 0) list.current?.scrollToIndex({index: n, animated: false, viewPosition: 0.5}); }}
        onScrollToIndexFailed={info => list.current?.scrollToOffset({offset: info.averageItemLength * info.index, animated: false})}
        renderItem={({item}) => {
          const mine = item.userId === username;
          return <View style={[styles.bubble, mine ? styles.mine : styles.other, item._id === targetId && styles.selected]}>
            {!mine && <Text style={styles.sender}>{item.userId}</Text>}
            {!!item.content && <Text style={styles.messageText}>{item.content}</Text>}
            {!!item.fileMeta?.fileName && <Text style={styles.file} onPress={() => {
              const url = item.fileMeta?.fileUrl;
              if (url) {
                const accountId = String(username || '');
                const target = getLocalMediaUri(accountId, url)
                  || (url.startsWith('http') ? url : `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`);
                Linking.openURL(target).catch(() => setError('Không thể mở tệp.'));
              }
            }}>{item.fileMeta.fileName}</Text>}
            <Text style={styles.time}>{new Date(item.timestamp).toLocaleString()}</Text>
          </View>;
        }}
        ListEmptyComponent={!loading && term && !matches.length && !error ? <Text style={styles.empty}>Không tìm thấy tin nhắn.</Text> : null}
      />
      {!!term && <View style={styles.navigation}>
        <Text style={styles.count}>{matches.length ? `Kết quả ${index + 1}/${total}` : 'Không có kết quả'}</Text>
        {loading && <ActivityIndicator />}
        <TouchableOpacity accessibilityLabel="Kết quả mới hơn" disabled={index === 0 || loading} onPress={() => setIndex(index - 1)} style={styles.arrow}><Icon name="angle-up" size={27} color={index === 0 ? '#bbb' : '#333'} /></TouchableOpacity>
        <TouchableOpacity accessibilityLabel="Kết quả cũ hơn" disabled={loading || index + 1 >= matches.length && !hasMore} onPress={next} style={styles.arrow}><Icon name="angle-down" size={27} color={index + 1 >= matches.length && !hasMore ? '#bbb' : '#333'} /></TouchableOpacity>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#e8eef3'},
  searchRow: {flexDirection: 'row', padding: 10, backgroundColor: '#087bfa', alignItems: 'center'},
  input: {flex: 1, backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 12, color: '#222'},
  searchButton: {paddingHorizontal: 14, paddingVertical: 10},
  searchButtonText: {color: '#fff', fontWeight: '600'},
  messages: {padding: 12, flexGrow: 1},
  bubble: {maxWidth: '82%', borderRadius: 10, padding: 10, marginVertical: 4},
  mine: {alignSelf: 'flex-end', backgroundColor: '#d6eaff'},
  other: {alignSelf: 'flex-start', backgroundColor: '#fff'},
  selected: {borderWidth: 2, borderColor: '#ffca28'},
  sender: {fontSize: 12, color: '#2179ee', marginBottom: 4},
  messageText: {fontSize: 15, color: '#222'},
  file: {color: '#2179ee', marginTop: 4},
  time: {fontSize: 10, color: '#777', marginTop: 4},
  error: {color: '#a32626', padding: 12, backgroundColor: '#fff'},
  empty: {textAlign: 'center', color: '#777', padding: 24},
  navigation: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12},
  count: {flex: 1, color: '#777'},
  arrow: {paddingHorizontal: 14, paddingVertical: 8},
});
