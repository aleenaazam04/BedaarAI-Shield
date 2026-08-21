/**
 * Camera.tsx — Custom Camera wrapper for Bedaar AI.
 *
 * WHY THIS EXISTS:
 * The `Camera` component exported by `react-native-vision-camera-face-detector`
 * imports `useSkiaFrameProcessor` at module level (line 8 of its Camera.tsx).
 * When `@shopify/react-native-skia` is not installed, this import throws a
 * native-level exception that silently kills the JS thread → black screen.
 *
 * Additionally, the library's Camera is a plain function component (NOT wrapped
 * in `React.forwardRef`), so passing a `ref` prop triggers a React warning.
 *
 * THIS COMPONENT:
 * - Uses `React.forwardRef` to properly forward refs to VisionCamera.
 * - Imports `useFaceDetector` from the face-detector package (safe — it only
 *   calls `VisionCameraProxy.initFrameProcessorPlugin`, no Skia involved).
 * - Uses `useFrameProcessor` from react-native-vision-camera (no Skia).
 * - Uses `Worklets` from react-native-worklets-core for async bridging.
 *
 * PROPS:
 *   device              — CameraDevice from useCameraDevice()
 *   isActive            — Whether the camera preview is active
 *   onFacesDetected     — Callback invoked with detected Face[] on JS thread
 *   faceDetectionOptions — ML Kit face detection configuration
 *   + all standard VisionCamera CameraProps (style, etc.)
 */

import React, { useMemo } from 'react';
import {
  Camera as VisionCamera,
  useCameraFormat,
  useFrameProcessor,
  type CameraProps,
  type Frame,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  type Face,
  type FrameFaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { useSharedValue } from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SafeCameraProps extends Omit<CameraProps, 'frameProcessor' | 'pixelFormat'> {
  /** Face detection configuration options. */
  faceDetectionOptions?: FrameFaceDetectionOptions;

  /** Optional custom format filters. Defaults to a low-power, older-device friendly profile. */
  cameraFormatFilters?: any[];

  /**
   * Called on the JS thread whenever faces are detected in a frame.
   * Receives an array of Face objects (empty if no faces found).
   */
  onFacesDetected?: (faces: Face[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const SafeCamera = React.forwardRef<VisionCamera, SafeCameraProps>(
  (
    { faceDetectionOptions, onFacesDetected, format: providedFormat, cameraFormatFilters, ...cameraProps },
    ref,
  ) => {
    // Initialize the ML Kit face detector plugin (safe — no Skia import).
    const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions);

    // Cleanup orientation listeners on unmount (Android only).
    React.useEffect(() => {
      return () => {
        try {
          stopListeners();
        } catch {
          // Swallow — may throw if plugin wasn't initialised.
        }
      };
    }, [stopListeners]);

    // Bridge: call `onFacesDetected` on the JS thread from within the
    // frame processor worklet.  Re-created when the callback changes.
    const runOnJs = useMemo(
      () =>
        Worklets.createRunOnJS(
          (faces: Face[], frame: Frame) => {
            // `frame` parameter is required by the bridge signature but
            // we don't expose it — the callback only needs the faces.
            void frame;
            onFacesDetected?.(faces);
          },
        ),
      [onFacesDetected],
    );

    const formatFilters = useMemo<any[]>(
      () =>
        cameraFormatFilters ?? [
          { fps: 30 },
          { videoResolution: { width: 1280, height: 720 } },
          { videoResolution: 'max' },
        ],
      [cameraFormatFilters],
    );

    const adaptiveFormat = useCameraFormat(cameraProps.device, formatFilters as any);
    const resolvedFormat = providedFormat ?? adaptiveFormat;
    const lastProcessedAt = useSharedValue(0);

    // Frame processor — runs on the Vision Camera worklet thread.
    // detectFaces() is a native worklet call (ML Kit).
    // Results are bridged back to JS via runOnJs.
    //
    // incrementRefCount / decrementRefCount are internal methods on the
    // frame object exposed at the native layer (FrameInternal).  They
    // aren't declared on the public `Frame` TypeScript interface but are
    // available at runtime — the face-detector library uses the same
    // approach.  We cast through `any` to satisfy the compiler.
    const frameProcessor = useFrameProcessor(
      (frame: Frame) => {
        'worklet';
        try {
          const processingTimestamp = Date.now();
          if (processingTimestamp - lastProcessedAt.value < 120) return;
          lastProcessedAt.value = processingTimestamp;

          const faces = (detectFaces as any)(frame) as Face[];
          const internal = frame as any;
          // Keep the frame alive until the JS callback processes it.
          internal.incrementRefCount?.();
          runOnJs(faces, frame).finally(() => {
            'worklet';
            internal.decrementRefCount?.();
          });
        } catch (_err) {
          // Silently skip frames where detection fails.
        }
      },
      [detectFaces, runOnJs, lastProcessedAt],
    );

    return (
      <VisionCamera
        ref={ref}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        format={resolvedFormat}
        {...cameraProps}
      />
    );
  },
);

SafeCamera.displayName = 'SafeCamera';

export default SafeCamera;
