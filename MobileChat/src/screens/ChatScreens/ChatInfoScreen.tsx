import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import {useFocusEffect} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {launchImageLibrary} from 'react-native-image-picker';
import {MainTabsParamList} from '../../types/navigation';
import {useAuthStore} from '../../auth/store/login.store';
import {FriendEntry, listFriends} from '../../services/FriendsAPI/api';
import {addGroupMembers, getGroupMembers, GroupMembersResponse, removeGroupMember, getRoomPreference, setRoomMute, setRoomHidden, getHiddenChatPinStatus, renameGroup, setGroupImage, setGroupAdmin, transferGroupOwnership, leaveGroup, deleteRoom, ChatPreference, createGroupInvite} from '../../services/ChatAPI/api';
import {socket} from '../../utils/socket';
import constants from '../../contents/Api_URL';
import GroupInviteModal from '../../components/GroupInviteModal';

type Props = StackScreenProps<MainTabsParamList, 'ChatInfo'>;

const resolveGroupImageUri = (image?: string | null) => {
  if (!image) return undefined;
  const value = image.trim();
  if (!value) return undefined;
  if (/^(https?:|data:|file:|content:)/i.test(value)) return value;
  return `${constants.API_URLS.LAY_ANH}${value.replace(/^\/+/, '').replace(/^uploads\//i, '')}`;
};

