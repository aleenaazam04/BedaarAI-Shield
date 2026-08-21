/**
 * App.tsx — Entry point for the Driver Safety application.
 *
 * Responsibilities:
 *   1. ErrorBoundary — catches render-phase crashes and shows a visible
 *      fallback instead of a silent black screen.
 *   2. Language Selection — on first launch (no `@app_language` stored),
 *      shows a full-screen modal forcing the user to pick English or Urdu.
 *   3. SafeAreaView + StatusBar — respects device notch / home indicator
 *      while the camera preview extends edge-to-edge.
 *   4. Hydrates the i18n store from AsyncStorage on mount.
 */

import React, { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  I18nManager,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import { useI18nStore, type Language } from './src/store/useI18nStore';

// ─────────────────────────────────────────────────────────────────────────────
// Error boundary — catches render-phase crashes and shows a fallback UI
// instead of leaving the user staring at a black screen.
// ─────────────────────────────────────────────────────────────────────────────

interface EBProps {
  children: ReactNode;
}
interface EBState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.errorRoot}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>{this.state.errorMessage}</Text>
          <Text style={styles.errorHint}>
            Restart the app or check logcat for details.
          </Text>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Language Selection Modal
// ─────────────────────────────────────────────────────────────────────────────

function LanguageSelectionModal({
  visible,
  onSelect,
}: {
  visible: boolean;
  onSelect: (lang: Language) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.langRoot}>
        {/* Decorative header bar */}
        <View style={styles.langHeader}>
          <Text style={styles.langIcon}></Text>
        </View>

        <Text style={styles.langTitle}>
          Select Language
        </Text>
        <Text style={styles.langSubtitle}>
          زبان کا انتخاب کریں
        </Text>

        <View style={styles.langOptions}>
          <Pressable
            style={styles.langOptionBtn}
            onPress={() => onSelect('en')}
          >
            <Text style={styles.langOptionLabel}>English</Text>
            <Text style={styles.langOptionHint}>EN</Text>
          </Pressable>

          <Pressable
            style={styles.langOptionBtn}
            onPress={() => onSelect('ur')}
          >
            <Text style={[styles.langOptionLabel, styles.langOptionLabelRtl]}>
              اردو (Urdu)
            </Text>
            <Text style={styles.langOptionHint}>UR</Text>
          </Pressable>
        </View>

        <Text style={styles.langFooter}>
          You can change language anytime from Settings
        </Text>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const language = useI18nStore((s) => s.language);
  const loadLanguage = useI18nStore((s) => s.loadLanguage);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const [ready, setReady] = useState(false);

  // Hydrate language from AsyncStorage on first mount.
  useEffect(() => {
    loadLanguage().finally(() => setReady(true));
  }, [loadLanguage]);

  const handleLanguageSelect = useCallback(
    (lang: Language) => {
      // Apply RTL layout for Urdu
      I18nManager.allowRTL(lang === 'ur');
      I18nManager.forceRTL(lang === 'ur');
      setLanguage(lang);
    },
    [setLanguage],
  );

  // Show nothing while language is being hydrated from storage.
  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashText}>Bedaar AI</Text>
      </View>
    );
  }

  return (
    <AppErrorBoundary>
      <SafeAreaView style={styles.root}>
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent
        />

        {/* Language selection modal — shown on first launch only */}
        <LanguageSelectionModal
          visible={language == null}
          onSelect={handleLanguageSelect}
        />

        <HomeScreen />
      </SafeAreaView>
    </AppErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },

  // ── Splash (while hydrating language) ──────────────────────────────────
  splash: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashText: {
    color: '#00D4FF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
  },

  // ── Error boundary fallback ────────────────────────────────────────────
  errorRoot: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    color: '#FF1744',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 16,
  },
  errorHint: {
    color: '#8A8A8A',
    fontSize: 12,
    textAlign: 'center',
  },

  // ── Language modal ─────────────────────────────────────────────────────
  langRoot: {
    flex: 1,
    backgroundColor: '#0a0f1e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  langHeader: {
    marginBottom: 24,
  },
  langIcon: {
    fontSize: 56,
    textAlign: 'center',
  },
  langTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  langSubtitle: {
    color: '#8A8A8A',
    fontSize: 22,
    marginTop: 4,
    marginBottom: 40,
    textAlign: 'center',
  },
  langOptions: {
    width: '100%',
    gap: 16,
  },
  langOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  langOptionLabel: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  langOptionLabelRtl: {
    textAlign: 'right',
  },
  langOptionHint: {
    color: '#00D4FF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  langFooter: {
    color: '#555555',
    fontSize: 12,
    marginTop: 32,
    textAlign: 'center',
  },
});
