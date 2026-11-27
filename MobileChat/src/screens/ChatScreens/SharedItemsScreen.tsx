import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Image, Linking, Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import ImageViewing from 'react-native-image-viewing';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/FontAwesome';
import {getSharedItems, SharedMessage} from '../../services/ChatAPI/api';
import {MainTabsParamList} from '../../types/navigation';
import {API_ORIGIN} from '../../contents/Api_URL';
import {useAuthStore} from '../../auth/store/login.store';
import {cacheMessageMedia, getLocalMediaUri, type MediaMessage} from '../../services/ChatAPI/localMedia';

type Props = StackScreenProps<MainTabsParamList, 'SharedItems'>;
type Kind = 'media' | 'file' | 'link';
const tabs: Array<{key: Kind; label: string}> = [{key: 'media', label: 'Ảnh/Video'}, {key: 'file', label: 'File'}, {key: 'link', label: 'Link'}];
const absoluteUrl = (url: string, accountId: string, localUri?: string) => {
  const cached = localUri || getLocalMediaUri(accountId, url);
  if (cached) return cached;
  return /^https?:\/\//i.test(url) ? url : `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
};
const extractLinks = (content = '') => (content.match(/https?:\/\/[^\s<>]+/gi) || []).map(link => link.replace(/[.,!?;:]+$/, ''));

