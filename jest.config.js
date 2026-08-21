module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-reanimated|react-native-vision-camera|react-native-vision-camera-face-detector|react-native-worklets-core|react-native-sensors|@react-native-async-storage|@react-native-community)/)',
  ],
};
