/**
 * emergencyService.ts
 *
 * Handles the audible siren alarm and emergency communication (call + SMS)
 * for the driver safety app with built-in trigger guards.
 */

import { Linking, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { useSafetyStore } from '../store/useSafetyStore';
import { logIncident } from '../services/storageService';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Safety Flags
// ─────────────────────────────────────────────────────────────────────────────

const SIREN_RESOURCE = 'siren';
const RAW_BASE_URL = 'raw/';

let isProtocolExecuting = false; // Guard against multiple triggers

// ─────────────────────────────────────────────────────────────────────────────
// Lazy Sound Loader & Instances
// ─────────────────────────────────────────────────────────────────────────────

let SoundClass: any = null;
let soundLoadAttempted = false;
let sirenSound: any = null;
let soundInitialised = false;
let soundLoadFailed = false;

function getSoundClass(): any {
  if (SoundClass) return SoundClass;
  if (soundLoadAttempted) return null;

  soundLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SoundClass = require('react-native-sound');
    if (SoundClass?.default) SoundClass = SoundClass.default;
  } catch (err) {
    console.warn('[EmergencyService] react-native-sound not available:', err);
    SoundClass = null;
  }
  return SoundClass;
}

function ensureSoundCategory(): void {
  if (soundInitialised) return;

  const Sound = getSoundClass();
  if (!Sound) return;

  try {
    Sound.setCategory?.('Playback', true);
    soundInitialised = true;
  } catch (err) {
    console.warn('[EmergencyService] Sound.setCategory failed:', err);
  }
}

function ensureSiren(): any {
  if (sirenSound) return sirenSound;
  if (soundLoadFailed) return null;

  const Sound = getSoundClass();
  if (!Sound) {
    soundLoadFailed = true;
    return null;
  }

  ensureSoundCategory();

  try {
    sirenSound = new Sound(SIREN_RESOURCE, RAW_BASE_URL, (error: any) => {
      if (error) {
        console.warn('[EmergencyService] Failed to load siren.mp3:', error?.message ?? error);
        sirenSound = null;
        soundLoadFailed = true;
      }
    });
  } catch (err) {
    console.warn('[EmergencyService] Sound constructor threw:', err);
    soundLoadFailed = true;
    return null;
  }

  return sirenSound;
}

// ─────────────────────────────────────────────────────────────────────────────
// Siren Controls
// ─────────────────────────────────────────────────────────────────────────────

export function playSiren(): void {
  if (soundLoadFailed) return;

  const sound = ensureSiren();
  if (!sound) return;

  try {
    sound.setVolume?.(1.0);

    if (Platform.OS === 'android') {
      sound.setCategory?.('Alarm');
    }

    sound.setNumberOfLoops?.(-1);

    sound.play?.((success: boolean) => {
      if (!success) {
        console.warn('[EmergencyService] Siren playback failed.');
      }
    });
  } catch (err) {
    console.warn('[EmergencyService] playSiren error:', err);
  }
}

export function stopSiren(): void {
  try {
    if (sirenSound) {
      sirenSound.stop?.();
      sirenSound.setCurrentTime?.(0);
    }
  } catch (err) {
    console.warn('[EmergencyService] stopSiren error:', err);
  }
}

export function releaseSiren(): void {
  try {
    if (sirenSound) {
      sirenSound.release?.();
      sirenSound = null;
    }
  } catch (err) {
    console.warn('[EmergencyService] releaseSiren error:', err);
    sirenSound = null;
  }
  soundLoadFailed = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Location Helper
// ─────────────────────────────────────────────────────────────────────────────

async function getGoogleMapsUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      Geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          resolve(`https://maps.google.com/maps?q=${latitude},${longitude}`);
        },
        (error) => {
          console.warn('[EmergencyService] GPS location error:', error.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
      );
    } catch (err) {
      console.warn('[EmergencyService] Geolocation not available:', err);
      resolve(null);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency Communication Logic
// ─────────────────────────────────────────────────────────────────────────────

export async function dialEmergency(): Promise<void> {
  const profile = useSafetyStore.getState().driverProfile;
  const guardianPhone = profile?.guardianPhone ?? 'NOT_SET';

  console.warn(`[EmergencyService] 🚨 SIMULATION — target phone: ${guardianPhone}`);

  try {
    await logIncident('impact', {
      reason: `Simulated emergency dispatch — guardian: ${guardianPhone}`,
    });
  } catch (err) {
    console.warn('[EmergencyService] Failed to log simulated dispatch:', err);
  }
}

export async function sendEmergencySMS(): Promise<void> {
  const profile = useSafetyStore.getState().driverProfile;

  if (!profile?.guardianPhone) {
    console.warn('[EmergencyService] No guardian phone number configured.');
    return;
  }

  const driverName = profile.driverName || 'Unknown driver';
  const bloodGroup = profile.bloodGroup || 'N/A';

  const mapsUrl = await getGoogleMapsUrl();
  const locationLine = mapsUrl
    ? `Live Location: ${mapsUrl}\n`
    : 'Live Location: Unavailable — GPS signal lost.\n';

  const body =
    `[DRIVER SAFETY ALERT]\n` +
    `Driver: ${driverName}\n` +
    `Blood Group: ${bloodGroup}\n` +
    `Status: Crash detected — emergency services notified.\n` +
    locationLine +
    `Please contact driver immediately.`;

  try {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${profile.guardianPhone}${separator}body=${encodeURIComponent(body)}`;

    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      console.warn('[EmergencyService] SMS composer not available on this device.');
    }
  } catch (err) {
    console.warn('[EmergencyService] sendEmergencySMS error:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency Protocol Runner (Safeguarded & State Reset)
// ─────────────────────────────────────────────────────────────────────────────

export async function executeEmergencyProtocol(): Promise<void> {
  if (isProtocolExecuting) {
    console.warn('[EmergencyService] Protocol already running, skipping trigger.');
    return;
  }

  isProtocolExecuting = true;

  try {
    stopSiren();
    const mapsUrl = await getGoogleMapsUrl();
    const location = mapsUrl ?? 'GPS unavailable';

    await logIncident('impact', {
      reason: 'Crash detected — countdown expired',
      location,
    });

    await Promise.allSettled([dialEmergency(), sendEmergencySMS()]);
  } catch (err) {
    console.warn('[EmergencyService] Protocol execution failed:', err);
  } finally {
    // FIX: Turn off crash state & reset countdown so screen closes!
    useSafetyStore.getState().setCrashDetected(false);
    useSafetyStore.getState().resetCountdown();

    setTimeout(() => {
      isProtocolExecuting = false;
    }, 5000);
  }
}

export function cancelEmergencyProtocol(): void {
  isProtocolExecuting = false;
  stopSiren();
  useSafetyStore.getState().setCrashDetected(false);
  useSafetyStore.getState().resetCountdown();
}