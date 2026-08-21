import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  type Permission,
} from 'react-native';

export interface AndroidCompatibilityStatus {
  camera: boolean;
  overlay: boolean;
  accessibility: boolean;
  sms: boolean;
  call: boolean;
  batteryOptimized: boolean;
}

async function requestAndroidPermission(permission: Permission): Promise<boolean> {
  try {
    const result = await PermissionsAndroid.request(permission as Permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.warn('[AndroidCompat] Permission request failed:', error);
    return false;
  }
}

function canDrawOverOtherApps(): boolean {
  if (Platform.OS !== 'android') {
    return true;
  }

  const nativeOverlayPermission = NativeModules.OverlayPermission;
  return Boolean(nativeOverlayPermission?.isGranted === true);
}

export async function ensureAndroidCompatibilityPermissions(): Promise<AndroidCompatibilityStatus> {
  const status: AndroidCompatibilityStatus = {
    camera: true,
    overlay: true,
    accessibility: true,
    sms: true,
    call: true,
    batteryOptimized: false,
  };

  if (Platform.OS !== 'android') {
    return status;
  }

  try {
    status.camera = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
    status.call = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
    status.sms = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.SEND_SMS);

    if (Platform.Version >= 23) {
      // SYSTEM_ALERT_WINDOW is a special app access, not a dangerous runtime
      // permission. Native builds can expose its current state through the
      // optional OverlayPermission module; otherwise guide the user to Settings.
      status.overlay = canDrawOverOtherApps();

    }

    // Accessibility is not a runtime permission and must be enabled manually.
    status.accessibility = true;

    const powerManager = NativeModules.PowerManager;
    if (powerManager?.isPowerSaveMode) {
      status.batteryOptimized = Boolean(await powerManager.isPowerSaveMode());
    }
  } catch (error) {
    console.warn('[AndroidCompat] ensureAndroidCompatibilityPermissions failed:', error);
  }

  return status;
}