export default function ChatInfoScreen({navigation, route}: Props) {
  const isGroup = route.params.chatType === 'group';
  const auth = useAuthStore(state => state.auth);
  const [group, setGroup] = useState<GroupMembersResponse | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(isGroup);
  const [saving, setSaving] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [friendQuery, setFriendQuery] = useState('');
  const [preference, setPreference] = useState<ChatPreference | null>(null);
  const [muteModalVisible, setMuteModalVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [ownerLeaveModalVisible, setOwnerLeaveModalVisible] = useState(false);
  const [selectedSuccessorId, setSelectedSuccessorId] = useState('');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupInviteLink, setGroupInviteLink] = useState('');
  const [groupInviteVisible, setGroupInviteVisible] = useState(false);

  const loadGroupData = useCallback(async () => {
    setLoading(true);
    try {
      setPreference(await getRoomPreference(route.params.chatId));
      if (!isGroup) return;
      const details = await getGroupMembers(route.params.chatId);
      setGroup(details);
      if (details.canManage) {
        try {
          const contacts = await listFriends();
          setFriends(contacts.friends);
        } catch {
          setFriends([]);
        }
      }
    } catch (error: any) {
      Alert.alert('Không tải được thông tin nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [isGroup, route.params.chatId]);

  useFocusEffect(useCallback(() => {
    void loadGroupData();
  }, [loadGroupData]));

  useEffect(() => {
    const ownerChangedHandler = (payload: any) => {
      if (String(payload?.roomId) === String(route.params.chatId)) void loadGroupData();
    };
    const imageChangedHandler = (payload: any) => {
      if (String(payload?.roomId) === String(route.params.chatId)) {
        setGroup(previous => previous ? {...previous, groupImage: payload.groupImage || null} : previous);
      }
    };
    const adminChangedHandler = (payload: any) => {
      if (String(payload?.roomId) === String(route.params.chatId)) void loadGroupData();
    };
    const membersChangedHandler = (payload: any) => {
      if (String(payload?.roomId) === String(route.params.chatId)) void loadGroupData();
    };
    socket?.on('groupOwnerChanged', ownerChangedHandler);
    socket?.on('groupImageChanged', imageChangedHandler);
    socket?.on('groupAdminChanged', adminChangedHandler);
    socket?.on('groupMembersUpdated', membersChangedHandler);
    return () => {
      socket?.off('groupOwnerChanged', ownerChangedHandler);
      socket?.off('groupImageChanged', imageChangedHandler);
      socket?.off('groupAdminChanged', adminChangedHandler);
      socket?.off('groupMembersUpdated', membersChangedHandler);
    };
  }, [loadGroupData, route.params.chatId]);

  const currentMembers = new Set(group?.members.map(member => member.username) || []);
  const ownerLeaveCandidates = (group?.members || []).filter(member => String(member.username) !== String(auth?.user?.username));
  const availableFriends = friends.filter(entry => !currentMembers.has(entry.user.username)
    && `${entry.user.name} ${entry.user.username}`.toLocaleLowerCase().includes(friendQuery.trim().toLocaleLowerCase()));

  const inviteSelected = async () => {
    const userIds = Object.keys(selected).filter(id => selected[id]);
    if (!userIds.length) return;
    setSaving(true);
    try {
      await addGroupMembers(route.params.chatId, userIds);
      setAddModalVisible(false);
      setSelected({});
      setFriendQuery('');
      await loadGroupData();
    } catch (error: any) {
      Alert.alert('Không thêm được thành viên', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoveMember = (member: GroupMembersResponse['members'][number]) => {
    Alert.alert('Xóa thành viên khỏi nhóm?', 'Xóa ' + member.name + ' khỏi cuộc trò chuyện này?', [
      {text: 'Hủy', style: 'cancel'},
      {text: 'Xóa', style: 'destructive', onPress: async () => {
        setSaving(true);
        try {
          await removeGroupMember(route.params.chatId, member.username);
          await loadGroupData();
        } catch (error: any) {
          Alert.alert('Không xóa được thành viên', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        } finally {
          setSaving(false);
        }
      }},
    ]);
  };

  const confirmTransferOwnership = (member: GroupMembersResponse['members'][number]) => {
    Alert.alert('Chuyển quyền trưởng nhóm?', `Chuyển quyền trưởng nhóm cho ${member.name}?`, [
      {text: 'Hủy', style: 'cancel'},
      {text: 'Chuyển quyền', onPress: async () => {
        setSaving(true);
        try {
          await transferGroupOwnership(route.params.chatId, member.username);
          await loadGroupData();
        } catch (error: any) {
          Alert.alert('Không chuyển được quyền', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        } finally {
          setSaving(false);
        }
      }},
    ]);
  };

  const confirmAdminChange = (member: GroupMembersResponse['members'][number]) => {
    const isAdmin = !member.isAdmin;
    Alert.alert(isAdmin ? 'Cấp quyền quản trị?' : 'Thu hồi quyền quản trị?', `${isAdmin ? 'Cho phép' : 'Không cho phép'} ${member.name} quản lý thành viên và cài đặt nhóm?`, [
      {text: 'Hủy', style: 'cancel'},
      {text: isAdmin ? 'Cấp quyền' : 'Thu hồi', style: isAdmin ? 'default' : 'destructive', onPress: async () => {
        setSaving(true);
        try {
          await setGroupAdmin(route.params.chatId, member.username, isAdmin);
          await loadGroupData();
        } catch (error: any) {
          Alert.alert('Không cập nhật được quyền quản trị', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        } finally {
          setSaving(false);
        }
      }},
    ]);
  };

  const confirmLeaveGroup = () => {
    const isOwner = String(group?.createdBy) === String(auth?.user?.username);
    if (isOwner) {
      setSelectedSuccessorId('');
      setOwnerLeaveModalVisible(true);
      return;
    }

    Alert.alert('Rời khỏi nhóm?', 'Bạn sẽ không còn nhận được tin nhắn mới trong nhóm này.', [
      {text: 'Ở lại', style: 'cancel'},
      {text: 'Rời nhóm', style: 'destructive', onPress: async () => {
        setSaving(true);
        try {
          await leaveGroup(route.params.chatId);
          navigation.pop(2);
        } catch (error: any) {
          Alert.alert('Không rời được nhóm', error?.response?.data?.error || error?.message || 'Trưởng nhóm cần chuyển quyền trước khi rời.');
        } finally {
          setSaving(false);
        }
      }},
    ]);
  };

  const leaveGroupAsOwner = () => {
    if (!selectedSuccessorId || saving) return;
    const successor = group?.members.find(member => member.username === selectedSuccessorId);
    setOwnerLeaveModalVisible(false);
    Alert.alert(
      'Chuyển quyền và rời nhóm?',
      `Quyền trưởng nhóm sẽ chuyển cho ${successor?.name || selectedSuccessorId}. Bạn sẽ rời nhóm.`,
      [
        {text: 'Ở lại', style: 'cancel'},
        {text: 'Chuyển quyền và rời', style: 'destructive', onPress: async () => {
          setSaving(true);
          try {
            await leaveGroup(route.params.chatId, selectedSuccessorId);
            navigation.pop(2);
          } catch (error: any) {
            Alert.alert('Không rời được nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
            await loadGroupData();
          } finally {
            setSaving(false);
          }
        }},
      ],
    );
  };

  const confirmDeleteGroup = () => {
    Alert.alert('Xóa nhóm?', 'Nhóm và lịch sử trò chuyện sẽ bị xóa với tất cả thành viên.', [
      {text: 'Hủy', style: 'cancel'},
      {text: 'Xóa nhóm', style: 'destructive', onPress: async () => {
        setSaving(true);
        try {
          await deleteRoom(route.params.chatId);
          navigation.pop(2);
        } catch (error: any) {
          Alert.alert('Không xóa được nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
        } finally {
          setSaving(false);
        }
      }},
    ]);
  };

  const applyMute = async (muted: boolean, durationMs?: number) => {
    setSaving(true);
    try {
      const mutedUntil = muted && durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
      setPreference(await setRoomMute(route.params.chatId, muted, mutedUntil));
    } catch (error: any) {
      Alert.alert('Không cập nhật được thông báo', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const promptToHideChat = async () => {
    try {
      const status = await getHiddenChatPinStatus();
      if (!status.hasPin) {
        Alert.alert('Tạo mã khóa trước', 'Mã khóa giúp bảo vệ danh sách trò chuyện ẩn.', [
          {text: 'Để sau', style: 'cancel'},
          {text: 'Tạo mã', onPress: () => navigation.navigate('HiddenChats', {setupOnly: true})},
        ]);
        return;
      }
      Alert.alert('Ẩn cuộc trò chuyện?', 'Cuộc trò chuyện sẽ rời khỏi danh sách chính và chỉ hiện lại sau khi mở khóa.', [
        {text: 'Hủy', style: 'cancel'},
        {text: 'Ẩn', onPress: async () => {
          try {
            await setRoomHidden(route.params.chatId, true);
            navigation.popToTop();
          } catch (error: any) {
            Alert.alert('Không ẩn được cuộc trò chuyện', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
          }
        }},
      ]);
    } catch (error: any) {
      Alert.alert('Không kiểm tra được mã khóa', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    }
  };

  const openMuteOptions = () => setMuteModalVisible(true);

  const openGroupInvite = async () => {
    if (!isGroup || saving) return;
    setSaving(true);
    try {
      const invite = await createGroupInvite(route.params.chatId);
      setGroupInviteLink(invite.link);
      setGroupInviteVisible(true);
    } catch (error: any) {
      Alert.alert('Không tạo được mã mời nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const saveGroupName = async () => {
    const name = groupNameDraft.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const result = await renameGroup(route.params.chatId, name);
      setGroup(previous => previous ? {...previous, name: result.name} : previous);
      setRenameModalVisible(false);
    } catch (error: any) {
      Alert.alert('Không đổi được tên nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const applyGroupImage = async (image: string | null) => {
    setSaving(true);
    try {
      const result = await setGroupImage(route.params.chatId, image);
      setGroup(previous => previous ? {...previous, groupImage: result.groupImage} : previous);
    } catch (error: any) {
      Alert.alert('Không cập nhật được ảnh nhóm', error?.response?.data?.error || error?.message || 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  const chooseGroupImage = () => {
    if (!group?.canManage || saving) return;
    Alert.alert('Ảnh nhóm', 'Chọn ảnh mới hoặc gỡ ảnh hiện tại.', [
      {text: 'Hủy', style: 'cancel'},
      ...(group.groupImage ? [{text: 'Gỡ ảnh', style: 'destructive' as const, onPress: () => { void applyGroupImage(null); }}] : []),
      {text: 'Chọn ảnh', onPress: () => {
        void launchImageLibrary({mediaType: 'photo', includeBase64: true, maxWidth: 1024, maxHeight: 1024, quality: 0.8}).then(result => {
          if (result.didCancel) return;
          if (result.errorCode) {
            Alert.alert('Không mở được thư viện ảnh', result.errorMessage || 'Vui lòng thử lại.');
            return;
          }
          const asset = result.assets?.[0];
          if (!asset?.base64) {
            Alert.alert('Không đọc được ảnh', 'Hãy chọn lại một ảnh khác.');
            return;
          }
          const mimeType = asset.type || 'image/jpeg';
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.toLowerCase())) {
            Alert.alert('Định dạng chưa hỗ trợ', 'Hãy chọn ảnh PNG, JPEG hoặc WebP.');
            return;
          }
          void applyGroupImage(`data:${mimeType};base64,${asset.base64}`);
        }).catch(error => Alert.alert('Không mở được thư viện ảnh', error?.message || 'Vui lòng thử lại.'));
      }},
    ]);
  };

  const renderAvatar = (uri?: string | null, label = '') => uri
    ? <Image source={{uri}} style={styles.avatar} />
    : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{(label || '?').charAt(0).toUpperCase()}</Text></View>;

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={{paddingBottom: 24}}>
    <View style={styles.identity}>
      {isGroup
        ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Đổi ảnh nhóm" disabled={!group?.canManage || saving} activeOpacity={0.85} onPress={chooseGroupImage} style={[styles.groupAvatar, group?.groupImage ? {padding: 0} : null]}>{group?.groupImage ? <Image source={{uri: resolveGroupImageUri(group.groupImage)}} style={styles.groupAvatarImage} /> : <Icon name="users" size={30} color="#2179ee" />}{group?.canManage && <View style={styles.groupAvatarEdit}><Icon name="camera" size={13} color="#fff" /></View>}</TouchableOpacity>
        : <View style={styles.groupAvatar}><Icon name="user" size={30} color="#7d9dbf" /></View>}
      <View style={styles.nameRow}>
        <Text style={styles.name}>{group?.name || route.params.chatName || 'Cuộc trò chuyện'}</Text>
        {isGroup && group?.canManage && <TouchableOpacity accessibilityLabel="Đổi tên nhóm" style={styles.renameButton} onPress={() => { setGroupNameDraft(group.name); setRenameModalVisible(true); }}><Icon name="pencil" size={15} color="#2179ee" /></TouchableOpacity>}
      </View>
      {isGroup && !!group && <Text style={styles.memberCount}>{group.members.length} thành viên</Text>}
    </View>
    <View style={styles.actions}>
      <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('SearchMessages', route.params)}>
        <Icon name="search" size={22} color="#405060" /><Text style={styles.actionText}>Tìm tin nhắn</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('SharedItems', route.params)}>
        <Icon name="picture-o" size={22} color="#405060" /><Text style={styles.actionText}>Ảnh, file, link</Text>
      </TouchableOpacity>
    </View>
    {isGroup && <TouchableOpacity accessibilityRole="button" style={styles.preferenceRow} disabled={saving || loading} onPress={() => { void openGroupInvite(); }}>
      <View style={styles.preferenceIcon}><Icon name="qrcode" size={18} color="#2179ee" /></View>
      <View style={{flex: 1}}><Text style={styles.memberName}>Mời vào nhóm bằng mã QR</Text><Text style={styles.memberMeta}>Người lạ có liên kết cũng có thể tham gia</Text></View>
      {saving ? <ActivityIndicator size="small" color="#2179ee" /> : <Icon name="angle-right" size={22} color="#99a3ae" />}
    </TouchableOpacity>}
    <TouchableOpacity style={styles.preferenceRow} disabled={saving || loading} onPress={openMuteOptions}>
      <View style={styles.preferenceIcon}><Icon name={preference?.isMuted ? 'bell-slash' : 'bell-o'} size={18} color="#2179ee" /></View>
      <View style={{flex: 1}}><Text style={styles.memberName}>{preference?.isMuted ? 'Thông báo đang tắt' : 'Thông báo đang bật'}</Text><Text style={styles.memberMeta}>Điều chỉnh thông báo cho cuộc trò chuyện</Text></View>
      <Icon name="angle-right" size={22} color="#99a3ae" />
    </TouchableOpacity>
    {!preference?.isHidden && <TouchableOpacity accessibilityRole="button" style={styles.preferenceRow} disabled={saving || loading || !preference} onPress={() => { void promptToHideChat(); }}>
      <View style={styles.preferenceIcon}><Icon name="lock" size={18} color="#2179ee" /></View>
      <View style={{flex: 1}}><Text style={styles.memberName}>Ẩn cuộc trò chuyện</Text><Text style={styles.memberMeta}>Khóa bằng mã 4 chữ số</Text></View>
      <Icon name="angle-right" size={22} color="#99a3ae" />
    </TouchableOpacity>}
    {isGroup && <View style={styles.membersSection}>
      <View style={styles.sectionHeader}>
        <View><Text style={styles.heading}>Thành viên</Text><Text style={styles.subheading}>Danh sách người trong nhóm</Text></View>
        {group?.canManage && <TouchableOpacity accessibilityRole="button" style={styles.addButton} onPress={() => setAddModalVisible(true)}><Icon name="user-plus" size={15} color="#fff" /><Text style={styles.addButtonText}>Thêm</Text></TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator style={{padding: 20}} color="#2179ee" /> : group?.members.map(member => (
        <View key={member.username} style={styles.memberRow}>
          {renderAvatar(member.avatar, member.name)}
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{member.name}{member.username === auth?.user?.username ? ' (bạn)' : ''}</Text>
            <Text style={styles.memberMeta}>{member.isOwner ? 'Trưởng nhóm' : member.isAdmin ? 'Quản trị viên' : member.online ? 'Đang hoạt động' : member.username}</Text>
          </View>
          {group.canManage && String(group.createdBy) === String(auth?.user?.username) && !member.isOwner && <TouchableOpacity accessibilityLabel={'Chuyển quyền trưởng nhóm cho ' + member.name} style={styles.transferButton} disabled={saving} onPress={() => confirmTransferOwnership(member)}><Icon name="star" size={17} color="#e8a428" /></TouchableOpacity>}
          {String(group.createdBy) === String(auth?.user?.username) && !member.isOwner && <TouchableOpacity accessibilityLabel={(member.isAdmin ? 'Thu hồi quyền quản trị của ' : 'Cấp quyền quản trị cho ') + member.name} style={styles.transferButton} disabled={saving} onPress={() => confirmAdminChange(member)}><Icon name="shield" size={17} color={member.isAdmin ? '#d14b4b' : '#2179ee'} /></TouchableOpacity>}
          {group.canManage && !member.isOwner && (!member.isAdmin || String(group.createdBy) === String(auth?.user?.username)) && <TouchableOpacity accessibilityLabel={'Xóa ' + member.name + ' khỏi nhóm'} style={styles.removeButton} disabled={saving} onPress={() => confirmRemoveMember(member)}><Icon name="minus-circle" size={20} color="#d14b4b" /></TouchableOpacity>}
        </View>
      ))}
      {!loading && group?.members.length === 0 && <Text style={styles.empty}>Chưa có thành viên.</Text>}
    </View>}
    {isGroup && <TouchableOpacity style={styles.leaveRow} disabled={saving} onPress={confirmLeaveGroup}>
      <Icon name="sign-out" size={18} color="#d14b4b" />
      <Text style={styles.leaveText}>Rời khỏi nhóm</Text>
    </TouchableOpacity>}
    {isGroup && String(group?.createdBy) === String(auth?.user?.username) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Xóa nhóm" style={styles.deleteRow} disabled={saving} onPress={confirmDeleteGroup}>
      <Icon name="trash" size={17} color="#d14b4b" />
      <Text style={styles.leaveText}>Xóa nhóm cho tất cả thành viên</Text>
    </TouchableOpacity>}
    <TouchableOpacity style={styles.mediaRow} onPress={() => navigation.navigate('SharedItems', route.params)}>
      <View><Text style={styles.heading}>Kho lưu trữ</Text><Text style={styles.subheading}>Ảnh, video, tệp và liên kết đã chia sẻ</Text></View>
      <Icon name="angle-right" size={24} color="#99a3ae" />
    </TouchableOpacity>
    <TouchableOpacity style={styles.mediaRow} onPress={() => navigation.navigate('ChatExport', {chatId: route.params.chatId, chatName: route.params.chatName})}>
      <View><Text style={styles.heading}>Xuất lịch sử trò chuyện</Text><Text style={styles.subheading}>Tạo bản văn bản để lưu hoặc chia sẻ</Text></View>
      <Icon name="angle-right" size={24} color="#99a3ae" />
    </TouchableOpacity>
    </ScrollView>

    <Modal visible={muteModalVisible} transparent animationType="slide" onRequestClose={() => setMuteModalVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.muteSheet}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Thông báo</Text><TouchableOpacity accessibilityLabel="Đóng" onPress={() => setMuteModalVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity></View>
          <Text style={styles.subheading}>Chọn thời hạn cho cuộc trò chuyện này</Text>
          {[
            ...(preference?.isMuted ? [{label: 'Bật lại thông báo', muted: false, duration: undefined}] : []),
            {label: 'Tắt trong 1 giờ', muted: true, duration: 60 * 60 * 1000},
            {label: 'Tắt trong 8 giờ', muted: true, duration: 8 * 60 * 60 * 1000},
            {label: 'Tắt trong 1 ngày', muted: true, duration: 24 * 60 * 60 * 1000},
            {label: 'Tắt vô thời hạn', muted: true, duration: undefined},
          ].map(option => <TouchableOpacity key={option.label} style={styles.muteOption} onPress={() => { setMuteModalVisible(false); void applyMute(option.muted, option.duration); }}><Text style={styles.memberName}>{option.label}</Text><Icon name="angle-right" size={20} color="#99a3ae" /></TouchableOpacity>)}
        </View>
      </View>
    </Modal>
    <Modal visible={renameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)}>
      <View style={styles.renameOverlay}>
        <View style={styles.renameCard}>
          <Text style={styles.modalTitle}>Đổi tên nhóm</Text>
          <TextInput style={styles.searchInput} value={groupNameDraft} onChangeText={setGroupNameDraft} maxLength={80} autoFocus placeholder="Tên nhóm" placeholderTextColor="#89939e" />
          <View style={styles.renameActions}>
            <TouchableOpacity style={styles.renameCancel} onPress={() => setRenameModalVisible(false)}><Text style={styles.renameCancelText}>Hủy</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.renameSave, (!groupNameDraft.trim() || saving) && styles.disabledButton]} disabled={!groupNameDraft.trim() || saving} onPress={() => { void saveGroupName(); }}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Lưu</Text>}</TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    <Modal visible={addModalVisible} transparent animationType="slide" onRequestClose={() => setAddModalVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Thêm bạn bè vào nhóm</Text><TouchableOpacity onPress={() => setAddModalVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity></View>
          <TextInput style={styles.searchInput} value={friendQuery} onChangeText={setFriendQuery} placeholder="Tìm bạn bè" placeholderTextColor="#89939e" />
          <ScrollView style={styles.friendList} keyboardShouldPersistTaps="handled">
            {availableFriends.map(entry => {
              const checked = !!selected[entry.user.username];
              return <TouchableOpacity key={entry.id} style={styles.friendRow} onPress={() => setSelected(previous => ({...previous, [entry.user.username]: !previous[entry.user.username]}))}>
                {renderAvatar(entry.user.avatar, entry.user.name)}
                <View style={styles.memberInfo}><Text style={styles.memberName}>{entry.user.name || entry.user.username}</Text><Text style={styles.memberMeta}>{entry.user.username}</Text></View>
                <Icon name={checked ? 'check-circle' : 'circle-o'} size={21} color={checked ? '#2179ee' : '#aab3bc'} />
              </TouchableOpacity>;
            })}
            {!availableFriends.length && <Text style={styles.empty}>Không có bạn bè phù hợp để thêm.</Text>}
          </ScrollView>
          <TouchableOpacity style={[styles.confirmButton, (!Object.values(selected).some(Boolean) || saving) && styles.disabledButton]} disabled={!Object.values(selected).some(Boolean) || saving} onPress={() => { void inviteSelected(); }}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Thêm vào nhóm</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    <Modal visible={ownerLeaveModalVisible} transparent animationType="slide" onRequestClose={() => setOwnerLeaveModalVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Chọn trưởng nhóm mới</Text>
            <TouchableOpacity accessibilityLabel="Đóng" onPress={() => setOwnerLeaveModalVisible(false)}><Icon name="times" size={20} color="#697582" /></TouchableOpacity>
          </View>
          <Text style={styles.subheading}>Chọn thành viên nhận quyền trước khi bạn rời nhóm.</Text>
          <ScrollView style={styles.friendList} keyboardShouldPersistTaps="handled">
            {ownerLeaveCandidates.map(member => {
              const checked = selectedSuccessorId === member.username;
              return <TouchableOpacity key={member.username} accessibilityRole="radio" accessibilityState={{checked}} style={styles.friendRow} onPress={() => setSelectedSuccessorId(member.username)}>
                {renderAvatar(member.avatar, member.name)}
                <View style={styles.memberInfo}><Text style={styles.memberName}>{member.name || member.username}</Text><Text style={styles.memberMeta}>{member.isAdmin ? 'Quản trị viên' : member.online ? 'Đang hoạt động' : member.username}</Text></View>
                <Icon name={checked ? 'check-circle' : 'circle-o'} size={21} color={checked ? '#2179ee' : '#aab3bc'} />
              </TouchableOpacity>;
            })}
            {!ownerLeaveCandidates.length && <Text style={styles.empty}>Nhóm cần có thành viên khác để nhận quyền trưởng nhóm.</Text>}
          </ScrollView>
          <TouchableOpacity style={[styles.confirmButton, (!selectedSuccessorId || saving) && styles.disabledButton]} disabled={!selectedSuccessorId || saving} onPress={leaveGroupAsOwner}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Chuyển quyền và rời nhóm</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    <GroupInviteModal visible={groupInviteVisible} groupName={group?.name || route.params.chatName || 'Nhóm'} link={groupInviteLink} onClose={() => setGroupInviteVisible(false)} />
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#f1f3f5'},
  identity: {backgroundColor: '#fff', alignItems: 'center', padding: 24},
  groupAvatar: {width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3ecf4', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  groupAvatarEdit: {position: 'absolute', right: 0, bottom: 0, width: 25, height: 25, borderRadius: 13, backgroundColor: '#2179ee', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  groupAvatarImage: {width: '100%', height: '100%'},
  nameRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  name: {fontSize: 18, fontWeight: '600', color: '#20262d', marginTop: 10},
  renameButton: {marginLeft: 10, marginTop: 10, padding: 5},
  memberCount: {fontSize: 12, color: '#778391', marginTop: 4},
  actions: {flexDirection: 'row', justifyContent: 'center', backgroundColor: '#fff', paddingBottom: 16},
  action: {width: 120, alignItems: 'center', padding: 8},
  actionText: {marginTop: 7, color: '#263340', fontSize: 12},
  preferenceRow: {marginTop: 10, minHeight: 68, paddingHorizontal: 16, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center'},
  preferenceIcon: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#edf5ff', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  membersSection: {marginTop: 10, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8},
  sectionHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10},
  heading: {fontSize: 16, fontWeight: '600', color: '#20262d'},
  subheading: {fontSize: 13, marginTop: 5, color: '#79838e'},
  addButton: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#2179ee', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18},
  addButtonText: {color: '#fff', marginLeft: 6, fontSize: 13, fontWeight: '600'},
  memberRow: {minHeight: 62, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e7ebef'},
  avatar: {width: 42, height: 42, borderRadius: 21},
  avatarFallback: {backgroundColor: '#e6f0fb', alignItems: 'center', justifyContent: 'center'},
  avatarInitial: {fontSize: 17, fontWeight: '700', color: '#2179ee'},
  memberInfo: {flex: 1, marginLeft: 11},
  memberName: {fontSize: 14, fontWeight: '600', color: '#20262d'},
  memberMeta: {fontSize: 12, color: '#85909c', marginTop: 3},
  removeButton: {padding: 10},
  transferButton: {padding: 10},
  leaveRow: {marginTop: 10, minHeight: 54, paddingHorizontal: 18, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center'},
  deleteRow: {marginTop: 1, minHeight: 54, paddingHorizontal: 18, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center'},
  leaveText: {marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#d14b4b'},
  mediaRow: {marginTop: 10, backgroundColor: '#fff', padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  empty: {fontSize: 13, color: '#89939e', textAlign: 'center', padding: 20},
  modalOverlay: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.38)'},
  modalSheet: {height: '78%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18},
  muteSheet: {backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28},
  muteOption: {minHeight: 53, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e7ebef'},
  modalHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
  modalTitle: {fontSize: 17, fontWeight: '700', color: '#20262d'},
  searchInput: {height: 42, backgroundColor: '#f2f4f7', borderRadius: 10, paddingHorizontal: 12, color: '#20262d'},
  friendList: {flex: 1, marginTop: 8},
  friendRow: {minHeight: 62, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e7ebef'},
  confirmButton: {height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2179ee', borderRadius: 12, marginTop: 12},
  confirmText: {fontSize: 15, color: '#fff', fontWeight: '700'},
  disabledButton: {opacity: 0.45},
  renameOverlay: {flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.38)'},
  renameCard: {backgroundColor: '#fff', borderRadius: 18, padding: 18},
  renameActions: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18},
  renameCancel: {paddingHorizontal: 16, paddingVertical: 11},
  renameCancelText: {color: '#59636e', fontWeight: '600'},
  renameSave: {minWidth: 82, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2179ee', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10},
});
