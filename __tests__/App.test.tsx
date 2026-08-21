/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

import {it} from '@jest/globals';

import renderer, {act} from 'react-test-renderer';

it('renders correctly', async () => {
  await act(async () => {
    renderer.create(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
});
