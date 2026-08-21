/**
 * @format
 */

import 'react-native';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as RN from 'react-native';
import { expect, jest, test, beforeEach } from '@jest/globals';

import App from '../App';
import { ensureAndroidCompatibilityPermissions } from '../src/utils/androidCompat';

jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: () => undefined }),
  useCameraDevice: () => ({ id: 'front' }),
  useCameraFormat: () => ({ id: 'default-format' }),
  useFrameProcessor: () => undefined,
  Camera: 'Camera',
}));

jest.mock('react-native-worklets-core', () => ({
  Worklets: {
    createRunOnJS: (fn: any) => fn,
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => [[ '@driver_profile/name', null ], [ '@driver_profile/blood_group', null ], [ '@driver_profile/guardian_phone', null ]]),
    multiSet: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn((_success: unknown, _error: unknown, _options: unknown) => undefined),
    watchPosition: jest.fn(() => 1),
    clearWatch: jest.fn(() => undefined),
  },
}));

jest.mock('react-native-tts', () => ({
  __esModule: true,
  default: {
    getInitStatus: jest.fn(async () => 'ready'),
    setDefaultLanguage: jest.fn(),
    speak: jest.fn(),
    stop: jest.fn(),
    resume: jest.fn(),
    pause: jest.fn(),
  },
}));

jest.mock('react-native-sensors', () => ({
  accelerometer: {
    subscribe: () => ({ unsubscribe: () => undefined }),
  },
  gyroscope: {
    subscribe: () => ({ unsubscribe: () => undefined }),
  },
  setUpdateIntervalForType: () => undefined,
}));

jest.mock('react-native-vision-camera-face-detector', () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders correctly without starting dashboard sensors during setup', async () => {
  let tree: renderer.ReactTestRenderer | undefined;

  await act(async () => {
    tree = renderer.create(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(tree).toBeDefined();
  tree?.unmount();
});

test('requests overlay permission when the app cannot draw over other apps', async () => {
  const requestMock = jest.spyOn(RN.PermissionsAndroid, 'request');
  requestMock.mockResolvedValue(RN.PermissionsAndroid.RESULTS.GRANTED);

  Object.defineProperty(RN.Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  Object.defineProperty(RN.Platform, 'Version', {
    configurable: true,
    value: 33,
  });

  Object.defineProperty(RN.NativeModules, 'OverlayPermission', {
    configurable: true,
    value: { isGranted: false },
  });

  const alertMock = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);

  const status = await ensureAndroidCompatibilityPermissions();

  expect(status.overlay).toBe(false);
  expect(requestMock).not.toHaveBeenCalledWith('android.permission.SYSTEM_ALERT_WINDOW');

  alertMock.mockRestore();
  requestMock.mockRestore();
});
