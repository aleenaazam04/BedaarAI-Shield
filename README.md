# Bedaar AI Shield

**Bedaar** (بیدار — "awake / alert") is an on-device **driver safety** app for React Native. Using the front camera, ML Kit face detection, and the phone's accelerometer, it watches for drowsiness, yawning, distraction, and crashes — then escalates to an emergency protocol that alerts a guardian with the driver's live location.

Everything runs **locally on the device**. No frames or personal data leave the phone.

---

## Features

| Module | What it does | Trigger |
| --- | --- | --- |
| **Fatigue (EAR)** | Eye Aspect Ratio from eye-open probability | Eyes closed for ~2s → **DROWSY** |
| **Murree Protocol (MAR)** | Mouth Aspect Ratio / yawning frequency | >3 yawns in 60s → **oxygen-deficiency** alert |
| **Distraction** | Head pitch / yaw vs. calibrated baseline | Deviation > ±30° → **DISTRACTED** |
| **Night Vision** | Luminance smoothing + auto exposure compensation | Low light → **NIGHT MODE** |
| **Crash Detection** | Accelerometer G-force impact | > 3.0 G → emergency countdown |
| **Emergency Protocol** | 10s "I AM OK" countdown → siren + SMS/call to guardian with a Google Maps location link | Countdown expires |

Additional:
- **Auto-calibration** — averages a baseline over the first ~90 frames (3s).
- **Driver profile** — name, blood group, guardian phone (11-digit) persisted to AsyncStorage.
- **Black-box log** — append-only incident log stored on device.
- **Bilingual** — English + Urdu (RTL-aware), language persisted across launches.

---

## Tech stack

- **React Native 0.75.5** + TypeScript
- **react-native-vision-camera** + **vision-camera-face-detector** (ML Kit) with a custom Skia-free `SafeCamera` wrapper
- **react-native-worklets-core** / **react-native-reanimated** for frame processing and UI animation
- **react-native-sensors** (accelerometer), **@react-native-community/geolocation** (GPS)
- **zustand** for state (`useSafetyStore`, `useI18nStore`)
- **react-native-sound** (siren)

---

## Project structure

```
App.tsx                         Root: error boundary, language gate, splash
index.js                        Entry point + global error handler
src/
  components/Camera.tsx         SafeCamera — forwardRef VisionCamera wrapper (no Skia)
  screens/HomeScreen.tsx        Dashboard: camera, metrics, hazards, emergency modal
  utils/visionEngine.ts         EAR / MAR / head-pose / night-vision engine
  services/emergencyService.ts  Siren + call + SMS + location
  services/storageService.ts    Driver profile + black-box incident log
  store/useSafetyStore.ts       Real-time safety state
  store/useI18nStore.ts         English / Urdu translations
__tests__/App.test.tsx          Render smoke test
```

---

## Getting started

> Complete the [React Native environment setup](https://reactnative.dev/docs/environment-setup) first (Android SDK / Xcode).

```bash
# 1. Install dependencies
npm install

# 2. iOS only — install pods
cd ios && pod install && cd ..

# 3. Start Metro
npm start

# 4. In a second terminal, build & run
npm run android
# or
npm run ios
```

The app requests **camera**, **location**, and (for the emergency protocol) **SMS/phone** permissions. On first launch you'll pick a language and complete the driver-profile onboarding.

### Testing the crash flow
Use the **Test Crash** button on the dashboard to trigger the emergency countdown without an actual impact.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Metro bundler |
| `npm run android` | Build & launch on Android |
| `npm run ios` | Build & launch on iOS |
| `npm test` | Run the Jest test suite |
| `npm run lint` | Run ESLint |

Type-check with `npx tsc --noEmit`.

---

## Notes

- `emergencyService.ts`'s `dialEmergency()` currently **logs** the dispatch and `sendEmergencySMS()` opens the SMS composer via `Linking` (it does not auto-send). These are intentionally simulation-friendly; wire up `react-native-sms` / `react-native-immediate-phone-call` for fully automatic dispatch.
- The siren expects a `siren` audio resource bundled under the platform's raw resources.
