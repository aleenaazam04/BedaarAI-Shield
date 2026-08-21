/**
 * index.js — React Native entry point.
 *
 * Installs a global error handler so unhandled JS exceptions
 * surface in logcat instead of producing a silent black screen.
 */

import { AppRegistry } from 'react-native';
import App from './App';

// Global error handler — logs to logcat for debugging black-screen crashes
if (!__DEV__) {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalError]', isFatal ? 'FATAL' : 'ERROR', error?.message, error?.stack);
    if (originalHandler) originalHandler(error, isFatal);
  });
}

AppRegistry.registerComponent('BedaarAIShield', () => App);
