/**
 * visionEngine.ts
 *
 * Real-time driver safety monitoring powered by vision-camera-face-detector
 * facial landmarks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Module          │  Trigger condition
 * ─────────────────────────────────────────────────────────────────────────────
 *  Auto-Calibrate  │  30 analyzed frames (3 s at 10 fps) averaged baseline
 *  Fatigue (EAR)   │  EAR < 0.2 for 2.8 s continuously  → DROWSY
 *  Murree  (MAR)   │  MAR > 0.6 more than 3× in 60 s           → OXYGEN DEFICIENCY
 *  Gaze / Head     │  Pitch or Yaw > ±30° from baseline         → DISTRACTION
 *  Night Vision    │  Luminance tracking + auto exposure compensation
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Landmark index map (dlib-68 / vision-camera-face-detector convention):
 *
 *   Left  eye  : 36 = outer corner, 37 = upper-outer lid,
 *                39 = inner corner, 40 = lower-outer lid
 *   Right eye  : 42 = outer corner, 43 = upper-outer lid,
 *                45 = inner corner, 46 = lower-outer lid
 *   Mouth      : 48 = left corner, 54 = right corner,
 *                51 = upper-lip centre, 57 = lower-lip centre
 *   Head pose  : 27 = bridge (between eyes), 30 = nose tip,
 *                 8 = chin
 */

import { useSafetyStore } from '../store/useSafetyStore';
import { logIncident } from '../services/storageService';

// ═══════════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal 3-D point returned by the face-detector landmark pipeline. */
export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/** Raw frame payload fed into `processFrame` every camera tick. */
export interface FrameInput {
  /** 68 (or more) facial landmark points, indexed by convention. */
  landmarks: LandmarkPoint[];

  /**
   * Camera-provided luminance estimate (0 = black, 1 = white).
   * When `undefined` the engine falls back to `frameBrightness`.
   */
  luminance?: number;

  /** Software-side brightness estimate when camera metadata is unavailable. */
  frameBrightness?: number;

  /** Timestamp of the frame; defaults to `Date.now()` if omitted. */
  timestamp?: number;

  /** Explicitly indicates whether a face was present in this frame. */
  isFaceDetected?: boolean;

  // ── Direct metrics from react-native-vision-camera-face-detector ─────────
  // When provided, these take precedence over landmark-based calculations.
  // The ML Kit face detector provides these values natively and they are
  // more accurate than geometric approximations from sparse landmarks.

  /** Left eye open probability (0 = closed, 1 = open). */
  leftEyeOpenProbability?: number;

  /** Right eye open probability (0 = closed, 1 = open). */
  rightEyeOpenProbability?: number;

  /** Mouth open probability (0 = closed, 1 = open). Used as MAR proxy. */
  mouthOpenProbability?: number;

  /** Head pitch angle in degrees (positive = looking up). */
  directPitch?: number;

  /** Head yaw angle in degrees (positive = looking right). */
  directYaw?: number;
}

/**
 * Result returned by every `processFrame` call so the UI layer can react
 * to alerts (e.g. play an audio warning, show a modal) without polling
 * the Zustand store.
 */
export interface FrameResult {
  /** Whether calibration has finished collecting baseline frames. */
  calibrated: boolean;

  /** Calibration progress in the range [0, 1]. */
  calibrationProgress: number;

  /** Current Eye Aspect Ratio (averaged across both eyes). */
  ear: number;

  /** Current Mouth Aspect Ratio. */
  mar: number;

  /** Head pitch in degrees (positive = looking up). */
  pitch: number;

  /** Head yaw in degrees (positive = looking right). */
  yaw: number;

  /** Smoothed luminance value (0–1). */
  luminance: number;

  /** Suggested exposure compensation in EV (–2 … +2). */
  exposureCompensation: number;

  /** True when the driver's eyes have been closed for the continuous threshold. */
  drowsy: boolean;

