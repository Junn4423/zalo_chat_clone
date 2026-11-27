jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    set() {}
    delete() {}
  },
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/mobilechat-media',
  exists: jest.fn().mockResolvedValue(false),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  downloadFile: jest.fn(() => ({promise: Promise.resolve({statusCode: 200})})),
}));

jest.mock('react-native-push-notification', () => ({
  configure: jest.fn(),
  createChannel: jest.fn(),
  localNotification: jest.fn(),
  cancelLocalNotifications: jest.fn(),
}));

jest.mock('react-native-sound', () => jest.fn().mockImplementation(() => ({
  play: jest.fn(),
  release: jest.fn(),
  setVolume: jest.fn(),
})));

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: jest.fn(() => false),
  pick: jest.fn().mockResolvedValue([]),
  types: {allFiles: '*/*'},
}));

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('react-native-webrtc', () => ({
  mediaDevices: {getUserMedia: jest.fn()},
  MediaStream: jest.fn(),
  RTCIceCandidate: jest.fn(),
  RTCPeerConnection: jest.fn(),
  RTCSessionDescription: jest.fn(),
  RTCView: 'RTCView',
}));
