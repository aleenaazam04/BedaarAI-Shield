/* eslint-env jest */
/* Native-module mocks so the JS render tree can run under Jest. */

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: () => ({ id: 'mock-front', position: 'front' }),
  useCameraPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
  useFrameProcessor: (fn) => fn,
}));

jest.mock('react-native-vision-camera-face-detector', () => ({
  useFaceDetector: () => ({ detectFaces: jest.fn(() => []), stopListeners: jest.fn() }),
}));

jest.mock('react-native-worklets-core', () => ({
  Worklets: { createRunOnJS: (fn) => Object.assign((...a) => Promise.resolve(fn(...a)), { finally: () => {} }) },
}));

jest.mock('react-native-sensors', () => {
  const listeners = [];
  global.__emitAccel = (sample) => listeners.forEach((cb) => cb(sample));
  return {
    accelerometer: {
      subscribe: jest.fn((cb) => {
        listeners.push(cb);
        return { unsubscribe: jest.fn(() => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        }) };
      }),
    },
    setUpdateIntervalForType: jest.fn(),
  };
});

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, Text: require('react-native').Text },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    withRepeat: (v) => v,
    withSequence: (v) => v,
    withTiming: (v) => v,
  };
});