  /** True on the exact frame a yawning mouth was first detected. */
  yawning: boolean;

  /** True when pitch or yaw exceeds ±30° from baseline. */
  distracted: boolean;

  /** Active alert keys raised during this frame. */
  alerts: AlertType[];
}

export type AlertType = 'drowsy' | 'oxygen_deficiency' | 'distraction';

// ═══════════════════════════════════════════════════════════════════════════════
// Thresholds & Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Auto-calibration window — 3 s at the throttled 10 fps analysis rate. */
const CALIBRATION_FRAME_TARGET = 30;

/** Fixed EAR threshold below which eyes are considered closed. */
const EAR_THRESHOLD = 0.2;

/**
 * Consecutive low-EAR frames required before triggering DROWSY.
 * The time-based guard eliminates normal blinks (~150–250 ms) regardless of
 * the camera's native frame rate.
 */
const DROWSY_CONTINUOUS_MS = 2800;

/** MAR threshold above which the mouth is classified as open / yawning. */
const MAR_YAWN_THRESHOLD = 0.6;

/** Maximum yawns inside the rolling window before raising OXYGEN_DEFICIENCY. */
const YAWN_ALERT_COUNT = 3;

/** Rolling window length for the Murree Protocol (ms). */
const YAWN_WINDOW_MS = 60_000;

/** Pitch or yaw deviation (degrees) from baseline that counts as distraction. */
const DISTRACTION_ANGLE_DEG = 45;
const DISTRACTION_CONTINUOUS_MS = 3000;

/** Exponential-moving-average weight for luminance smoothing. */
const LUMINANCE_EMA_ALPHA = 0.1;

/** Target luminance mid-point used for exposure compensation. */
const LUMINANCE_TARGET = 0.5;

/** Maximum absolute EV compensation the algorithm will recommend. */
const MAX_EXPOSURE_COMPENSATION = 2.0;

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Module State
// ═══════════════════════════════════════════════════════════════════════════════

interface Baseline {
  /** Mean EAR across all calibration frames (driver's normal open-eye EAR). */
  earMean: number;
  /** Mean MAR across all calibration frames (driver's normal closed-mouth MAR). */
  marMean: number;
  /** Neutral head pitch (degrees). */
  pitchNeutral: number;
  /** Neutral head yaw (degrees). */
  yawNeutral: number;
}

// Accumulator used exclusively during the calibration phase.
const calibrationAccumulator = {
  earSum: 0,
  marSum: 0,
  pitchSum: 0,
  yawSum: 0,
  frameCount: 0,
};

let calibrationComplete = false;
let baseline: Baseline = { earMean: 0, marMean: 0, pitchNeutral: 0, yawNeutral: 0 };

// Rolling counter for consecutive low-EAR frames (drowsiness).
let consecutiveLowEarFrames = 0;
let lowEarSince: number | null = null;
let distractedSince: number | null = null;

// Rolling array of yawn onset timestamps (Murree Protocol).
let yawnTimestamps: number[] = [];

let mouthWasOpen = false;

// Luminance tracking state.
let smoothedLuminance = LUMINANCE_TARGET;
let exposureCompensation = 0;

// ═══════════════════════════════════════════════════════════════════════════════
// Euclidean Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function distance2D(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function distance3D(a: LandmarkPoint, b: LandmarkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Dynamic Auto-Calibration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Collect one frame into the calibration accumulator.
 *
 * After exactly `CALIBRATION_FRAME_TARGET` (90) frames the baseline is
 * finalised and the engine switches to live analysis mode.
 *
 * @returns Calibration progress in the range [0, 1]. Returns 1 once done.
 */
