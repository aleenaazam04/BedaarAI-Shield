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

### Prerequisites

- **Node.js ≥ 18** and npm
- **JDK 17+** and the **Android SDK** (via Android Studio) for Android
- **Xcode + CocoaPods** for iOS (macOS only)
- A **physical device** is strongly recommended — the camera, accelerometer, and GPS features don't work on emulators/simulators
- Complete the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) for your platform first

### Run it

```bash
# 1. Clone and enter the project
git clone https://github.com/aleenaazam04/BedaarAI-Shield.git
cd BedaarAI-Shield

# 2. Install JS dependencies
npm install

# 3. iOS only — install native pods
cd ios && pod install && cd ..

# 4. Start the Metro bundler (leave this running in its own terminal)
npm start

# 5. In a SECOND terminal, build and launch on a connected device/emulator
npm run android      # Android
npm run ios          # iOS
```

**Android device checklist:** enable *Developer Options → USB debugging*, connect via USB, and confirm the device shows up with `adb devices` before running `npm run android`.

On first launch the app will:

1. Ask you to **pick a language** (English / Urdu).
2. Request **camera**, **location**, and **SMS/phone** permissions — grant them for full functionality.
3. Walk you through **driver-profile onboarding** (name, blood group, 11-digit guardian phone).

### Verify without a device

```bash
npm test              # Jest render + logic tests
npx tsc --noEmit      # TypeScript type-check
npm run lint          # ESLint
```

### Testing the crash flow

Use the **Test Crash** button on the dashboard to trigger the emergency countdown without an actual impact.

### Troubleshooting

- **Metro cache issues:** `npm start -- --reset-cache`
- **Android build fails / stale native state:** `cd android && ./gradlew clean && cd ..`
- **Black screen on launch:** check `npx react-native log-android` (or `log-ios`) — a global error handler logs unhandled JS crashes there.

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