export default function SharedItemsScreen({route}: Props) {
  const auth = useAuthStore(state => state.auth);
  const [kind, setKind] = useState<Kind>('media');
  const [items, setItems] = useState<SharedMessage[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const request = useRef(0);

  const load = async (selected: Kind, targetPage: number, id: number) => {
    setLoading(true); setError('');
    try {
      const data = await getSharedItems(route.params.chatId, selected, targetPage);
      if (request.current !== id) return;
      setItems(previous => targetPage === 1 ? data.messages : [...previous, ...data.messages.filter(item => !previous.some(old => old._id === item._id))]);
      const accountId = String(auth?.user?.username || '');
      if (accountId && auth?.token) {
        void Promise.all(data.messages.map(message => cacheMessageMedia(accountId, message as MediaMessage, auth.token)))
          .then(cached => {
            if (request.current !== id) return;
            const byId = new Map<string, MediaMessage>(cached.map(message => [String(message._id || ''), message] as const));
            setItems(previous => previous.map(message => {
              const replacement = byId.get(message._id);
              return replacement?.fileMeta ? {...message, fileMeta: replacement.fileMeta} : message;
            }));
          })
          .catch(() => undefined);
      }
      setPage(data.page); setHasMore(data.hasMore);
    } catch {
      if (request.current === id) setError('Không thể tải nội dung. Vui lòng thử lại.');
    } finally {
      if (request.current === id) setLoading(false);
    }
  };
  useEffect(() => {
    const id = ++request.current;
    setItems([]); setPage(0); setHasMore(false);
    load(kind, 1, id);
    return () => { request.current++; };
  }, [kind, route.params.chatId]);

  const openUrl = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Không thể mở nội dung', 'Vui lòng thử lại hoặc kiểm tra ứng dụng hỗ trợ tệp này.'));
  const images = items.filter(item => item.fileMeta?.fileUrl && item.fileMeta?.fileType?.toLowerCase().startsWith('image/'))
    .map(item => ({uri: absoluteUrl(item.fileMeta!.fileUrl!, String(auth?.user?.username || ''), item.fileMeta?.localUri)}));
  const renderItem = ({item}: {item: SharedMessage}) => {
    const url = item.fileMeta?.fileUrl ? absoluteUrl(item.fileMeta.fileUrl, String(auth?.user?.username || ''), item.fileMeta.localUri) : '';
    const isVideo = item.fileMeta?.fileType?.toLowerCase().startsWith('video/');
    if (kind === 'media') return <TouchableOpacity style={styles.tile} onPress={() => {
      if (!url) return;
      if (isVideo) setVideoUrl(url);
      else {
        const index = images.findIndex(image => image.uri === url);
        if (index >= 0) setImageIndex(index);
      }
    }}>
      {isVideo ? <View style={styles.videoPlaceholder}><Icon name="video-camera" size={28} color="#60788d" /><Icon name="play-circle" size={32} color="#fff" style={styles.playIcon} /></View> : <Image source={{uri: url}} style={styles.thumbnail} />}
    </TouchableOpacity>;
    if (kind === 'file') return <TouchableOpacity style={styles.row} onPress={() => openUrl(url)}>
      <View style={styles.fileIcon}><Icon name="file-o" size={24} color="#2183ec" /></View>
      <View style={styles.rowContent}><Text style={styles.title} numberOfLines={2}>{item.fileMeta?.fileName || 'Tệp đính kèm'}</Text><Text style={styles.meta}>{item.userId} · {new Date(item.timestamp).toLocaleDateString()}</Text></View>
      <Icon name="angle-right" size={22} color="#9aa4ae" />
    </TouchableOpacity>;
    return <View style={styles.row}>
      <View style={styles.fileIcon}><Icon name="link" size={22} color="#2183ec" /></View>
      <View style={styles.rowContent}>{extractLinks(item.content).map((link, index) => <Text key={`${link}-${index}`} style={styles.link} onPress={() => openUrl(link)}>{link}</Text>)}<Text style={styles.meta}>{item.userId} · {new Date(item.timestamp).toLocaleDateString()}</Text></View>
    </View>;
  };

  return <View style={styles.page}>
    <View style={styles.tabs}>{tabs.map(tab => <TouchableOpacity key={tab.key} style={[styles.tab, kind === tab.key && styles.activeTab]} onPress={() => setKind(tab.key)}><Text style={[styles.tabText, kind === tab.key && styles.activeText]}>{tab.label}</Text></TouchableOpacity>)}</View>
    {!!error && <TouchableOpacity onPress={() => load(kind, page || 1, request.current)}><Text style={styles.error}>{error} Nhấn để thử lại.</Text></TouchableOpacity>}
    <FlatList key={kind} data={items} keyExtractor={item => item._id} numColumns={kind === 'media' ? 3 : 1} renderItem={renderItem}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>Chưa có nội dung được chia sẻ</Text> : null}
      ListFooterComponent={loading ? <ActivityIndicator style={styles.footer} /> : hasMore ? <TouchableOpacity style={styles.footer} onPress={() => load(kind, page + 1, request.current)}><Text style={styles.link}>Xem thêm</Text></TouchableOpacity> : null} />
    <ImageViewing images={images} imageIndex={imageIndex ?? 0} visible={imageIndex !== null} onRequestClose={() => setImageIndex(null)} swipeToCloseEnabled doubleTapToZoomEnabled />
    <Modal visible={!!videoUrl} onRequestClose={() => setVideoUrl(null)} animationType="fade">
      <View style={styles.videoModal}><TouchableOpacity accessibilityLabel="Đóng video" style={styles.close} onPress={() => setVideoUrl(null)}><Icon name="times" size={26} color="#fff" /></TouchableOpacity>{videoUrl && <Video source={{uri: videoUrl}} style={styles.player} controls resizeMode="contain" />}</View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'},
  tabs: {flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd'},
  tab: {flex: 1, alignItems: 'center', padding: 14, borderBottomWidth: 2, borderColor: 'transparent'},
  activeTab: {borderColor: '#1683f7'}, tabText: {color: '#69737f'}, activeText: {color: '#1683f7', fontWeight: '600'},
  tile: {width: '33.333%', aspectRatio: 1, padding: 1}, thumbnail: {width: '100%', height: '100%', backgroundColor: '#eef1f4'},
  videoPlaceholder: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dce6ef'}, playIcon: {position: 'absolute'},
  row: {flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd'},
  fileIcon: {height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#eaf4ff', marginRight: 12},
  rowContent: {flex: 1}, title: {fontSize: 15, color: '#20262d'}, meta: {fontSize: 12, color: '#929ba4', marginTop: 5}, link: {color: '#1676da', fontSize: 14},
  empty: {padding: 28, textAlign: 'center', color: '#8a939c'}, error: {padding: 14, color: '#a12a2a'}, footer: {padding: 18, alignItems: 'center'},
  videoModal: {flex: 1, backgroundColor: '#000'}, close: {padding: 20, alignSelf: 'flex-end'}, player: {flex: 1, width: '100%'},
});
