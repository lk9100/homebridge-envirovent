import { describe, it, expect, vi } from 'vitest';
import { FanService } from '../../../src/homebridge/services/fan.js';
import { UnitState } from '../../../src/state/unit-state.js';
import { CommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessory } from '../../../src/homebridge/accessory.js';

// Real unit's airflow config: varMin=24, max=100
const UNIT_VAR_MIN = 24;
const UNIT_MAX = 100;

function buildTestAccessory(settingsOverrides?: Parameters<typeof createMockSettings>[0]) {
  const settings = createMockSettings(settingsOverrides);
  const mockClient = {
    getSettings: vi.fn(),
    setHomeSettings: vi.fn().mockResolvedValue({ success: true }),
    setBoost: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
  const unitState = new UnitState(mockClient, { failureThreshold: 3 });
  (unitState as unknown as { _settings: typeof settings })._settings = settings;
  (unitState as unknown as { _connected: boolean })._connected = true;

  const fakeAccessory = {
    platform,
    accessory,
    client: mockClient,
    commandQueue: new CommandQueue({ retries: 0 }),
    unitState,
  } as unknown as EnviroventAccessory;

  return { fakeAccessory, platform, unitState, mockClient };
}

function getService(fakeAccessory: EnviroventAccessory) {
  return fakeAccessory.accessory.getService('Fan') as unknown as MockService;
}

// ─── Active characteristic ──────────────────────────────────────────

describe('FanService — Active', () => {
  it('getActive always returns 1 (unit is always on)', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 24, active: false },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active).simulateGet()).toBe(1);
  });

  it('getActive returns 1 even when settings are null', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _settings: null })._settings = null;
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active).simulateGet()).toBe(1);
  });

  it('setActive(0) pushes Active back to 1 after delay', async () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    const active = getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active);

    await active.simulateSet(0);
    await new Promise((r) => setTimeout(r, 100));

    expect(active.getValue()).toBe(1);
  });

  it('setActive(0) sets slider to varMin (24%), not 0%', async () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    const active = getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active);
    await active.simulateSet(0);
    await new Promise((r) => setTimeout(r, 100));

    expect(speed.getValue()).toBe(UNIT_VAR_MIN);
  });

  it('setActive(0) sends minimum airflow (24%) to unit', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory();
    new FanService(fakeAccessory);
    const active = getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active);

    await active.simulateSet(0);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockClient.setHomeSettings).toHaveBeenCalled();
    const call = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.airflow.value).toBe(UNIT_VAR_MIN);
    expect(call.airflow.mode).toBe('VAR');
  });
});

// ─── RotationSpeed — direct passthrough, no mapping ─────────────────

describe('FanService — RotationSpeed (get)', () => {
  it('returns varMin (24) when settings are null', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _settings: null })._settings = null;
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(UNIT_VAR_MIN);
  });

  it('passes through every valid VAR value unchanged (24-100)', () => {
    for (let unitValue = UNIT_VAR_MIN; unitValue <= UNIT_MAX; unitValue++) {
      const { fakeAccessory, platform } = buildTestAccessory({
        airflow: { mode: 'VAR', value: unitValue, active: true },
      });
      new FanService(fakeAccessory);
      const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);
      expect(speed.simulateGet(), `VAR ${unitValue}% should pass through as ${unitValue}`).toBe(unitValue);
    }
  });

  it('clamps values below varMin to varMin', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 10, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(UNIT_VAR_MIN);
  });

  it('clamps values above max to max', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 120, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(UNIT_MAX);
  });

  it('reads SET mode by looking up preset mark in airflow maps', () => {
    // SET mode mark 2 → maps entry {mark:2, percent:60} → clamped to [24,100] → 60
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'SET', value: 2, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(60);
  });

  it('returns varMin for SET mode with unknown mark', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'SET', value: 99, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(UNIT_VAR_MIN);
  });
});

describe('FanService — RotationSpeed (set)', () => {
  it('sends the exact value to the unit for every valid percentage (24-100)', async () => {
    for (const testValue of [UNIT_VAR_MIN, 30, 50, 66, 75, UNIT_MAX]) {
      const { fakeAccessory, mockClient } = buildTestAccessory();
      new FanService(fakeAccessory);
      const speed = getService(fakeAccessory).getCharacteristic(
        fakeAccessory.platform.Characteristic.RotationSpeed,
      );

      await speed.simulateSet(testValue);
      // Wait for debounce (300ms) + command queue
      await new Promise((r) => setTimeout(r, 450));

      const calls = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length, `setHomeSettings should have been called for value ${testValue}`).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.airflow.value, `value ${testValue} should pass through`).toBe(testValue);
      expect(lastCall.airflow.mode).toBe('VAR');
    }
  });
});

// ─── No round-trip drift ────────────────────────────────────────────

describe('FanService — round-trip stability (direct passthrough)', () => {
  it('every value 24-100 is perfectly stable: set → poll → read back identical', () => {
    // Since there's no mapping, the value the unit reports is exactly
    // what getRotationSpeed returns. Zero drift by design.
    for (let value = UNIT_VAR_MIN; value <= UNIT_MAX; value++) {
      const { fakeAccessory, platform } = buildTestAccessory({
        airflow: { mode: 'VAR', value, active: true },
      });
      new FanService(fakeAccessory);
      const readBack = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet();
      expect(readBack, `unit ${value}% should read back as ${value}%`).toBe(value);
    }
  });
});

// ─── CurrentFanState ────────────────────────────────────────────────

describe('FanService — CurrentFanState', () => {
  it('reports BLOWING_AIR when connected', () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.CurrentFanState).simulateGet()).toBe(2);
  });

  it('reports INACTIVE when not connected', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _connected: boolean })._connected = false;
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.CurrentFanState).simulateGet()).toBe(0);
  });

  it('reports INACTIVE when settings are null', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _settings: null })._settings = null;
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.CurrentFanState).simulateGet()).toBe(0);
  });
});
