import React, {useMemo} from 'react';
import {Alert, Modal, Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import qrcode from 'qrcode-generator';

type Props = {visible: boolean; groupName: string; link: string; onClose: () => void};

export default function GroupInviteModal({visible, groupName, link, onClose}: Props) {
  const modules = useMemo(() => {
    if (!link) return [];
    const code = qrcode(0, 'M');
    code.addData(link, 'Byte');
    code.make();
    const count = code.getModuleCount();
    return Array.from({length: count}, (_, row) => Array.from({length: count}, (_, column) => code.isDark(row, column)));
  }, [link]);
  const cellSize = modules.length ? 240 / (modules.length + 8) : 0;

  const shareLink = async () => {
    try { await Share.share({message: `Tham gia nhóm ${groupName} trên MobileChat: ${link}`}); }
    catch { Alert.alert('Không chia sẻ được liên kết', 'Vui lòng thử lại.'); }
  };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={{flex: 1, paddingRight: 12}}>
            <Text style={styles.title}>Mã QR mời vào nhóm</Text>
            <Text style={styles.subtitle}>Bất kỳ ai có liên kết đều có thể tham gia nhóm trong 30 ngày.</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng mã mời nhóm" onPress={onClose} style={styles.close}>
            <Icon name="times" size={18} color="#66727e" />
          </TouchableOpacity>
        </View>
        <View style={styles.qrFrame}>
          {modules.map((row, rowIndex) => <View key={`row-${rowIndex}`} style={{height: cellSize, flexDirection: 'row'}}>
            {row.map((dark, columnIndex) => <View key={`cell-${rowIndex}-${columnIndex}`} style={{width: cellSize, height: cellSize, backgroundColor: dark ? '#152334' : '#fff'}} />)}
          </View>)}
        </View>
        <Text numberOfLines={1} style={styles.groupName}>{groupName}</Text>
        <Text selectable style={styles.link}>{link}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.shareButton} onPress={() => { void shareLink(); }}>
          <Icon name="share-alt" size={16} color="#fff" />
          <Text style={styles.shareText}>Chia sẻ liên kết mời</Text>
        </TouchableOpacity>
        <Text style={styles.note}>Liên kết cũ sẽ được thu hồi khi tạo mã mời mới.</Text>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(16, 28, 43, 0.48)', justifyContent: 'center', paddingHorizontal: 20},
  sheet: {alignItems: 'center', borderRadius: 22, backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20},
  header: {width: '100%', flexDirection: 'row', alignItems: 'flex-start'},
  title: {fontSize: 19, fontWeight: '700', color: '#1c2938'},
  subtitle: {fontSize: 12, lineHeight: 18, color: '#788592', marginTop: 5},
  close: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#f0f3f6', alignItems: 'center', justifyContent: 'center'},
  qrFrame: {width: 240, height: 240, alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: '#fff'},
  groupName: {maxWidth: '100%', fontSize: 16, fontWeight: '700', color: '#1d2732', marginTop: 12},
  link: {fontSize: 10, color: '#748291', marginTop: 5, textAlign: 'center'},
  shareButton: {height: 46, width: '100%', borderRadius: 14, backgroundColor: '#087bfa', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 16},
  shareText: {fontSize: 14, fontWeight: '700', color: '#fff'},
  note: {fontSize: 11, color: '#8793a0', textAlign: 'center', lineHeight: 16, marginTop: 10},
});
