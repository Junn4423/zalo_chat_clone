import React, {useMemo} from 'react';
import {Alert, Modal, Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import qrcode from 'qrcode-generator';
import {createFriendInviteLink} from '../utils/friendInvite';

type Props = {
  visible: boolean;
  username: string;
  onClose: () => void;
};

export default function FriendInviteModal({visible, username, onClose}: Props) {
  const inviteLink = createFriendInviteLink(username);
  const modules = useMemo(() => {
    if (!username) return [];
    const code = qrcode(0, 'M');
    code.addData(inviteLink, 'Byte');
    code.make();
    const count = code.getModuleCount();
    return Array.from({length: count}, (_, row) =>
      Array.from({length: count}, (_, column) => code.isDark(row, column)),
    );
  }, [inviteLink, username]);
  const cellSize = modules.length ? 252 / (modules.length + 8) : 0;

  const shareInvite = async () => {
    try {
      await Share.share({message: `Kết bạn với ${username} trên MobileChat: ${inviteLink}`});
    } catch {
      Alert.alert('Không thể chia sẻ liên kết', 'Vui lòng thử lại.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <Text style={styles.title}>Mã QR kết bạn</Text>
              <Text style={styles.subtitle}>Quét mã hoặc chia sẻ liên kết để tìm đúng tài khoản</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng mã QR" onPress={onClose} style={styles.close}>
              <Icon name="times" size={18} color="#66727e" />
            </TouchableOpacity>
          </View>
          <View style={styles.qrFrame}>
            {modules.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={{height: cellSize, flexDirection: 'row'}}>
                {row.map((dark, columnIndex) => (
                  <View key={`cell-${rowIndex}-${columnIndex}`} style={{width: cellSize, height: cellSize, backgroundColor: dark ? '#152334' : '#fff'}} />
                ))}
              </View>
            ))}
          </View>
          <Text style={styles.username}>{username}</Text>
          <Text selectable style={styles.link}>{inviteLink}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.shareButton} onPress={shareInvite}>
            <Icon name="share-alt" size={16} color="#fff" />
            <Text style={styles.shareText}>Chia sẻ liên kết</Text>
          </TouchableOpacity>
          <Text style={styles.privacyNote}>Người nhận vẫn cần xác nhận lời mời kết bạn trong ứng dụng.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(16, 28, 43, 0.45)', justifyContent: 'center', paddingHorizontal: 22},
  sheet: {alignItems: 'center', borderRadius: 22, backgroundColor: '#fff', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 22},
  header: {width: '100%', flexDirection: 'row', alignItems: 'flex-start'},
  titleGroup: {flex: 1, paddingRight: 10},
  title: {fontSize: 19, fontWeight: '700', color: '#1c2938'},
  subtitle: {fontSize: 12, lineHeight: 18, color: '#788592', marginTop: 4},
  close: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#f0f3f6', alignItems: 'center', justifyContent: 'center'},
  qrFrame: {width: 252, height: 252, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 18},
  username: {fontSize: 16, fontWeight: '700', color: '#1d2732', marginTop: 14},
  link: {fontSize: 11, color: '#748291', marginTop: 5, textAlign: 'center'},
  shareButton: {height: 46, width: '100%', borderRadius: 14, backgroundColor: '#087bfa', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 18},
  shareText: {fontSize: 14, fontWeight: '700', color: '#fff'},
  privacyNote: {fontSize: 11, color: '#8793a0', textAlign: 'center', lineHeight: 16, marginTop: 12},
});
