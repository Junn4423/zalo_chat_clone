import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Switch, TextInput, StyleSheet } from "react-native";
import { View, Text, Image, TouchableOpacity, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import Icon from "react-native-vector-icons/FontAwesome";
import { styles } from "./css/UserScreen.style";
import SearchHeader from "../../components/SearchHeader"; 
import { removeToken } from "../../auth/utils/storage";
import { useAuthStore } from "../../auth/store/login.store";
import { logoutAPI } from "../../auth/api/login.api";
import { disconnectSocket } from "../../utils/socket";
import {useUnreadStore} from "../../store/unreadStore";
import {getPrivacySettings, updatePrivacySettings, getBlockedUsers, blockUser, unblockUser} from "../../services/UserAPI/api";
import type {BlockedUser, PrivacySettings} from "../../services/UserAPI/api";
import {DEFAULT_NOTIFICATION_PREFERENCES, getNotificationPreferences, subscribeNotificationPreferences, updateNotificationPreferences} from "../../services/notificationPreferences";
import type {NotificationPreferences} from "../../services/notificationPreferences";
import constants from '../../contents/Api_URL';
import FriendInviteModal from '../../components/FriendInviteModal';


type Props = {
  onLogout: () => void;
};

export default function UserScreen({ onLogout }: Props) {
  const navigation = useNavigation<any>();
  const [searchValue, setSearchValue] = useState("");
  const auth = useAuthStore(state => state.auth);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacySettings>({allowAccountDiscovery: true, allowFriendRequests: true, allowMessagesFromNonFriends: true, allowCallsFromNonFriends: true});
  const [blockedVisible, setBlockedVisible] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedUsername, setBlockedUsername] = useState("");
  const [accountVisible, setAccountVisible] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const accountId = String(auth?.user?.username || '');

  React.useEffect(() => {
    setNotificationPreferences(getNotificationPreferences(accountId));
    if (!accountId) return undefined;
    return subscribeNotificationPreferences((changedAccountId, preferences) => {
      if (changedAccountId === accountId) setNotificationPreferences(preferences);
    });
  }, [accountId]);

  const changeNotificationPreference = (key: keyof NotificationPreferences, value: boolean) => {
    setNotificationPreferences(updateNotificationPreferences(accountId, {[key]: value}));
  };

  const openPrivacy = async () => {
    setPrivacyVisible(true);
    setPrivacyLoading(true);
    try { setPrivacy(await getPrivacySettings()); }
    catch { Alert.alert("Không thể tải cài đặt", "Vui lòng kiểm tra kết nối và thử lại."); }
    finally { setPrivacyLoading(false); }
  };
  const changePrivacy = async (key: keyof PrivacySettings, value: boolean) => {
    const previous = privacy;
    const next = {...privacy, [key]: value};
    setPrivacy(next);
    setPrivacySaving(true);
    try { setPrivacy(await updatePrivacySettings({[key]: value})); }
    catch (error: any) {
      setPrivacy(previous);
      Alert.alert("Không thể lưu cài đặt", error?.response?.data?.error || "Vui lòng thử lại.");
    } finally { setPrivacySaving(false); }
  };
  const openBlockedUsers = async () => {
    setPrivacyVisible(false);
    setBlockedVisible(true);
    setBlockedLoading(true);
    try { setBlockedUsers(await getBlockedUsers()); }
    catch { Alert.alert("Không thể tải danh sách", "Vui lòng kiểm tra kết nối và thử lại."); }
    finally { setBlockedLoading(false); }
  };
  const addBlockedUser = async () => {
    const username = blockedUsername.trim();
    if (!username) return;
    setBlockedLoading(true);
    try { setBlockedUsers(await blockUser(username)); setBlockedUsername(""); }
    catch (error: any) { Alert.alert("Không thể chặn", error?.response?.data?.error || "Kiểm tra tài khoản và thử lại."); }
    finally { setBlockedLoading(false); }
  };
  const removeBlockedUser = async (username: string) => {
    setBlockedLoading(true);
    try { setBlockedUsers(await unblockUser(username)); }
    catch { Alert.alert("Không thể bỏ chặn", "Vui lòng thử lại."); }
    finally { setBlockedLoading(false); }
  };

  React.useEffect(() => {
    const fetchUser = async () => {
      if (auth?.user?.username) {
        const info = await require('../../services/UserAPI/api').layNhanVienTheoId(auth.user.username);
        setUserInfo(info);
      }
    };
    fetchUser();
  }, [auth]);
  const doLogout = async () => {
    const username = auth?.user?.username;
    if (username) void logoutAPI(username, auth?.token);
    useUnreadStore.getState().clearUnreadCounts();
    useAuthStore.getState().logout();
    disconnectSocket();
    await removeToken();
    if (onLogout) onLogout();
  };

  const handleLogout = () => {
    Alert.alert(
      "Xác nhận đăng xuất",
      "Bạn có chắc chắn muốn đăng xuất?",
      [
        { text: "Hủy", style: "cancel" },
        { text: "Đăng xuất", style: "destructive", onPress: doLogout }
      ]
    );
  };

  // Các mục chức năng như Zalo
  const openAccountDetails = () => setAccountVisible(true);
  const openHiddenChats = () => navigation.navigate("ChatList", {screen: "HiddenChats"});
  const openAppSettings = () => setSettingsVisible(true);
  const openHelp = () => setHelpVisible(true);

  const sections = [
    {
      key: "account",
      icon: "user",
      title: "Tài khoản",
      description: "Quản lý thông tin cá nhân & đăng nhập",
      onPress: openAccountDetails,
    },
    {
      key: "friendInvite",
      icon: "qrcode",
      title: "Mã QR kết bạn",
      description: "Chia sẻ mã hoặc liên kết để bạn bè tìm bạn",
      onPress: () => setInviteVisible(true),
    },
    {
      key: "security",
      icon: "lock",
      title: "Bảo mật",
      description: "Cài đặt mật khẩu, xác thực",
      onPress: openHiddenChats,
    },
    {
      key: "settings",
      icon: "cog",
      title: "Cài đặt",
      description: "Tuỳ chỉnh ứng dụng",
      onPress: openAppSettings,
    },
    {
      key: "storage",
      icon: "database",
      title: "Vị trí lưu trữ",
      description: "Mở thông tin nơi dữ liệu được đồng bộ",
      onPress: () => {
        void Linking.openURL(constants.API_URLS.STORAGE_INFO)
          .catch(() => Alert.alert("Không thể mở thông tin lưu trữ", "Vui lòng thử lại khi có kết nối internet."));
      },
    },
    {
      key: "privacy",
      icon: "eye",
      title: "Quyền riêng tư",
      description: "Tìm kiếm tài khoản và lời mời kết bạn",
      onPress: openPrivacy,
    },
    {
      key: "help",
      icon: "question-circle",
      title: "Trợ giúp",
      description: "Hướng dẫn và hỗ trợ",
      onPress: openHelp,
    },
    {
      key: "logout",
      icon: "sign-out",
      title: "Đăng xuất",
      description: "",
      onPress: () => {
        handleLogout();
      },
    },
  ];

  return (
    <ScrollView style={styles.container}>
      {/* Header tìm kiếm với icon bánh răng bên phải */}
      <SearchHeader
        rightType="user"
        searchValue={searchValue}
        setSearchValue={setSearchValue}
        onRightPress={() => {
          openPrivacy();
        }}
      />
      <View style={styles.topSection}>
        <Image
          source={{
            uri:
              userInfo?.avatar && userInfo.avatar.startsWith('data:image')
                ? userInfo.avatar
                : userInfo?.avatar
                  ? `data:image/png;base64,${userInfo.avatar}`
                  : 'https://i.pravatar.cc/150?u=' + (auth?.user?.username || 'default')
          }}
          style={styles.avatar}
        />
        <Text style={styles.phone}>{userInfo?.tenNhanVien}</Text>
      </View>
      <View style={styles.sectionList}>
        {sections.map((item) => (
          <TouchableOpacity key={item.key} style={styles.sectionRow} onPress={item.onPress} activeOpacity={0.7}>
            <View style={styles.sectionIconWrap}>
              <Icon name={item.icon} size={22} color="#2179ee" />
            </View>
            <View style={styles.sectionContent}>
              <Text style={styles.sectionTitle}>{item.title}</Text>
              {!!item.description && <Text style={styles.sectionDesc}>{item.description}</Text>}
            </View>
            <Icon name="chevron-right" size={18} color="#bbb" />
          </TouchableOpacity>
        ))}
      </View>
      <FriendInviteModal visible={inviteVisible} username={accountId} onClose={() => setInviteVisible(false)} />
      <Modal visible={accountVisible} transparent animationType="slide" onRequestClose={() => setAccountVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.privacySheet}>
            <View style={styles.privacyHeader}><Text style={styles.privacyTitle}>Tài khoản</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng thông tin tài khoản" onPress={() => setAccountVisible(false)} style={styles.closeButton}><Icon name="times" size={18} color="#66727e" /></TouchableOpacity></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Tên hiển thị</Text><Text style={styles.privacyDescription}>{userInfo?.tenNhanVien || auth?.user?.name || 'Chưa cập nhật'}</Text></View></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Tài khoản đăng nhập</Text><Text style={styles.privacyDescription}>{auth?.user?.username || '—'}</Text></View></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Mã người dùng</Text><Text style={styles.privacyDescription}>{auth?.user?.id || '—'}</Text></View></View>
          </View>
        </View>
      </Modal>
      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.privacySheet, {maxHeight: '85%'}]}>
            <View style={styles.privacyHeader}><Text style={styles.privacyTitle}>Cài đặt ứng dụng</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng cài đặt" onPress={() => setSettingsVisible(false)} style={styles.closeButton}><Icon name="times" size={18} color="#66727e" /></TouchableOpacity></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Thông báo tin nhắn</Text><Text style={styles.privacyDescription}>Nhận thông báo khi có tin nhắn mới ngoài cuộc trò chuyện đang mở.</Text></View><Switch value={notificationPreferences.enabled} onValueChange={value => changeNotificationPreference('enabled', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={notificationPreferences.enabled ? '#2179ee' : '#f4f5f6'} /></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Âm thanh</Text><Text style={styles.privacyDescription}>Phát âm báo khi nhận tin nhắn.</Text></View><Switch value={notificationPreferences.soundEnabled} disabled={!notificationPreferences.enabled} onValueChange={value => changeNotificationPreference('soundEnabled', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={notificationPreferences.soundEnabled ? '#2179ee' : '#f4f5f6'} /></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Rung</Text><Text style={styles.privacyDescription}>Rung nhẹ khi có tin nhắn mới.</Text></View><Switch value={notificationPreferences.vibrationEnabled} disabled={!notificationPreferences.enabled} onValueChange={value => changeNotificationPreference('vibrationEnabled', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={notificationPreferences.vibrationEnabled ? '#2179ee' : '#f4f5f6'} /></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Hiện nội dung tin nhắn</Text><Text style={styles.privacyDescription}>Tắt để thông báo chỉ hiện “Bạn có tin nhắn mới”.</Text></View><Switch value={notificationPreferences.previewEnabled} disabled={!notificationPreferences.enabled} onValueChange={value => changeNotificationPreference('previewEnabled', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={notificationPreferences.previewEnabled ? '#2179ee' : '#f4f5f6'} /></View>
            <Text style={styles.privacyDescription}>Cài đặt được lưu riêng cho tài khoản này trên thiết bị.</Text>
          </View>
        </View>
      </Modal>
      <Modal visible={helpVisible} transparent animationType="slide" onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.privacySheet}>
            <View style={styles.privacyHeader}><Text style={styles.privacyTitle}>Trợ giúp</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng trợ giúp" onPress={() => setHelpVisible(false)} style={styles.closeButton}><Icon name="times" size={18} color="#66727e" /></TouchableOpacity></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Tin nhắn chưa đồng bộ?</Text><Text style={styles.privacyDescription}>Kéo xuống danh sách để tải lại. Tin nhắn đang gửi sẽ có biểu tượng trạng thái và nút thử lại.</Text></View></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Gửi ảnh, tệp hoặc vị trí</Text><Text style={styles.privacyDescription}>Mở dấu cộng cạnh khung nhập tin nhắn để chọn nội dung muốn chia sẻ.</Text></View></View>
            <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Gọi thoại hoặc video</Text><Text style={styles.privacyDescription}>Mở cuộc trò chuyện rồi chọn biểu tượng điện thoại hoặc camera ở thanh trên.</Text></View></View>
          </View>
        </View>
      </Modal>
      <Modal visible={privacyVisible} transparent animationType="slide" onRequestClose={() => setPrivacyVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.privacySheet}>
            <View style={styles.privacyHeader}><Text style={styles.privacyTitle}>Quyền riêng tư</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng quyền riêng tư" onPress={() => setPrivacyVisible(false)} style={styles.closeButton}><Icon name="times" size={18} color="#66727e" /></TouchableOpacity></View>
            {privacyLoading ? <View style={styles.privacyLoading}><ActivityIndicator size="small" color="#2179ee" /></View> : <>
              <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Cho phép tìm thấy tài khoản</Text><Text style={styles.privacyDescription}>Người khác có thể tìm bạn theo tên hoặc tài khoản.</Text></View><Switch value={privacy.allowAccountDiscovery} disabled={privacySaving} onValueChange={value => changePrivacy('allowAccountDiscovery', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={privacy.allowAccountDiscovery ? '#2179ee' : '#f4f5f6'} /></View>
              <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Nhận lời mời kết bạn</Text><Text style={styles.privacyDescription}>Khi tắt, người khác không thể gửi lời mời mới cho bạn.</Text></View><Switch value={privacy.allowFriendRequests} disabled={privacySaving} onValueChange={value => changePrivacy('allowFriendRequests', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={privacy.allowFriendRequests ? '#2179ee' : '#f4f5f6'} /></View>
              <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Nhận tin nhắn từ người lạ</Text><Text style={styles.privacyDescription}>Khi tắt, chỉ bạn bè mới gửi được tin nhắn riêng cho bạn.</Text></View><Switch value={privacy.allowMessagesFromNonFriends} disabled={privacySaving} onValueChange={value => changePrivacy('allowMessagesFromNonFriends', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={privacy.allowMessagesFromNonFriends ? '#2179ee' : '#f4f5f6'} /></View>
              <View style={styles.privacyRow}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Nhận cuộc gọi từ người lạ</Text><Text style={styles.privacyDescription}>Khi tắt, chỉ bạn bè mới gọi thoại hoặc video riêng cho bạn.</Text></View><Switch value={privacy.allowCallsFromNonFriends} disabled={privacySaving} onValueChange={value => changePrivacy('allowCallsFromNonFriends', value)} trackColor={{false: '#cbd2d9', true: '#9fc8ff'}} thumbColor={privacy.allowCallsFromNonFriends ? '#2179ee' : '#f4f5f6'} /></View>
              <TouchableOpacity style={styles.privacyRow} onPress={openBlockedUsers} activeOpacity={0.7}><View style={styles.privacyText}><Text style={styles.privacyLabel}>Danh sách chặn</Text><Text style={styles.privacyDescription}>Quản lý tài khoản không thể nhắn tin hoặc gọi riêng cho bạn.</Text></View><Icon name="chevron-right" size={15} color="#9aa5af" /></TouchableOpacity>
              {privacySaving && <View style={styles.savingRow}><ActivityIndicator size="small" color="#2179ee" /><Text style={styles.savingText}>Đang lưu thay đổi...</Text></View>}
            </>}
          </View>
        </View>
      </Modal>
      <Modal visible={blockedVisible} transparent animationType="slide" onRequestClose={() => setBlockedVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.privacySheet}>
            <View style={styles.privacyHeader}><Text style={styles.privacyTitle}>Danh sách chặn</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng danh sách chặn" onPress={() => setBlockedVisible(false)} style={styles.closeButton}><Icon name="times" size={18} color="#66727e" /></TouchableOpacity></View>
            <Text style={{fontSize: 13, color: '#7d8994', lineHeight: 18, marginBottom: 12}}>Nhập tài khoản để chặn tin nhắn riêng và cuộc gọi. Tin nhắn nhóm vẫn hoạt động.</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 14}}>
              <TextInput value={blockedUsername} onChangeText={setBlockedUsername} autoCapitalize="none" placeholder="Tài khoản người dùng" style={{flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#dce2e8', paddingHorizontal: 12, color: '#263442'}} />
              <TouchableOpacity onPress={addBlockedUser} disabled={blockedLoading || !blockedUsername.trim()} style={{height: 44, marginLeft: 8, borderRadius: 12, backgroundColor: '#2179ee', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', opacity: blockedLoading || !blockedUsername.trim() ? 0.55 : 1}}><Text style={{color: '#fff', fontWeight: '700'}}>Chặn</Text></TouchableOpacity>
            </View>
            {blockedLoading ? <View style={styles.privacyLoading}><ActivityIndicator size="small" color="#2179ee" /></View> : blockedUsers.length ? blockedUsers.map(user => <View key={user.username} style={{minHeight: 58, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e5e9ed'}}><View style={{flex: 1}}><Text style={{fontSize: 14, fontWeight: '600', color: '#263442'}}>{user.name}</Text><Text style={{fontSize: 12, color: '#7d8994', marginTop: 2}}>{user.username}</Text></View><TouchableOpacity onPress={() => removeBlockedUser(user.username)}><Text style={{color: '#2179ee', fontWeight: '600', padding: 8}}>Bỏ chặn</Text></TouchableOpacity></View>) : <Text style={{color: '#8994a0', textAlign: 'center', paddingVertical: 24}}>Chưa có tài khoản nào bị chặn</Text>}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
