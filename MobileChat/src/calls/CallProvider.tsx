import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Alert, Modal, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView} from 'react-native-webrtc';
import Icon from 'react-native-vector-icons/FontAwesome';
import {useAuthStore} from '../auth/store/login.store';
import {connectSocket} from '../utils/socket';
import {getHiddenChatAccessToken} from '../services/hiddenChatAccess';

type Phase = 'incoming' | 'ringing' | 'connecting' | 'connected';
type Participant = {id: string; name: string};
type Call = {id: string; roomId: string; peer: string; video: boolean; group: boolean; joined: boolean; phase: Phase; participants: Participant[]};
type Signal = {
  kind: 'invite' | 'accept' | 'decline' | 'busy' | 'end' | 'member-left' | 'offer' | 'answer' | 'candidate';
  callId: string; video?: boolean; group?: boolean; sdp?: any; candidate?: any; to?: string; participants?: Participant[];
};
type SignalEvent = {roomId: string; from: string; signal: Signal};
type PeerState = {connection: any; remoteReady: boolean; pendingCandidates: any[]};
type RemoteStream = {id: string; stream: MediaStream};
type StartCall = (roomId: string, peer: string, video: boolean, roomType: string) => void;
const CallContext = createContext<StartCall>(() => {});
export const useStartCall = () => useContext(CallContext);
const iceServers = [{urls: 'stun:stun.l.google.com:19302'}];

const normalizeParticipants = (items?: Participant[]) => {
  if (!Array.isArray(items)) return [];
  const unique = new Map<string, Participant>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id) unique.set(item.id, {id: item.id, name: item.name || 'Thành viên'});
  }
  return Array.from(unique.values());
};

