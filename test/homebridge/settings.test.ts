import { describe, it, expect } from 'vitest';
import { PLATFORM_NAME, PLUGIN_NAME } from '../../src/homebridge/settings.js';

describe('settings constants', () => {
  it('exports the expected platform name', () => {
    expect(PLATFORM_NAME).toBe('EnviroventPIV');
  });

  it('exports the expected plugin name', () => {
    expect(PLUGIN_NAME).toBe('homebridge-envirovent');
  });
});
