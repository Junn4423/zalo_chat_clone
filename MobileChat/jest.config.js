module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: [
    'react-native-gesture-handler/jestSetup',
    '<rootDir>/jest.setup.js',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|react-native-gesture-handler|react-native-screens|react-native-safe-area-context|@react-navigation)',
  ],
};
