/**
 * @format
 * A sustained open mouth must count as ONE yawn (rising edge), not one per frame.
 */

import {it, expect, beforeEach, describe} from '@jest/globals';
import {processFrame, resetVisionEngine, getYawnCount} from '../src/utils/visionEngine';

const T0 = Date.now();

async function calibrate() {
  for (let i = 0; i < 90; i++) {
    await processFrame({
      landmarks: [],
      leftEyeOpenProbability: 1,
      rightEyeOpenProbability: 1,
      mouthOpenProbability: 0,
      directPitch: 0,
      directYaw: 0,
      timestamp: T0 + i,
    });
  }
}

async function frame(mouth: number, t: number) {
  return processFrame({
    landmarks: [],
    leftEyeOpenProbability: 1,
    rightEyeOpenProbability: 1,
    mouthOpenProbability: mouth,
    directPitch: 0,
    directYaw: 0,
    timestamp: t,
  });
}

describe('yawn rising-edge detection', () => {
  beforeEach(() => {
    resetVisionEngine();
  });

  it('counts a sustained open mouth as a single yawn', async () => {
    await calibrate();
    let base = T0 + 100;
    for (let i = 0; i < 50; i++) await frame(0.9, base++); // held open ~50 frames
    expect(getYawnCount()).toBe(1);
  });

  it('counts separate open/close cycles individually', async () => {
    await calibrate();
    let base = T0 + 100;
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 10; i++) await frame(0.9, base++); // open
      for (let i = 0; i < 10; i++) await frame(0.0, base++); // close
    }
    expect(getYawnCount()).toBe(3);
  });
});
