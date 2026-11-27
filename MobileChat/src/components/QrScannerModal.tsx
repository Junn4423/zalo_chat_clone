import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Camera} from 'react-native-camera-kit';
import {openSettings, PERMISSIONS, request, RESULTS} from 'react-native-permissions';
import Icon from 'react-native-vector-icons/FontAwesome';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  onClose: () => void;
  onScan: (value: string) => void;
};

export default function QrScannerModal({visible, onClose, onScan}: Props) {
  const insets = useSafeAreaInsets();
  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [torchOn, setTorchOn] = useState(false);
  const scannedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    scannedRef.current = false;
    setTorchOn(false);
    setPermission('checking');
    const cameraPermission = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
    void request(cameraPermission).then(status => {
      if (active) setPermission(status === RESULTS.GRANTED ? 'granted' : 'denied');
    }).catch(() => {
      if (active) setPermission('denied');
    });
    return () => { active = false; };
  }, [visible]);

  const handleCode = (value?: string) => {
    const code = value?.trim();
    if (!code || scannedRef.current) return;
    scannedRef.current = true;
    onScan(code);
  };

  const requestSettings = () => {
    void openSettings().catch(() => Alert.alert('Không mở được cài đặt', 'Hãy cấp quyền camera trong phần cài đặt ứng dụng.'));
  };

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.screen, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Đóng quét mã QR" onPress={onClose} style={styles.headerButton}>
            <Icon name="times" size={21} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Quét mã QR</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={torchOn ? 'Tắt đèn flash' : 'Bật đèn flash'} onPress={() => setTorchOn(value => !value)} style={styles.headerButton}>
            <Icon name={torchOn ? 'flash' : 'bolt'} size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.cameraArea}>
          {permission === 'granted' ? (
            <Camera
              style={StyleSheet.absoluteFill}
              scanBarcode
              allowedBarcodeTypes={['qr']}
              showFrame
              frameColor="#19c5a2"
              laserColor="#19c5a2"
              torchMode={torchOn ? 'on' : 'off'}
              onReadCode={event => handleCode(event.nativeEvent.codeStringValue)}
              onError={() => Alert.alert('Không mở được camera', 'Kiểm tra quyền camera hoặc đóng ứng dụng khác đang dùng camera.')}
            />
          ) : permission === 'checking' ? (
            <View style={styles.permissionState}><ActivityIndicator color="#fff" size="large" /><Text style={styles.helperText}>Đang kiểm tra quyền camera…</Text></View>
          ) : (
            <View style={styles.permissionState}>
              <Icon name="camera" size={38} color="#fff" />
              <Text style={styles.permissionTitle}>Cần quyền camera</Text>
              <Text style={styles.helperText}>Cho phép MobileChat dùng camera để quét mã QR kết bạn hoặc vào nhóm.</Text>
              <TouchableOpacity style={styles.settingsButton} onPress={requestSettings}><Text style={styles.settingsText}>Mở cài đặt</Text></TouchableOpacity>
            </View>
          )}
        </View>
        <Text style={styles.caption}>Đưa mã QR vào khung quét</Text>
        <Text style={styles.subcaption}>Quét mã kết bạn hoặc mã mời vào nhóm MobileChat</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#101820'},
  header: {height: 56, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  headerButton: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {color: '#fff', fontSize: 17, fontWeight: '700'},
  cameraArea: {flex: 1, margin: 18, borderRadius: 22, overflow: 'hidden', backgroundColor: '#26313d'},
  permissionState: {flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center'},
  permissionTitle: {marginTop: 18, color: '#fff', fontSize: 18, fontWeight: '700'},
  helperText: {marginTop: 12, color: '#d4dce4', fontSize: 14, lineHeight: 20, textAlign: 'center'},
  settingsButton: {marginTop: 20, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: '#087bfa'},
  settingsText: {color: '#fff', fontWeight: '700'},
  caption: {marginTop: 8, color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center'},
  subcaption: {marginTop: 6, marginBottom: 24, color: '#bdc8d3', fontSize: 13, textAlign: 'center'},
});
