/**
 * HomeScreen.tsx
 *
 * Tesla-inspired driver safety dashboard.
 *
 * ── Full-screen camera with face-detection overlay (SafeCamera — no Skia)
 * ── Floating top metrics bar (EAR · MAR · Head Angle · Calibration)
 * ── Hazard warning cards (Drowsy · Yawning · Distracted · Night Mode)
 * ── Emergency crash modal with 10-second "I AM OK" countdown
 * ── Accelerometer-based crash / impact detection (Feature 5)
 * ── Slide-in settings drawer for driver profile
 * ── Language switch (English / Urdu) persisted to AsyncStorage
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import type { Face } from 'react-native-vision-camera-face-detector';
import { accelerometer, setUpdateIntervalForType } from 'react-native-sensors';
import { Subscription } from 'rxjs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import SafeCamera from '../components/Camera';
import { useSafetyStore } from '../store/useSafetyStore';
import { useI18nStore, type Language, type TranslationKey } from '../store/useI18nStore';
import {
  processFrame,
  resetVisionEngine,
  type FrameResult,
} from '../utils/visionEngine';
import {
  fetchDriverProfile,
  saveDriverProfile,
  validateGuardianPhone,
  type DriverProfile,
} from '../services/storageService';
import {
  playSiren,
  stopSiren,
  releaseSiren,
  executeEmergencyProtocol,
} from '../services/emergencyService';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — Tesla-dark palette
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: '#000000',
  surface: '#111111',
  surfaceElevated: '#1A1A1A',
  border: '#2A2A2A',
  borderLight: '#3A3A3A',
  text: '#FFFFFF',
  textSecondary: '#8A8A8A',
  textMuted: '#555555',
  accent: '#00D4FF',
  success: '#00E676',
  warning: '#FFAB00',
  danger: '#FF1744',
  dangerDark: '#8B0000',
  overlayBg: 'rgba(0, 0, 0, 0.75)',
} as const;

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = SCREEN_W * 0.85;

const BLOOD_GROUPS = [
  'A+', 'A\u2212', 'B+', 'B\u2212',
  'AB+', 'AB\u2212', 'O+', 'O\u2212',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Accelerometer crash-detection constants (Feature 5)
// ─────────────────────────────────────────────────────────────────────────────

/** Impact threshold as a multiple of the resting gravity baseline. */
const CRASH_RATIO_THRESHOLD = 4.0;

const BASELINE_WARMUP_SAMPLES = 20;
const BASELINE_EMA_ALPHA = 0.05;

/** Consecutive over-threshold samples required to confirm an impact. */
const CRASH_CONFIRM_SAMPLES = 2;

/** Sensor sampling interval in ms (10 Hz). */
const ACCEL_UPDATE_INTERVAL_MS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Metrics display snapshot (updated per frame via bridge)
// ─────────────────────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  ear: number;
  mar: number;
  pitch: number;
  yaw: number;
  luminance: number;
  exposureCompensation: number;
  calibrationProgress: number;
  calibrated: boolean;
}

const DEFAULT_METRICS: MetricsSnapshot = {
  ear: 0,
  mar: 0,
  pitch: 0,
  yaw: 0,
  luminance: 0.5,
  exposureCompensation: 0,
  calibrationProgress: 0,
  calibrated: false,
};

// ═════════════════════════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════════════════════════