export function calibrateBaseline(landmarks: LandmarkPoint[], direct?: {
  ear?: number;
  mar?: number;
  pitch?: number;
  yaw?: number;
}): number {
  if (calibrationComplete) return 1;

  // Prefer direct face-detector values (ML Kit native) over geometric
  // landmark calculations. Named landmarks (LEFT_EYE, NOSE_BASE, etc.)
  // don't map to the dlib-68 numeric index convention.
  const ear = direct?.ear ?? computeEAR(landmarks);
  const mar = direct?.mar ?? computeMAR(landmarks);
  const pitch = direct?.pitch ?? estimateHeadPose(landmarks).pitch;
  const yaw = direct?.yaw ?? estimateHeadPose(landmarks).yaw;

  calibrationAccumulator.earSum += ear;
  calibrationAccumulator.marSum += mar;
  calibrationAccumulator.pitchSum += pitch;
  calibrationAccumulator.yawSum += yaw;
  calibrationAccumulator.frameCount += 1;

  const progress = calibrationAccumulator.frameCount / CALIBRATION_FRAME_TARGET;

  if (calibrationAccumulator.frameCount >= CALIBRATION_FRAME_TARGET) {
    const n = calibrationAccumulator.frameCount;
    baseline = {
      earMean: calibrationAccumulator.earSum / n,
      marMean: calibrationAccumulator.marSum / n,
      pitchNeutral: calibrationAccumulator.pitchSum / n,
      yawNeutral: calibrationAccumulator.yawSum / n,
    };
    calibrationComplete = true;
    useSafetyStore.getState().setCalibrated(true);

    console.log(
      `[VisionEngine] Calibration complete — baseline EAR=${baseline.earMean.toFixed(3)}, ` +
        `MAR=${baseline.marMean.toFixed(3)}, pitch=${baseline.pitchNeutral.toFixed(1)}°, ` +
        `yaw=${baseline.yawNeutral.toFixed(1)}°`,
    );
  }

  return Math.min(progress, 1);
}

/**
 * Discard the current calibration and start a fresh one.
 * Useful when the driver changes seat position or lighting drastically.
 */
