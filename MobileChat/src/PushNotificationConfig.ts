
import PushNotification from "react-native-push-notification";
import Sound from 'react-native-sound';
import { Platform } from 'react-native';

if (Platform.OS === 'ios') {
  PushNotification.configure({
    onNotification: function (notification) {
      console.log("NOTIFICATION:", notification);
    },
    requestPermissions: true, 
  });
}

// Tạo channel cho Android, thêm soundName để có âm thanh
if (Platform.OS === 'android') {
  PushNotification.createChannel(
    {
      channelId: "message-channel",
      channelName: "Message Channel",
      importance: 4,
      vibrate: true,
      soundName: "default", 
    },
    (created) => console.log(`createChannel returned '${created}'`)
  );
}
export function playNotificationSound() {
  const sound = new Sound('ding.mp3', Sound.MAIN_BUNDLE, (error) => {
    if (error) {
      console.log('Lỗi phát âm thanh:', error);
      return;
    }
    sound.play((success) => {
      if (!success) {
        console.log('Không phát được âm thanh');
      }
      sound.release();
    });
  });
}