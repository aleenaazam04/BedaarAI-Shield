import { create } from 'zustand';
import type { DriverProfile } from '../services/storageService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SafetyState {
  /** Stored driver profile (null until loaded / configured). */
  driverProfile: DriverProfile | null;

  /** Whether the camera / detection system has been calibrated. */
  isCalibrated: boolean;

  /** Real-time drowsiness detection flag. */
  isDrowsy: boolean;

  /** Real-time yawning detection flag. */
  isYawning: boolean;

  /** Real-time distraction detection flag. */
  isDistracted: boolean;

  /** Whether night / low-light mode is active. */
  isNightMode: boolean;

  /** Whether a crash / impact has been detected. */
  isCrashDetected: boolean;

  /** Countdown timer in seconds (default 10). */
  countdownTimer: number;
}

export interface SafetyActions {
  setDriverProfile: (profile: DriverProfile | null) => void;
  setCalibrated: (value: boolean) => void;
  setDrowsy: (value: boolean) => void;
  setYawning: (value: boolean) => void;
  setDistracted: (value: boolean) => void;
  setNightMode: (value: boolean) => void;
  setCrashDetected: (value: boolean) => void;
  setCountdownTimer: (seconds: number) => void;
  decrementCountdown: () => void;
  resetCountdown: () => void;
  resetSafetyState: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const COUNTDOWN_DEFAULT = 10;

const initialState: SafetyState = {
  driverProfile: null,
  isCalibrated: false,
  isDrowsy: false,
  isYawning: false,
  isDistracted: false,
  isNightMode: false, // <-- Fixed: Added missing property here
  isCrashDetected: false,
  countdownTimer: COUNTDOWN_DEFAULT,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSafetyStore = create<SafetyState & SafetyActions>()((set: any) => ({
  ...initialState,

  // --- Actions -------------------------------------------------------------

  setDriverProfile: (profile: DriverProfile | null) => set({ driverProfile: profile }),

  setCalibrated: (value: boolean) => set({ isCalibrated: value }),

  setDrowsy: (value: boolean) => set({ isDrowsy: value }),

  setYawning: (value: boolean) => set({ isYawning: value }),

  setDistracted: (value: boolean) => set({ isDistracted: value }),

  setNightMode: (value: boolean) => set({ isNightMode: value }),

  setCrashDetected: (value: boolean) => set({ isCrashDetected: value }),

  setCountdownTimer: (seconds: number) => set({ countdownTimer: seconds }),

  decrementCountdown: () =>
    set((state: SafetyState) => ({
      countdownTimer: Math.max(0, state.countdownTimer - 1),
    })),

  resetCountdown: () => set({ countdownTimer: COUNTDOWN_DEFAULT }),

  resetSafetyState: () =>
    set((state: SafetyState) => ({
      ...initialState,
      isCrashDetected: false,
      isDrowsy: false,
      countdownTimer: COUNTDOWN_DEFAULT,
      driverProfile: state.driverProfile,
    })),
}));