export function resetCalibration(): void {
  calibrationComplete = false;
  baseline = { earMean: 0, marMean: 0, pitchNeutral: 0, yawNeutral: 0 };
  Object.assign(calibrationAccumulator, {
    earSum: 0,
    marSum: 0,
    pitchSum: 0,
    yawSum: 0,
    frameCount: 0,
  });
  consecutiveLowEarFrames = 0;
  lowEarSince = null;
  distractedSince = null;
  yawnTimestamps = [];
  mouthWasOpen = false;
  smoothedLuminance = LUMINANCE_TARGET;
  exposureCompensation = 0;
  useSafetyStore.getState().setCalibrated(false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Eye Aspect Ratio (EAR) — Fatigue Monitor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the Eye Aspect Ratio for both eyes and return their average.
 *
 * Formula (Soukupová & Čech, 2016):
 *
 *         |p2 − p6| + |p3 − p5|
 *  EAR = ─────────────────────────
 *         2 · |p1 − p4|
 *
 * Index mapping (0-based into the `landmarks` array):
 *   p1 = 36  (left outer corner)     p4 = 39  (left inner corner)
 *   p2 = 37  (left upper-outer lid)  p5 = 38  (left upper-inner lid)
 *   p3 = 38  → corrected to 37/38    p6 = 40/41 (lower lids)
 *
 * Falls back to a simplified vertical/horizontal ratio when landmark
 * indices exceed the array length (e.g. 5-point detectors).
 */
export function computeEAR(landmarks: LandmarkPoint[]): number {
  // ---------- Left eye (indices 36–41) ----------
  let leftEAR: number;

  if (landmarks.length > 41) {
    const l36 = landmarks[36];
    const l37 = landmarks[37];
    const l38 = landmarks[38];
    const l39 = landmarks[39];
    const l40 = landmarks[40];
    const l41 = landmarks[41];

    const vertical = distance2D(l37, l41) + distance2D(l38, l40);
    const horizontal = distance2D(l36, l39);
    leftEAR = horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  } else if (landmarks.length > 4) {
    // Simplified: vertical between upper-lid and lower-lid / horizontal span
    const vertical = distance2D(landmarks[1], landmarks[3]);
    const horizontal = distance2D(landmarks[0], landmarks[2]);
    leftEAR = horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  } else {
    leftEAR = 0;
  }

  // ---------- Right eye (indices 42–47) ----------
  let rightEAR: number;

  if (landmarks.length > 47) {
    const r42 = landmarks[42];
    const r43 = landmarks[43];
    const r44 = landmarks[44];
    const r45 = landmarks[45];
    const r46 = landmarks[46];
    const r47 = landmarks[47];

    const vertical = distance2D(r43, r47) + distance2D(r44, r46);
    const horizontal = distance2D(r42, r45);
    rightEAR = horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  } else if (landmarks.length > 9) {
    const vertical = distance2D(landmarks[6], landmarks[8]);
    const horizontal = distance2D(landmarks[5], landmarks[7]);
    rightEAR = horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  } else {
    rightEAR = 0;
  }

  return (leftEAR + rightEAR) / 2.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Mouth Aspect Ratio (MAR) — Murree Protocol
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the Mouth Aspect Ratio.
 *
 * Formula:
 *
 *         |upper_lip − lower_lip|
 *  MAR = ─────────────────────────
 *        2 · |left_corner − right_corner|
 *
 * Indices:  48 = left corner, 54 = right corner,
 *           51 = upper-lip centre, 57 = lower-lip centre
 */
export function computeMAR(landmarks: LandmarkPoint[]): number {
  // Full 68-point landmarks available
  if (landmarks.length > 57) {
    const leftCorner = landmarks[48];
    const rightCorner = landmarks[54];
    const upperLip = landmarks[51];
    const lowerLip = landmarks[57];

    const vertical = distance2D(upperLip, lowerLip);
    const horizontal = distance2D(leftCorner, rightCorner);

    return horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  }

  // Fallback: at least 4 mouth-related points provided
  if (landmarks.length > 3) {
    const vertical = distance2D(landmarks[2], landmarks[3]);
    const horizontal = distance2D(landmarks[0], landmarks[1]);
    return horizontal > 0 ? vertical / (2.0 * horizontal) : 0;
  }

  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Head Pose Estimation — Gaze & Distraction
// ═══════════════════════════════════════════════════════════════════════════════

export interface HeadPose {
  /** Degrees. Positive = looking up, negative = looking down. */
  pitch: number;
  /** Degrees. Positive = looking right, negative = looking left. */
  yaw: number;
}

/**
 * Approximate 3-D head pitch and yaw from facial landmarks.
 *
 * Pitch — uses the triangle formed by the eye-bridge (27), nose tip (30),
 *         and chin (8) to estimate the vertical tilt of the head.
 *
 * Yaw   — compares the distances from the nose tip to each eye corner to
 *         detect left/right rotation.
 *
 * These are lightweight geometric approximations suitable for real-time
 * mobile inference.  For higher accuracy, consider a full Perspective-n-Point
 * (PnP) solver with a 3-D face model.
 */
export function estimateHeadPose(landmarks: LandmarkPoint[]): HeadPose {
  // --- Pitch -----------------------------------------------------------------
  let pitch = 0;

  if (landmarks.length > 30) {
    const eyeBridge = landmarks[27];
    const noseTip = landmarks[30];
    const chin = landmarks[8];

    // 3-D vectors from eye-bridge outward
    const vUp = {
      x: eyeBridge.x - chin.x,
      y: eyeBridge.y - chin.y,
      z: eyeBridge.z - chin.z,
    };
    const vNose = {
      x: noseTip.x - eyeBridge.x,
      y: noseTip.y - eyeBridge.y,
      z: noseTip.z - eyeBridge.z,
    };

    const dot = vNose.x * vUp.x + vNose.y * vUp.y + vNose.z * vUp.z;
    const magUp = Math.sqrt(vUp.x ** 2 + vUp.y ** 2 + vUp.z ** 2);
    const magNose = Math.sqrt(vNose.x ** 2 + vNose.y ** 2 + vNose.z ** 2);

    if (magUp > 0 && magNose > 0) {
      const cosAngle = Math.max(-1, Math.min(1, dot / (magUp * magNose)));
      const angle = toDegrees(Math.acos(cosAngle));
      // nose pointing downward relative to bridge → negative pitch (looking down)
      pitch = vNose.y > 0 ? -angle : angle;
    }
  }

  // --- Yaw -------------------------------------------------------------------
  let yaw = 0;

  if (landmarks.length > 45) {
    const leftEyeOuter = landmarks[36];
    const rightEyeOuter = landmarks[45];
    const noseTip = landmarks[30];

    const dLeft = distance3D(noseTip, leftEyeOuter);
    const dRight = distance3D(noseTip, rightEyeOuter);
    const eyeSpan = distance3D(leftEyeOuter, rightEyeOuter);

    if (eyeSpan > 0) {
      // Normalised asymmetry: 0 = centred, ±1 = fully turned
      yaw = toDegrees(Math.atan2(dLeft - dRight, eyeSpan));
    }
  }

  return { pitch, yaw };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Adaptive Night Vision
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ingest a new luminance reading and update the smoothed estimate plus the
 * recommended exposure compensation.
 *
 * The algorithm:
 *   1. Smooths raw luminance with an exponential moving average.
 *   2. Maps the delta (luminance − target) to an EV compensation value.
 *   3. Clamps the result to ±MAX_EXPOSURE_COMPENSATION EV.
 *   4. Switches night mode ON when luminance drops below 0.2.
 */
export function adaptNightVision(rawLuminance: number): {
  luminance: number;
  exposureCompensation: number;
  isNightMode: boolean;
} {
  // 1. Exponential moving average for temporal smoothing
  smoothedLuminance =
    smoothedLuminance + LUMINANCE_EMA_ALPHA * (rawLuminance - smoothedLuminance);

  // 2. Linear mapping of luminance deficit to EV stops
  const rawCompensation = (LUMINANCE_TARGET - smoothedLuminance) * MAX_EXPOSURE_COMPENSATION * 2;
  exposureCompensation = Math.max(
    -MAX_EXPOSURE_COMPENSATION,
    Math.min(MAX_EXPOSURE_COMPENSATION, rawCompensation),
  );

  // 3. Night-mode activation threshold
  const isNightMode = smoothedLuminance < 0.2;
  useSafetyStore.getState().setNightMode(isNightMode);

  return {
    luminance: smoothedLuminance,
    exposureCompensation,
    isNightMode,
  };
}

/**
 * Derive a raw luminance value (0–1) from the camera frame object.
 *
 * Tries (in order):
 *   1. `frame.luminance`       — provided by some camera implementations
 *   2. `frame.brightness`      — alternative key
 *   3. `frame.exposureGain`    — mapped from typical gain range (1–16)
 *   4. Fallback: 0.5 (neutral, no compensation)
 */
export function estimateFrameLuminance(frame: Record<string, unknown>): number {
  if (typeof frame.luminance === 'number') {
    return clamp01(frame.luminance);
  }
  if (typeof frame.brightness === 'number') {
    return clamp01(frame.brightness);
  }
  if (typeof frame.exposureGain === 'number') {
    // Higher gain → darker scene; typical range 1–16
    return clamp01(1.0 - (frame.exposureGain as number) / 16.0);
  }
  return 0.5;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Master Frame Processor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process one camera frame end-to-end.
 *
 * Call this from the Vision Camera frame processor worklet on every tick.
 * During the calibration window (first 30 analyzed frames) only calibration runs;
 * afterwards all detectors are active.
 */
export async function processFrame(frame: FrameInput): Promise<FrameResult> {
  const now = frame.timestamp ?? Date.now();
  const { landmarks } = frame;
  const alerts: AlertType[] = [];

  // ── Core metrics ───────────────────────────────────────────────────────────
  // Prefer direct face-detector values (ML Kit native probabilities / angles)
  // over geometric landmark calculations when available.
  const hasDirectEyeData =
    frame.leftEyeOpenProbability != null && frame.rightEyeOpenProbability != null;
  const rawEar = hasDirectEyeData
    ? (frame.leftEyeOpenProbability! + frame.rightEyeOpenProbability!) / 2.0
    : computeEAR(landmarks);

  const rawMar = frame.mouthOpenProbability != null
    ? frame.mouthOpenProbability
    : computeMAR(landmarks);

  const hasDirectPose = frame.directPitch != null && frame.directYaw != null;
  const pitch = hasDirectPose ? frame.directPitch! : estimateHeadPose(landmarks).pitch;
  const yaw = hasDirectPose ? frame.directYaw! : estimateHeadPose(landmarks).yaw;
  const isFaceDetected = frame.isFaceDetected ?? (hasDirectEyeData || landmarks.length > 0);

  if (!isFaceDetected) {
    consecutiveLowEarFrames = 0;
    lowEarSince = null;
    distractedSince = null;
    useSafetyStore.getState().setDrowsy(false);
    useSafetyStore.getState().setYawning(false);
    useSafetyStore.getState().setDistracted(false);
    return {
      calibrated: calibrationComplete,
      calibrationProgress: Math.min(
        calibrationAccumulator.frameCount / CALIBRATION_FRAME_TARGET,
        1,
      ),
      ear: 0,
      mar: 0,
      pitch: 0,
      yaw: 0,
      luminance: smoothedLuminance,
      exposureCompensation,
      drowsy: false,
      yawning: false,
      distracted: false,
      alerts,
    };
  }

  // Compensate modestly for foreshortening while the driver turns or tilts.
  // This keeps normal all-angle movement from looking like closed eyes or an
  // exaggerated mouth without allowing a missing face to enter the detector.
  const poseMagnitude = Math.min(90, Math.abs(yaw) + Math.abs(pitch));
  const orientationFactor = 1 + (poseMagnitude / 90) * 0.2;
  const ear = rawEar * orientationFactor;
  const mar = rawMar / orientationFactor;

  // ── Calibration gate ───────────────────────────────────────────────────────
  if (!calibrationComplete) {
    const progress = calibrateBaseline(landmarks, { ear, mar, pitch, yaw });
    return {
      calibrated: false,
      calibrationProgress: progress,
      ear: 0,
      mar: 0,
      pitch: 0,
      yaw: 0,
      luminance: smoothedLuminance,
      exposureCompensation,
      drowsy: false,
      yawning: false,
      distracted: false,
      alerts,
    };
  }

  // ── Adaptive night vision ──────────────────────────────────────────────────
  const rawLuminance = frame.luminance ?? frame.frameBrightness ?? 0.5;
  const nightResult = adaptNightVision(rawLuminance);

  // ── Drowsiness (continuous rule) ───────────────────────────────────────────
  // In night mode, relax the EAR threshold slightly because low-light cameras
  // produce noisier landmark data and eyes may appear partially squinted.
  const nightEarAdjustment = nightResult.isNightMode ? -0.03 : 0;
  // Calibrated open-eye EAR is commonly around 0.735-0.957. Keep the relative
  // value available for calibration safety, but never raise the verified
  // drowsiness trigger above the strict EAR < 0.2 requirement.
  const calibratedEarThreshold = baseline.earMean > 0
    ? baseline.earMean * 0.5
    : EAR_THRESHOLD;
  const effectiveEarThreshold = Math.min(
    EAR_THRESHOLD,
    calibratedEarThreshold + nightEarAdjustment,
  );
  let drowsy = false;

  if (ear > 0.05 && ear < effectiveEarThreshold) {
    consecutiveLowEarFrames += 1;
    lowEarSince ??= now;
  } else {
    consecutiveLowEarFrames = 0;
    lowEarSince = null;
  }

  if (lowEarSince != null && now - lowEarSince >= DROWSY_CONTINUOUS_MS) {
    drowsy = true;
    alerts.push('drowsy');
    await logIncident('drowsiness', {
      reason: `EAR=${ear.toFixed(3)} below threshold ${effectiveEarThreshold.toFixed(3)} for ${DROWSY_CONTINUOUS_MS}ms`,
    });
  }

  useSafetyStore.getState().setDrowsy(drowsy);

  // ── Yawning — Murree Protocol (rolling window) ─────────────────────────────
  let yawning = false;

  const yawnThreshold = Math.max(MAR_YAWN_THRESHOLD, baseline.marMean + 0.15);
  const mouthOpen = mar > yawnThreshold;
  if (mouthOpen && !mouthWasOpen) {
    yawning = true;
    yawnTimestamps.push(now);
  }
  mouthWasOpen = mouthOpen;

  // Prune timestamps outside the 60-second rolling window
  yawnTimestamps = yawnTimestamps.filter((t) => now - t < YAWN_WINDOW_MS);

  if (yawnTimestamps.length > YAWN_ALERT_COUNT) {
    alerts.push('oxygen_deficiency');
    await logIncident('yawning', {
      reason: `MAR=${mar.toFixed(3)} > ${yawnThreshold.toFixed(3)} — ${yawnTimestamps.length} yawns in ${YAWN_WINDOW_MS / 1000}s window (Murree Protocol)`,
    });
    console.warn(
      `[VisionEngine] Murree Protocol — OXYGEN DEFICIENCY alert: ` +
        `${yawnTimestamps.length} yawns in ${YAWN_WINDOW_MS / 1000}s window`,
    );
  }

  useSafetyStore.getState().setYawning(yawning);

  // ── Distraction (pitch / yaw deviation from baseline) ──────────────────────
  const pitchDelta = Math.abs(pitch - baseline.pitchNeutral);
  const yawDelta = Math.abs(yaw - baseline.yawNeutral);
  const pitchThreshold = DISTRACTION_ANGLE_DEG;
  const yawThreshold = DISTRACTION_ANGLE_DEG;
  const outsidePoseLimits = pitchDelta > pitchThreshold || yawDelta > yawThreshold;
  if (outsidePoseLimits) {
    distractedSince ??= now;
  } else {
    distractedSince = null;
  }
  const distracted = distractedSince != null && now - distractedSince >= DISTRACTION_CONTINUOUS_MS;

  if (distracted) {
    alerts.push('distraction');
    await logIncident('distraction', {
      reason: `Head tilt pitch=${pitch.toFixed(1)}° yaw=${yaw.toFixed(1)}° exceeded calibrated limits for ${DISTRACTION_CONTINUOUS_MS}ms`,
    });
  }

  useSafetyStore.getState().setDistracted(distracted);

  return {
    calibrated: true,
    calibrationProgress: 1,
    ear,
    mar,
    pitch,
    yaw,
    luminance: nightResult.luminance,
    exposureCompensation: nightResult.exposureCompensation,
    drowsy,
    yawning,
    distracted,
    alerts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Introspection Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Current baseline snapshot (meaningful only after calibration). */
export function getBaseline(): Readonly<Baseline> {
  return { ...baseline };
}

/** Whether calibration has completed. */
export function isCalibrated(): boolean {
  return calibrationComplete;
}

/** Number of yawns recorded inside the current rolling window. */
export function getYawnCount(): number {
  const now = Date.now();
  return yawnTimestamps.filter((t) => now - t < YAWN_WINDOW_MS).length;
}

/**
 * Full engine reset — clears calibration, rolling counters, luminance state,
 * and the safety store flags.
 */
export function resetVisionEngine(): void {
  resetCalibration();
  useSafetyStore.getState().resetSafetyState();
}
