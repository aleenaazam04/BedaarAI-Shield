/**
 * @format
 * Verifies accelerometer crash detection is unit-agnostic:
 * resting gravity must NOT trigger, a real impact spike must.
 */

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {it, expect, beforeEach, describe, jest} from '@jest/globals';

import HomeScreen from '../src/screens/HomeScreen';
import {useSafetyStore} from '../src/store/useSafetyStore';

declare const global: {__emitAccel: (s: {x: number; y: number; z: number}) => void};

async function mount() {
  await act(async () => {
    renderer.create(<HomeScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function emit(mag: number) {
  // Put all magnitude on the z-axis (√(0+0+z²) = z).
  global.__emitAccel({x: 0, y: 0, z: mag});
}

describe('crash detection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSafetyStore.getState().setCrashDetected(false);
  });

  it('does not fire at resting gravity on Android (~9.81 m/s²)', async () => {
    await mount();
    await act(async () => {
      for (let i = 0; i < 100; i++) emit(9.81);
    });
    expect(useSafetyStore.getState().isCrashDetected).toBe(false);
  });

  it('does not fire at resting gravity on iOS (~1.0 G)', async () => {
    await mount();
    await act(async () => {
      for (let i = 0; i < 100; i++) emit(1.0);
    });
    expect(useSafetyStore.getState().isCrashDetected).toBe(false);
  });

  it('fires on a sharp impact spike (Android units)', async () => {
    await mount();
    await act(async () => {
      for (let i = 0; i < 30; i++) emit(9.81);
      emit(40); // ~4x baseline impact
    });
    expect(useSafetyStore.getState().isCrashDetected).toBe(true);
  });
});