export default function HomeScreen() {
  // ── i18n ────────────────────────────────────────────────────────────────
  const t = useI18nStore((s) => s.t);
  const language = useI18nStore((s) => s.language);
  const setLanguageAction = useI18nStore((s) => s.setLanguage);
  const [showLangModal, setShowLangModal] = useState(false);

  // ── Camera ──────────────────────────────────────────────────────────────
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<any>(null);

  // ── Safety store ────────────────────────────────────────────────────────
  const isDrowsy = useSafetyStore((s: { isDrowsy: boolean }) => s.isDrowsy);
  const isYawning = useSafetyStore((s: { isYawning: boolean }) => s.isYawning);
  const isDistracted = useSafetyStore((s: { isDistracted: boolean }) => s.isDistracted);
  const isNightMode = useSafetyStore((s: { isNightMode: boolean }) => s.isNightMode);
  const isCrashDetected = useSafetyStore((s: { isCrashDetected: boolean }) => s.isCrashDetected);
  const countdownTimer = useSafetyStore((s: { countdownTimer: number }) => s.countdownTimer);

  // ── Local UI state ──────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState<MetricsSnapshot>(DEFAULT_METRICS);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Permissions ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasPermission == null || !hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ── Load profile on mount — show onboarding if none exists ─────────────
  useEffect(() => {
    (async () => {
      try {
        const profile = await fetchDriverProfile();
        if (profile) {
          useSafetyStore.getState().setDriverProfile(profile);
        } else {
          // First-time user — force onboarding form
          setShowOnboarding(true);
        }
      } catch (err) {
        console.warn('[HomeScreen] Failed to load driver profile:', err);
        // On error, still show onboarding so user can set up profile
        setShowOnboarding(true);
      }
    })();
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => () => {
    try { releaseSiren?.(); } catch { /* swallow */ }
  }, []);

  // ── Face detection callback (JS thread, called from SafeCamera bridge) ──
  const handleFacesDetected = useCallback(
    (faces: Face[]) => {
      if (faces.length === 0) return;
      const face = faces[0];

      processFrame({
        landmarks: [],
        luminance: 0.5,
        timestamp: Date.now(),
        leftEyeOpenProbability: face.leftEyeOpenProbability,
        rightEyeOpenProbability: face.rightEyeOpenProbability,
        mouthOpenProbability: face.smilingProbability,
        directPitch: face.pitchAngle,
        directYaw: face.yawAngle,
      }).then((result: FrameResult) => {
        setMetrics({
          ear: result.ear,
          mar: result.mar,
          pitch: result.pitch,
          yaw: result.yaw,
          luminance: result.luminance,
          exposureCompensation: result.exposureCompensation,
          calibrationProgress: result.calibrationProgress,
          calibrated: result.calibrated,
        });
      }).catch((err: unknown) => {
        console.warn('[HomeScreen] processFrame error:', err);
      });
    },
    [],
  );

  // ── Language switch handler ─────────────────────────────────────────────
  const handleLanguageSwitch = useCallback(
    (lang: Language) => {
      setLanguageAction(lang);
      setShowLangModal(false);
    },
    [setLanguageAction],
  );

  const toggleLanguage = useCallback(() => {
    setLanguageAction(language === 'en' ? 'ur' : 'en');
  }, [language, setLanguageAction]);

  // ═════════════════════════════════════════════════════════════════════════
  // Accelerometer crash detection (Feature 5)
  // ═════════════════════════════════════════════════════════════════════════

  const crashCooldownRef = useRef<number>(0);
  const CRASH_COOLDOWN_MS = 5000; // 5-second grace period after cancel

  const gravityBaselineRef = useRef<number>(0);
  const baselineSamplesRef = useRef<number>(0);
  const spikeStreakRef = useRef<number>(0);

  useEffect(() => {
    let sub: Subscription | null = null;
    try {
      setUpdateIntervalForType('accelerometer', ACCEL_UPDATE_INTERVAL_MS);
      sub = accelerometer.subscribe(({ x, y, z }: { x: number; y: number; z: number }) => {
        const magnitude = Math.sqrt(x * x + y * y + z * z);

        if (baselineSamplesRef.current < BASELINE_WARMUP_SAMPLES) {
          gravityBaselineRef.current =
            baselineSamplesRef.current === 0
              ? magnitude
              : (gravityBaselineRef.current + magnitude) / 2;
          baselineSamplesRef.current += 1;
          return;
        }

        if (Date.now() < crashCooldownRef.current) return;
        if (useSafetyStore.getState().isCrashDetected) return;

        const baseline = gravityBaselineRef.current || magnitude;
        const ratio = magnitude / baseline;

        if (ratio > 1.8) {
          console.log(
            `[CrashDebug] mag=${magnitude.toFixed(2)} baseline=${baseline.toFixed(2)} ratio=${ratio.toFixed(2)} streak=${spikeStreakRef.current}`,
          );
        }

        if (ratio > CRASH_RATIO_THRESHOLD) {
          spikeStreakRef.current += 1;
          if (spikeStreakRef.current >= CRASH_CONFIRM_SAMPLES) {
            spikeStreakRef.current = 0;
            console.log(`[CrashDebug] FIRING crash — mag=${magnitude.toFixed(2)} ratio=${ratio.toFixed(2)}`);
            useSafetyStore.getState().setCrashDetected(true);
          }
        } else {
          spikeStreakRef.current = 0;
          gravityBaselineRef.current =
            baseline + BASELINE_EMA_ALPHA * (magnitude - baseline);
        }
      });
    } catch (err) {
      console.warn('[HomeScreen] Accelerometer not available:', err);
    }

    return () => { if (sub) sub.unsubscribe(); };
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // Crash / emergency countdown
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (isCrashDetected) {
      useSafetyStore.getState().resetCountdown();
      setShowEmergency(true);
      try { playSiren?.(); } catch (err) {
        console.warn('[HomeScreen] playSiren failed:', err);
      }

      countdownRef.current = setInterval(() => {
        const state = useSafetyStore.getState();
        state.decrementCountdown();

        if (useSafetyStore.getState().countdownTimer <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setShowEmergency(false);

          state.setCrashDetected(false);
          crashCooldownRef.current = Date.now() + CRASH_COOLDOWN_MS;

          executeEmergencyProtocol?.()?.catch?.((err: unknown) => {
            console.warn('[HomeScreen] executeEmergencyProtocol failed:', err);
          });
        }
      }, 1000);
    } else {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setShowEmergency(false);
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isCrashDetected]);

  const handleIAmOK = useCallback(() => {
    try { stopSiren?.(); } catch { /* swallow */ }

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    const store = useSafetyStore.getState();
    store.setCrashDetected(false);
    store.setDrowsy(false);
    store.setYawning(false);
    store.setDistracted(false);
    store.resetCountdown();

    crashCooldownRef.current = Date.now() + CRASH_COOLDOWN_MS;
    setShowEmergency(false);
  }, []);

  const handleSimulateCrash = useCallback(() => {
    useSafetyStore.getState().setCrashDetected(true);
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════════════

  if (hasPermission == null || !hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingTitle}>{t('initializing')}</Text>
        {hasPermission === false && (
          <Pressable style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>{t('grantCameraAccess')}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingTitle}>{t('initializing')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Camera preview ── */}
      <SafeCamera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        exposure={metrics.calibrated ? (metrics.exposureCompensation + 2) / 4 : 0.5}
        faceDetectionOptions={{
          performanceMode: 'fast',
          landmarkMode: 'all',
          contourMode: 'none',
          classificationMode: 'all',
        }}
        onFacesDetected={handleFacesDetected}
      />

      {/* ── Scrim overlay ── */}
      <View style={styles.scrim} />

      {/* ── Top metrics bar ── */}
      <MetricsBar metrics={metrics} isNightMode={isNightMode} t={t} />

      {/* ── Hazard indicators ── */}
      <View style={styles.hazardRow}>
        <HazardBadge label={t('drowsy')} active={isDrowsy} color={C.danger} />
        <HazardBadge label={t('yawn')} active={isYawning} color={C.warning} />
        <HazardBadge label={t('distract')} active={isDistracted} color={C.warning} />
        <HazardBadge label={t('night')} active={isNightMode} color={C.accent} />
      </View>

      {/* ── Language toggle ── */}
      <TouchableOpacity
        style={styles.langToggle}
        onPress={toggleLanguage}
        activeOpacity={0.7}
      >
        <Text style={styles.langToggleText}>
          {language === 'ur' ? 'EN' : '\u0627\u0631\u062F\u0648'}
        </Text>
      </TouchableOpacity>

      {/* ── Bottom toolbar ── */}
      <View style={styles.toolbar}>
        <ToolbarBtn label={t('settings')} onPress={() => setShowDrawer(true)} />
        <ToolbarBtn label={t('recalibrate')} onPress={resetVisionEngine} />
        <ToolbarBtn label={t('testCrash')} onPress={handleSimulateCrash} danger />
      </View>

      {/* ── Emergency modal ── */}
      <Modal
        visible={showEmergency}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
      >
        <EmergencyModal countdown={countdownTimer} onIAmOK={handleIAmOK} t={t} />
      </Modal>

      {/* ── Onboarding modal ── */}
      <OnboardingModal
        visible={showOnboarding}
        onComplete={() => setShowOnboarding(false)}
        t={t}
      />

      {/* ── Settings drawer ── */}
      <SettingsDrawer
        visible={showDrawer}
        onClose={() => setShowDrawer(false)}
        t={t}
      />

      {/* ── Language switch modal ── */}
      <Modal
        visible={showLangModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLangModal(false)}
        statusBarTranslucent
      >
        <View style={styles.langModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowLangModal(false)} />
          <View style={styles.langModalPanel}>
            <Text style={styles.langModalTitle}>{t('selectLanguage')}</Text>
            <Text style={styles.langModalSubtitle}>{'\u0632\u0628\u0627\u0646 \u06A9\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0631\u06CC\u06BA'}</Text>
            <Pressable
              style={[styles.langOptionRow, language === 'en' && styles.langOptionRowActive]}
              onPress={() => handleLanguageSwitch('en')}
            >
              <Text style={styles.langOptionText}>English</Text>
              {language === 'en' && <Text style={styles.langCheck}>✓</Text>}
            </Pressable>
            <Pressable
              style={[styles.langOptionRow, language === 'ur' && styles.langOptionRowActive]}
              onPress={() => handleLanguageSwitch('ur')}
            >
              <Text style={styles.langOptionText}>{'\u0627\u0631\u062F\u0648 (Urdu)'}</Text>
              {language === 'ur' && <Text style={styles.langCheck}>✓</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════════════════════════

function MetricsBar({
  metrics,
  isNightMode,
  t,
}: {
  metrics: MetricsSnapshot;
  isNightMode: boolean;
  t: (key: TranslationKey) => string;
}) {
  return (
    <View style={styles.metricsBar}>
      <MetricTile
        label={t('cal')}
        value={
          metrics.calibrated
            ? t('ready')
            : `${Math.round(metrics.calibrationProgress * 100)}%`
        }
        color={metrics.calibrated ? C.success : C.warning}
      />
      <MetricTile label={t('ear')} value={metrics.ear.toFixed(3)} color={C.accent} />
      <MetricTile label={t('mar')} value={metrics.mar.toFixed(3)} color={C.accent} />
      <MetricTile
        label={t('head')}
        value={`${metrics.pitch.toFixed(0)}\u00B0 / ${metrics.yaw.toFixed(0)}\u00B0`}
        color={C.accent}
      />
      {isNightMode && (
        <MetricTile label={t('lux')} value={metrics.luminance.toFixed(2)} color={C.warning} />
      )}
    </View>
  );
}

function MetricTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function HazardBadge({
  label,
  active,
  color,
}: {
  label: string;
  active: boolean;
  color: string;
}) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (active) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 400 }),
          withTiming(1, { duration: 400 }),
        ),
        -1,
      );
    } else {
      opacity.value = 1;
    }
  }, [active, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: active ? opacity.value : 0.25,
  }));

  return (
    <Animated.View
      style={[
        styles.badge,
        { borderColor: active ? color : C.border },
        active && { backgroundColor: color + '22' },
        animStyle,
      ]}
    >
      <Text style={[styles.badgeText, { color: active ? color : C.textMuted }]}>
        {label}
      </Text>
      <View
        style={[
          styles.badgeDot,
          { backgroundColor: active ? color : C.textMuted },
        ]}
      />
    </Animated.View>
  );
}

