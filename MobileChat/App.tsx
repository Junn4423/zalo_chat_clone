import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import './src/PushNotificationConfig'; 
import { PermissionsAndroid, Platform } from 'react-native';

async function requestAndroidNotificationPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: 'Quyền thông báo',
        message: 'Ứng dụng cần quyền để gửi thông báo tin nhắn mới',
        buttonPositive: 'OK',
      }
    );
    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Đã cấp quyền thông báo');
    } else {
      console.log('Từ chối quyền thông báo');
    }
  }
}

export default function App() {
  useEffect(() => {
    requestAndroidNotificationPermission();
  }, []);

  return <AppNavigator />;
}