export function CallProvider({children}: {children: React.ReactNode}) {
  const auth = useAuthStore(state => state.auth);
  const [call, setCall] = useState<Call | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const current = useRef<Call | null>(null);
  const peerConnections = useRef<Map<string, PeerState>>(new Map());
  const localRef = useRef<MediaStream | null>(null);
  const localPromise = useRef<Promise<MediaStream> | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const update = useCallback((next: Call | null) => { current.current = next; if (mounted.current) setCall(next); }, []);
  const closePeer = useCallback((participantId: string) => {
    const peer = peerConnections.current.get(participantId);
    if (peer) {
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.oniceconnectionstatechange = null;
      peer.connection.close();
      peerConnections.current.delete(participantId);
    }
    if (mounted.current) setRemoteStreams(items => items.filter(item => item.id !== participantId));
  }, []);
  const release = useCallback(() => {
    current.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    for (const peerId of Array.from(peerConnections.current.keys())) closePeer(peerId);
    peerConnections.current.clear();
    localRef.current?.getTracks().forEach(track => track.stop());
    localRef.current = null;
    localPromise.current = null;
    if (mounted.current) { setCall(null); setLocal(null); setRemoteStreams([]); setMuted(false); setCameraEnabled(true); }
  }, [closePeer]);
  const emitSignal = useCallback((c: Call, payload: Omit<Signal, 'callId'>, callback?: (error: Error | null, result?: any) => void) => {
    if (!auth?.user?.username || !auth.token) return;
    const s = connectSocket(auth.user.username, auth.token);
    if (!s.connected) { callback?.(new Error('Socket disconnected')); return; }
    const outgoing = {roomId: c.roomId, signal: {...payload, callId: c.id}, hiddenChatAccessToken: getHiddenChatAccessToken() || undefined};
    if (callback) s.timeout(5000).emit('webrtc-signal', outgoing, callback);
    else s.emit('webrtc-signal', outgoing);
  }, [auth?.user?.username, auth?.token]);
  const finish = useCallback((kind: 'end' | 'decline' = 'end') => {
    const c = current.current;
    if (c) emitSignal(c, {kind});
    release();
  }, [emitSignal, release]);
  const expire = useCallback((c: Call) => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      if (current.current?.id === c.id) {
        finish(c.phase === 'incoming' ? 'decline' : 'end');
        Alert.alert('Cuộc gọi kết thúc', 'Không kết nối được cuộc gọi.');
      }
    }, 45000);
  }, [finish]);
  const requestMedia = useCallback(async (video: boolean) => {
    if (Platform.OS === 'android') {
      const audio = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const camera = video
        ? await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
        : PermissionsAndroid.RESULTS.GRANTED;
      if (audio !== PermissionsAndroid.RESULTS.GRANTED || camera !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Cần quyền micro và camera để thực hiện cuộc gọi.');
      }
    }
    return mediaDevices.getUserMedia({audio: true, video});
  }, []);
  const ensureLocal = useCallback(async (c: Call) => {
    if (localRef.current) return localRef.current;
    if (!localPromise.current) localPromise.current = requestMedia(c.video);
    const stream = await localPromise.current;
    if (current.current?.id !== c.id) { stream.getTracks().forEach(track => track.stop()); throw new Error('Cuộc gọi đã kết thúc.'); }
    localRef.current = stream;
    localPromise.current = null;
    if (mounted.current) setLocal(stream);
    return stream;
  }, [requestMedia]);
  const ensurePeer = useCallback(async (c: Call, participant: Participant): Promise<PeerState> => {
    const existing = peerConnections.current.get(participant.id);
    if (existing) return existing;
    const stream = await ensureLocal(c);
    if (current.current?.id !== c.id) throw new Error('Cuộc gọi đã kết thúc.');
    const raced = peerConnections.current.get(participant.id);
    if (raced) return raced;
    const connection = new RTCPeerConnection({iceServers}) as any;
    const peer: PeerState = {connection, remoteReady: false, pendingCandidates: []};
    peerConnections.current.set(participant.id, peer);
    stream.getTracks().forEach(track => connection.addTrack(track, stream));
    connection.onicecandidate = (event: any) => {
      if (event.candidate && current.current?.id === c.id) emitSignal(c, {kind: 'candidate', to: participant.id, candidate: event.candidate});
    };
    connection.ontrack = (event: any) => {
      const remote = event.streams?.[0];
      if (remote && current.current?.id === c.id) {
        if (mounted.current) setRemoteStreams(items => [...items.filter(item => item.id !== participant.id), {id: participant.id, stream: remote}]);
        if (timeout.current) clearTimeout(timeout.current);
        const active = current.current;
        if (active?.id === c.id) update({...active, phase: 'connected'});
      }
    };
    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'failed' && current.current?.id === c.id) closePeer(participant.id);
    };
    return peer;
  }, [closePeer, emitSignal, ensureLocal, update]);
  const negotiateWithParticipants = useCallback(async (c: Call, participants: Participant[]) => {
    const myId = auth?.user?.username;
    if (!myId) return;
    for (const participant of participants) {
      if (participant.id === myId || myId.localeCompare(participant.id) >= 0) continue;
      try {
        const peer = await ensurePeer(c, participant);
        if (current.current?.id !== c.id || peer.connection.signalingState !== 'stable') continue;
        const offer = await peer.connection.createOffer();
        await peer.connection.setLocalDescription(offer);
        if (current.current?.id === c.id) emitSignal(c, {kind: 'offer', to: participant.id, sdp: offer});
      } catch (error) {
        console.warn('Unable to start participant connection', participant.id, error);
      }
    }
  }, [auth?.user?.username, emitSignal, ensurePeer]);
  const flushCandidates = useCallback(async (peer: PeerState) => {
    const queued = peer.pendingCandidates.splice(0);
    for (const candidate of queued) await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);
  const accept = async () => {
    const c = current.current;
    if (!c || c.phase !== 'incoming' || c.joined) return;
    const connecting: Call = {...c, phase: 'connecting', joined: true};
    update(connecting); expire(connecting);
    try {
      await ensureLocal(connecting);
      if (current.current?.id !== c.id) return;
      emitSignal(connecting, {kind: 'accept'}, (error, result) => {
        if (current.current?.id !== c.id) return;
        if (error || !result?.success) {
          finish('decline');
          Alert.alert('Không thể nhận cuộc gọi', result?.error || 'Không thể tham gia cuộc gọi.');
          return;
        }
        const participants = normalizeParticipants(result.participants);
        const joined = {...current.current!, participants, phase: 'connecting' as Phase};
        update(joined);
        void negotiateWithParticipants(joined, participants);
      });
    } catch (error: any) {
      if (current.current?.id === c.id) {
        finish('decline');
        Alert.alert('Không thể nhận cuộc gọi', error?.message || 'Không thể mở micro hoặc camera.');
      }
    }
  };
  const start: StartCall = (roomId, peerName, video, roomType) => {
    if (current.current) { Alert.alert('Đang có cuộc gọi', 'Hãy kết thúc cuộc gọi hiện tại trước.'); return; }
    if (!auth?.token || !auth.user?.username) return;
    const s = connectSocket(auth.user.username, auth.token);
    if (!s.connected) { Alert.alert('Chưa kết nối', 'Vui lòng kiểm tra mạng rồi thử lại.'); return; }
    const myParticipant = {id: auth.user.username, name: auth.user.name || auth.user.username};
    const c: Call = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      roomId,
      peer: peerName,
      video,
      group: roomType === 'group',
      joined: true,
      phase: 'ringing',
      participants: [myParticipant],
    };
    update(c); expire(c);
    emitSignal(c, {kind: 'invite', video, group: c.group}, (error, result) => {
      if (current.current?.id !== c.id || current.current.phase !== 'ringing') return;
      if (error || !result?.success || !result.peerOnline) {
        release();
        Alert.alert('Không thể gọi', result?.error || 'Người nhận chưa kết nối.');
        return;
      }
      const participants = normalizeParticipants(result.participants);
      update({...current.current, participants});
    });
  };

  useEffect(() => {
    mounted.current = true;
    if (!auth?.token || !auth.user?.username) return;
    const username = auth.user.username;
    const myId = auth.user.username;
    const s = connectSocket(username, auth.token);
    const handle = async ({roomId, from, signal: data}: SignalEvent) => {
      if (!data?.callId || from === myId) return;
      let c = current.current;

      if (data.kind === 'invite') {
        if (c) {
          if (c.id !== data.callId) emitSignal({...c, id: data.callId, roomId, group: !!data.group}, {kind: 'busy', to: from});
          return;
        }
        const participants = normalizeParticipants(data.participants);
        c = {
          id: data.callId,
          roomId,
          peer: participants.find(item => item.id === from)?.name || from,
          video: !!data.video,
          group: !!data.group,
          joined: false,
          phase: 'incoming',
          participants,
        };
        update(c); expire(c); return;
      }
      if (!c || c.id !== data.callId || c.roomId !== roomId) return;
      if (data.to && data.to !== myId) return;

      if (data.kind === 'end') {
        release();
        Alert.alert('Cuộc gọi kết thúc', 'Người gọi đã kết thúc cuộc gọi.');
        return;
      }
      if (data.kind === 'member-left') {
        closePeer(from);
        const participants = normalizeParticipants(data.participants).filter(item => item.id !== from);
        update({...c, participants});
        return;
      }
      if (data.kind === 'decline' || data.kind === 'busy') {
        if (!c.group) {
          release();
          Alert.alert('Cuộc gọi kết thúc', data.kind === 'busy' ? 'Người nhận đang bận.' : 'Người nhận đã từ chối.');
        }
        return;
      }

      try {
        if (data.kind === 'accept') {
          const participants = normalizeParticipants(data.participants);
          const next: Call = {...c, participants, phase: c.phase === 'ringing' && c.group ? 'connecting' : c.phase};
          update(next);
          if (next.joined) void negotiateWithParticipants(next, participants);
        } else if (data.kind === 'offer' && data.sdp) {
          const participant = normalizeParticipants(c.participants).find(item => item.id === from) || {id: from, name: from};
          const peer = await ensurePeer(c, participant);
          await peer.connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
          peer.remoteReady = true;
          await flushCandidates(peer);
          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);
          if (current.current?.id === c.id) emitSignal(c, {kind: 'answer', to: from, sdp: answer});
        } else if (data.kind === 'answer' && data.sdp) {
          const peer = peerConnections.current.get(from);
          if (!peer) return;
          await peer.connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
          peer.remoteReady = true;
          await flushCandidates(peer);
        } else if (data.kind === 'candidate' && data.candidate) {
          const peer = peerConnections.current.get(from);
          if (peer && peer.remoteReady) await peer.connection.addIceCandidate(new RTCIceCandidate(data.candidate));
          else if (peer) peer.pendingCandidates.push(data.candidate);
          else {
            const participant = normalizeParticipants(c.participants).find(item => item.id === from) || {id: from, name: from};
            const created = await ensurePeer(c, participant);
            created.pendingCandidates.push(data.candidate);
          }
        }
      } catch (error) {
        console.warn('Call negotiation failed', error);
        if (current.current?.id === c.id) {
          closePeer(from);
          Alert.alert('Kết nối bị lỗi', 'Không thể thiết lập kết nối với thành viên.');
        }
      }
    };
    const onCallTimeout = ({roomId}: {roomId?: string}) => {
      const active = current.current;
      if (!active || String(active.roomId) !== String(roomId) || !['incoming', 'ringing'].includes(active.phase)) return;
      release();
      Alert.alert('Cuộc gọi nhỡ', 'Người nhận chưa trả lời cuộc gọi.');
    };
    const onCallError = ({roomId, error}: {roomId?: string; error?: string}) => {
      const active = current.current;
      if (!active || String(active.roomId) !== String(roomId)) return;
      release();
      Alert.alert('Cuá»™c gá»i khÃ´ng thá»ƒ tiáº¿p tá»¥c', error || 'Quyá»n truy cáº­p phÃ²ng chat Ä‘Ã£ háº¿t háº¡n.');
    };
    const onHiddenRoomAccessEnded = ({roomId}: {roomId?: string}) => {
      const active = current.current;
      if (!active || String(active.roomId) !== String(roomId)) return;
      release();
      Alert.alert('Cuá»™c gá»i Ä‘Ã£ káº¿t thÃºc', 'Quyá»n truy cáº­p trÃ² chuyá»‡n áº©n Ä‘Ã£ háº¿t háº¡n.');
    };
    const disconnect = () => {
      if (current.current) { release(); Alert.alert('Cuộc gọi kết thúc', 'Kết nối mạng bị gián đoạn.'); }
    };
    s.on('webrtc-signal', handle); s.on('call:timeout', onCallTimeout); s.on('call:error', onCallError);
    s.on('hiddenChatAccessExpired', onHiddenRoomAccessEnded); s.on('hiddenChatAccessRevoked', onHiddenRoomAccessEnded); s.on('disconnect', disconnect);
    return () => {
      const active = current.current;
      if (active && s.connected) emitSignal(active, {kind: active.phase === 'incoming' ? 'decline' : 'end'});
      mounted.current = false; s.off('webrtc-signal', handle); s.off('call:timeout', onCallTimeout); s.off('call:error', onCallError);
      s.off('hiddenChatAccessExpired', onHiddenRoomAccessEnded); s.off('hiddenChatAccessRevoked', onHiddenRoomAccessEnded); s.off('disconnect', disconnect); release();
    };
  }, [auth?.token, auth?.user?.id, auth?.user?.username, closePeer, emitSignal, ensurePeer, expire, flushCandidates, negotiateWithParticipants, release, update]);

  const toggleMute = () => {
    const next = !muted;
    localRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    localRef.current?.getVideoTracks().forEach(track => { track.enabled = next; });
    setCameraEnabled(next);
  };
  const switchCamera = () => {
    localRef.current?.getVideoTracks().forEach(track => (track as any)._switchCamera?.());
  };
  const participantName = (id: string) => call?.participants.find(item => item.id === id)?.name || 'Thành viên';

  return <CallContext.Provider value={start}>
    {children}
    {!call?.video && remoteStreams.map(item => <RTCView key={`audio-${item.id}`} streamURL={item.stream.toURL()} style={styles.hiddenAudio} />)}
    <Modal visible={!!call} animationType="fade" onRequestClose={() => finish(call?.phase === 'incoming' && !call.joined ? 'decline' : 'end')}>
      <View style={styles.screen}>
        <Text style={styles.name}>{call?.group ? call.peer : call?.peer}</Text>
        <Text style={styles.status}>
          {call?.phase === 'incoming' ? `Cuộc gọi ${call.video ? 'video' : 'thoại'} đến` :
            call?.phase === 'ringing' ? 'Đang gọi…' : call?.phase === 'connecting' ? 'Đang kết nối…' : 'Đang trò chuyện'}
        </Text>
        {call?.group && <>
          <Text style={styles.participantCount}>{call.participants.length} người tham gia</Text>
          <View style={styles.participantStrip}>
            {call.participants.slice(0, 5).map(item => <View key={item.id} style={styles.participantPill}>
              <Text style={styles.participantInitial}>{item.name.trim().slice(0, 1).toUpperCase()}</Text>
              <Text numberOfLines={1} style={styles.participantName}>{item.id === auth?.user?.username ? 'Bạn' : item.name}</Text>
            </View>)}
            {call.participants.length > 5 && <Text style={styles.moreParticipants}>+{call.participants.length - 5}</Text>}
          </View>
        </>}
        {call?.video && <View style={[styles.videoArea, call.group && styles.groupVideoArea]}>
          {remoteStreams.map(item => <View key={item.id} style={call.group ? styles.groupTile : styles.remoteTile}>
            <RTCView streamURL={item.stream.toURL()} style={styles.remote} objectFit="cover" />
            {call.group && <Text numberOfLines={1} style={styles.tileName}>{participantName(item.id)}</Text>}
          </View>)}
          {local && cameraEnabled && <View style={call.group ? styles.groupLocalTile : styles.localTile}>
            <RTCView streamURL={local.toURL()} style={styles.local} objectFit="cover" mirror />
            {call.group && <Text style={styles.tileName}>Bạn</Text>}
          </View>}
          {local && !cameraEnabled && <View style={call.group ? styles.groupLocalTile : styles.localTile}><View style={styles.cameraOff}><Icon name="user" size={24} color="#dbe5ef" /><Text style={styles.tileName}>Bạn</Text></View></View>}
        </View>}
        <View style={styles.controls}>
          {call?.phase === 'incoming' && !call.joined ? <>
            <TouchableOpacity accessibilityLabel="Từ chối cuộc gọi" style={[styles.action, styles.end]} onPress={() => finish('decline')}><Icon name="phone" size={25} color="#fff" /><Text style={styles.label}>Từ chối</Text></TouchableOpacity>
            <TouchableOpacity accessibilityLabel="Nhận cuộc gọi" style={[styles.action, styles.accept]} onPress={accept}><Icon name="phone" size={25} color="#fff" /><Text style={styles.label}>Nhận</Text></TouchableOpacity>
          </> : <>
            {local && <TouchableOpacity accessibilityLabel={muted ? 'Bật micro' : 'Tắt micro'} style={[styles.action, styles.secondary]} onPress={toggleMute}><Icon name={muted ? 'microphone-slash' : 'microphone'} size={25} color="#fff" /><Text style={styles.label}>{muted ? 'Bật micro' : 'Tắt micro'}</Text></TouchableOpacity>}
            {local && call?.video && <TouchableOpacity accessibilityLabel={cameraEnabled ? 'Tắt camera' : 'Bật camera'} style={[styles.action, styles.secondary]} onPress={toggleCamera}><Icon name={cameraEnabled ? 'video-camera' : 'ban'} size={23} color="#fff" /><Text style={styles.label}>{cameraEnabled ? 'Tắt camera' : 'Bật camera'}</Text></TouchableOpacity>}
            {local && call?.video && <TouchableOpacity accessibilityLabel="Đổi camera" style={[styles.action, styles.secondary]} onPress={switchCamera}><Icon name="refresh" size={23} color="#fff" /><Text style={styles.label}>Đổi camera</Text></TouchableOpacity>}
            <TouchableOpacity accessibilityLabel="Kết thúc cuộc gọi" style={[styles.action, styles.end]} onPress={() => finish()}><Icon name="phone" size={25} color="#fff" /><Text style={styles.label}>Kết thúc</Text></TouchableOpacity>
          </>}
        </View>
      </View>
    </Modal>
  </CallContext.Provider>;
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#0b1015', alignItems: 'center', paddingTop: 52},
  name: {fontSize: 24, fontWeight: '600', color: '#fff'},
  status: {fontSize: 15, color: '#c2d4e6', marginTop: 10},
  participantCount: {fontSize: 13, color: '#c2d4e6', marginTop: 6},
  participantStrip: {height: 58, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginTop: 6},
  participantPill: {flexDirection: 'row', alignItems: 'center', maxWidth: 118, marginRight: 7, borderRadius: 18, paddingVertical: 5, paddingHorizontal: 8, backgroundColor: '#1b2630'},
  participantInitial: {width: 24, height: 24, borderRadius: 12, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', color: '#fff', backgroundColor: '#2878d0', fontSize: 13, fontWeight: '700'},
  participantName: {color: '#eef3f8', fontSize: 12, marginLeft: 6, maxWidth: 74},
  moreParticipants: {color: '#b9c4ce', fontSize: 12, paddingHorizontal: 4},
  videoArea: {flex: 1, alignSelf: 'stretch', marginTop: 10, backgroundColor: '#101820'},
  groupVideoArea: {flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', padding: 6},
  remoteTile: {flex: 1},
  groupTile: {width: '48%', height: '46%', margin: '1%', backgroundColor: '#20384e', borderRadius: 12, overflow: 'hidden'},
  groupLocalTile: {position: 'absolute', right: 12, top: 12, width: '30%', height: '26%', backgroundColor: '#293e52', borderRadius: 10, overflow: 'hidden'},
  remote: {flex: 1},
  localTile: {position: 'absolute', right: 12, top: 12, width: 110, height: 160, backgroundColor: '#293e52'},
  local: {flex: 1},
  tileName: {position: 'absolute', left: 8, bottom: 6, color: '#fff', fontSize: 12, backgroundColor: '#0008', paddingHorizontal: 5, borderRadius: 4},
  cameraOff: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#35434f'},
  hiddenAudio: {position: 'absolute', width: 1, height: 1, opacity: 0},
  controls: {flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 70},
  action: {width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginHorizontal: 5},
  end: {backgroundColor: '#e74747'}, accept: {backgroundColor: '#26a869'}, secondary: {backgroundColor: '#526b82'}, label: {fontSize: 11, color: '#fff', marginTop: 3},
});
