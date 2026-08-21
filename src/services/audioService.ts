/**
 * audioService.ts
 *
 * Centralizes alarm and assistive-audio behavior for the Bedaar AI shield.
 * This keeps all sound/prompt logic behind a safe, cross-platform wrapper and
 * prevents the app from relying on ad-hoc native calls in each screen.
 */

import { NativeModules, Platform } from 'react-native';
import Tts from 'react-native-tts';

const AndroidAudioManager = NativeModules?.AudioManager ?? null;

export type AudioFocusMode = 'alarm' | 'duck' | 'normal';

export function requestAudioFocus(mode: AudioFocusMode = 'alarm'): boolean {
  if (Platform.OS !== 'android') return true;

  try {
    if (!AndroidAudioManager?.requestAudioFocus) {
      return true;
    }

    const focusType = mode === 'alarm' ? 'STREAM_ALARM' : 'STREAM_MUSIC';
    const result = AndroidAudioManager.requestAudioFocus(focusType, 'AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE');
    return result === true || result === 'AUDIOFOCUS_REQUEST_GRANTED';
  } catch (err) {
    console.warn('[AudioService] requestAudioFocus failed:', err);
    return false;
  }
}

export function abandonAudioFocus(): boolean {
  if (Platform.OS !== 'android') return true;

  try {
    if (!AndroidAudioManager?.abandonAudioFocus) {
      return true;
    }

    const result = AndroidAudioManager.abandonAudioFocus();
    return result === true || result === 'AUDIOFOCUS_REQUEST_FAILED';
  } catch (err) {
    console.warn('[AudioService] abandonAudioFocus failed:', err);
    return false;
  }
}

export function speakAlert(message: string): void {
  if (!message || message.trim().length === 0) return;

  try {
    Tts.stop();
    Tts.speak(message, {
      iosVoiceId: 'com.apple.ttsbundle.Samantha-compact',
      rate: 0.5,
      androidParams: {
        KEY_PARAM_PAN: -1,
        KEY_PARAM_VOLUME: 1.0,
        KEY_PARAM_STREAM: 'STREAM_ALARM',
      } as any,
    });
  } catch (err) {
    console.warn('[AudioService] TTS failed:', err);
  }
}