function ToolbarBtn({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.toolbarBtn, danger && styles.toolbarBtnDanger]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.toolbarBtnText, danger && styles.toolbarBtnTextDanger]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function EmergencyModal({
  countdown,
  onIAmOK,
  t,
}: {
  countdown: number;
  onIAmOK: () => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <View style={styles.emergencyRoot}>
      <View style={styles.emergencyPulse} />
      <View style={styles.emergencyContent}>
        <Text style={styles.emergencyIcon}>{'\u26A0'}</Text>
        <Text style={styles.emergencyTitle}>{t('crashDetected')}</Text>
        <Text style={styles.emergencySubtitle}>
          {t('emergencyContactIn')}
        </Text>

        <Text style={styles.emergencyCountdown}>{countdown}</Text>
        <Text style={styles.emergencySeconds}>{t('seconds')}</Text>

        <Pressable style={styles.iAmOkBtn} onPress={onIAmOK}>
          <Text style={styles.iAmOkText}>{t('iAmOk')}</Text>
        </Pressable>

        <Text style={styles.emergencyHint}>
          {t('tapToCancel')}
        </Text>
      </View>
    </View>
  );
}

function SettingsDrawer({
  visible,
  onClose,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  const profile = useSafetyStore((s: { driverProfile: DriverProfile | null }) => s.driverProfile);
  const language = useI18nStore((s) => s.language);
  const setLanguageAction = useI18nStore((s) => s.setLanguage);

  const [name, setName] = useState('');
  const [blood, setBlood] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible && profile) {
      setName(profile.driverName);
      setBlood(profile.bloodGroup);
      setPhone(profile.guardianPhone);
    }
    setPhoneError('');
    setSaved(false);
  }, [visible, profile]);

  const handleSave = useCallback(async () => {
    if (!validateGuardianPhone(phone)) {
      setPhoneError(t('phoneError'));
      return;
    }
    setPhoneError('');

    const updated: DriverProfile = {
      driverName: name.trim(),
      bloodGroup: blood,
      guardianPhone: phone.trim(),
    };

    await saveDriverProfile(updated);
    useSafetyStore.getState().setDriverProfile(updated);
    setSaved(true);
    setTimeout(onClose, 800);
  }, [name, blood, phone, onClose, t]);

  const handleLanguageSwitch = useCallback(
    (lang: Language) => {
      setLanguageAction(lang);
    },
    [setLanguageAction],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.drawerBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.drawerPanel}>
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerTitle}>{t('driverProfile')}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.drawerClose}>{'\u2715'}</Text>
            </Pressable>
          </View>

          <View style={styles.drawerBody}>
            <FieldLabel text={t('language')} />
            <View style={styles.langRow}>
              <Pressable
                style={[styles.langChip, language === 'en' && styles.langChipActive]}
                onPress={() => handleLanguageSwitch('en')}
              >
                <Text style={[styles.langChipText, language === 'en' && styles.langChipTextActive]}>
                  English
                </Text>
              </Pressable>
              <Pressable
                style={[styles.langChip, language === 'ur' && styles.langChipActive]}
                onPress={() => handleLanguageSwitch('ur')}
              >
                <Text style={[styles.langChipText, language === 'ur' && styles.langChipTextActive]}>
                  {'\u0627\u0631\u062F\u0648'}
                </Text>
              </Pressable>
            </View>

            <FieldLabel text={t('driverName')} />
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(text: string) => setName(text)}
              placeholder={t('namePlaceholder')}
              placeholderTextColor={C.textMuted}
            />

            <FieldLabel text={t('bloodGroup')} />
            <View style={styles.bloodRow}>
              {BLOOD_GROUPS.map((bg) => (
                <Pressable
                  key={bg}
                  style={[
                    styles.bloodChip,
                    blood === bg && styles.bloodChipActive,
                  ]}
                  onPress={() => setBlood(bg)}
                >
                  <Text
                    style={[
                      styles.bloodChipText,
                      blood === bg && styles.bloodChipTextActive,
                    ]}
                  >
                    {bg}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FieldLabel text={t('guardianPhone')} />
            <TextInput
              style={[styles.input, phoneError ? styles.inputError : null]}
              value={phone}
              onChangeText={(text: string) => {
                setPhone(text.replace(/\D/g, '').slice(0, 11));
                setPhoneError('');
              }}
              placeholder={t('phonePlaceholder')}
              placeholderTextColor={C.textMuted}
              keyboardType="number-pad"
              maxLength={11}
            />
            {phoneError ? (
              <Text style={styles.fieldError}>{phoneError}</Text>
            ) : null}

            <Pressable style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>
                {saved ? t('saved') : t('saveProfile')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function OnboardingModal({
  visible,
  onComplete,
  t,
}: {
  visible: boolean;
  onComplete: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [name, setName] = useState('');
  const [blood, setBlood] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const handleSave = useCallback(async () => {
    if (!name.trim() || !blood || !phone.trim()) {
      setError(t('onboardingRequired'));
      return;
    }
    if (!validateGuardianPhone(phone)) {
      setError(t('onboardingPhoneError'));
      return;
    }

    setError('');

    const profile: DriverProfile = {
      driverName: name.trim(),
      bloodGroup: blood,
      guardianPhone: phone.trim(),
    };

    try {
      await saveDriverProfile(profile);
      useSafetyStore.getState().setDriverProfile(profile);
      onComplete();
    } catch (err) {
      setError(t('onboardingPhoneError'));
    }
  }, [name, blood, phone, onComplete, t]);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.onboardingRoot}>
        <View style={styles.onboardingHeader}>
          <Text style={styles.onboardingIcon}>{'\uD83D\uDE97'}</Text>
          <Text style={styles.onboardingTitle}>{t('welcomeTitle')}</Text>
          <Text style={styles.onboardingSubtitle}>{t('welcomeSubtitle')}</Text>
        </View>

        <View style={styles.onboardingForm}>
          <Text style={styles.onboardingLabel}>{t('onboardingName')}</Text>
          <TextInput
            style={styles.onboardingInput}
            value={name}
            onChangeText={(text: string) => {
              setName(text);
              setError('');
            }}
            placeholder={t('namePlaceholder')}
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.onboardingLabel}>{t('onboardingBlood')}</Text>
          <View style={styles.bloodRow}>
            {BLOOD_GROUPS.map((bg) => (
              <Pressable
                key={bg}
                style={[
                  styles.bloodChip,
                  blood === bg && styles.bloodChipActive,
                ]}
                onPress={() => {
                  setBlood(bg);
                  setError('');
                }}
              >
                <Text
                  style={[
                    styles.bloodChipText,
                    blood === bg && styles.bloodChipTextActive,
                  ]}
                >
                  {bg}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.onboardingLabel}>{t('onboardingPhone')}</Text>
          <TextInput
            style={styles.onboardingInput}
            value={phone}
            onChangeText={(text: string) => {
              setPhone(text.replace(/\D/g, '').slice(0, 11));
              setError('');
            }}
            placeholder={t('onboardingPhoneHint')}
            placeholderTextColor={C.textMuted}
            keyboardType="number-pad"
            maxLength={11}
          />

          {error ? (
            <Text style={styles.onboardingError}>{error}</Text>
          ) : null}

          <Pressable style={styles.onboardingBtn} onPress={handleSave}>
            <Text style={styles.onboardingBtnText}>{t('onboardingSave')}</Text>
          </Pressable>

          <Text style={styles.onboardingSkip}>{t('onboardingSkip')}</Text>
        </View>
      </View>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  // Language toggle
  langToggle: {
    position: 'absolute',
    top: 12,
    right: 16,
    backgroundColor: C.overlayBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  langToggleText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Permission
  permissionText: { color: C.text, fontSize: 18 },
  permissionBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: C.accent,
  },
  permissionBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },

  // Metrics bar
  metricsBar: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: C.overlayBg,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  metricTile: { alignItems: 'center' },
  metricLabel: { color: C.textSecondary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  metricValue: { fontSize: 14, fontWeight: '700', marginTop: 2 },

  // Hazards
  hazardRow: {
    position: 'absolute',
    top: 120,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.overlayBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '700', marginRight: 6 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },

  // Toolbar
  toolbar: {
    position: 'absolute',
    bottom: 34,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  toolbarBtn: {
    flex: 1,
    backgroundColor: C.overlayBg,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  toolbarBtnDanger: { borderColor: C.dangerDark, backgroundColor: 'rgba(139,0,0,0.4)' },
  toolbarBtnText: { color: C.text, fontSize: 13, fontWeight: '600' },
  toolbarBtnTextDanger: { color: C.danger },

  // Emergency Modal
  emergencyRoot: {
    flex: 1,
    backgroundColor: C.dangerDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyPulse: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.danger,
    opacity: 0.2,
  },
  emergencyContent: { alignItems: 'center', paddingHorizontal: 32 },
  emergencyIcon: { fontSize: 64, color: C.text, marginBottom: 12 },
  emergencyTitle: { color: C.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  emergencySubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginTop: 8, textAlign: 'center' },
  emergencyCountdown: { color: C.text, fontSize: 88, fontWeight: '900', marginVertical: 10 },
  emergencySeconds: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600', textTransform: 'uppercase' },
  iAmOkBtn: {
    marginTop: 32,
    backgroundColor: C.text,
    paddingHorizontal: 48,
    paddingVertical: 18,
    borderRadius: 36,
    elevation: 8,
  },
  iAmOkText: { color: C.dangerDark, fontSize: 20, fontWeight: '800' },
  emergencyHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 16 },

  // Drawer & Language Modals
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  drawerPanel: {
    width: DRAWER_W,
    height: '100%',
    backgroundColor: C.surface,
    alignSelf: 'flex-end',
    padding: 24,
    borderLeftWidth: 1,
    borderColor: C.border,
  },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  drawerTitle: { color: C.text, fontSize: 20, fontWeight: '700' },
  drawerClose: { color: C.textSecondary, fontSize: 20 },
  drawerBody: { flex: 1 },
  fieldLabel: { color: C.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  input: {
    backgroundColor: C.surfaceElevated,
    color: C.text,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputError: { borderColor: C.danger },
  fieldError: { color: C.danger, fontSize: 12, marginTop: 4 },
  langRow: { flexDirection: 'row', gap: 10 },
  langChip: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: C.surfaceElevated,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  langChipActive: { borderColor: C.accent, backgroundColor: 'rgba(0,212,255,0.1)' },
  langChipText: { color: C.textSecondary, fontWeight: '600' },
  langChipTextActive: { color: C.accent },
  bloodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bloodChip: {
    width: (DRAWER_W - 72) / 4,
    paddingVertical: 8,
    backgroundColor: C.surfaceElevated,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  bloodChipActive: { borderColor: C.accent, backgroundColor: 'rgba(0,212,255,0.15)' },
  bloodChipText: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },
  bloodChipTextActive: { color: C.accent },
  saveBtn: {
    marginTop: 32,
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: C.bg, fontSize: 16, fontWeight: '700' },

  langModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  langModalPanel: { backgroundColor: C.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  langModalTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  langModalSubtitle: { color: C.textSecondary, fontSize: 14, marginBottom: 16 },
  langOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: C.surfaceElevated,
  },
  langOptionRowActive: { borderWidth: 1, borderColor: C.accent },
  langOptionText: { color: C.text, fontSize: 16, fontWeight: '500' },
  langCheck: { color: C.accent, fontSize: 16, fontWeight: '700' },

  // Onboarding Modal
  onboardingRoot: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 28 },
  onboardingHeader: { alignItems: 'center', marginBottom: 28 },
  onboardingIcon: { fontSize: 48, marginBottom: 12 },
  onboardingTitle: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  onboardingSubtitle: { color: C.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6 },
  onboardingForm: { width: '100%' },
  onboardingLabel: { color: C.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  onboardingInput: {
    backgroundColor: C.surfaceElevated,
    color: C.text,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  onboardingError: { color: C.danger, fontSize: 12, marginTop: 8, textAlign: 'center' },
  onboardingBtn: { backgroundColor: C.accent, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  onboardingBtnText: { color: C.bg, fontSize: 16, fontWeight: '700' },
  onboardingSkip: { color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 14 },
});