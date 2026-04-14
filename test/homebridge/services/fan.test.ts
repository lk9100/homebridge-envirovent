import { describe, it, expect, vi } from 'vitest';
import { FanService } from '../../../src/homebridge/services/fan.js';
import { UnitState } from '../../../src/state/unit-state.js';
import { CommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessory } from '../../../src/homebridge/accessory.js';

// Unit's airflow config: varMin=24, max=100
const UNIT_VAR_MIN = 24;
const UNIT_MAX = 100;
const UNIT_RANGE = UNIT_MAX - UNIT_VAR_MIN; // 76

/** Convert unit percentage to expected HomeKit percentage. */
function expectedHK(unitPercent: number): number {
  const clamped = Math.max(UNIT_VAR_MIN, Math.min(UNIT_MAX, unitPercent));
  return Math.round(((clamped - UNIT_VAR_MIN) / UNIT_RANGE) * 100);
}

/** Convert HomeKit percentage to expected unit percentage. */
function expectedUnit(hkPercent: number): number {
  const clamped = Math.max(0, Math.min(100, hkPercent));
  return Math.round(UNIT_VAR_MIN + (clamped / 100) * UNIT_RANGE);
}

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

  it('setActive(0) sets slider to HK 0% (minimum speed)', async () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    const active = getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active);
    await active.simulateSet(0);
    await new Promise((r) => setTimeout(r, 100));

    expect(speed.getValue()).toBe(0);
  });

  it('setActive(0) sends varMin (24%) to unit', async () => {
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

// ─── RotationSpeed — HK 0-100% mapped to unit 24-100% ──────────────

describe('FanService — RotationSpeed (get, mapping)', () => {
  it('returns HK 0% when settings are null', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _settings: null })._settings = null;
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(0);
  });

  it('maps unit varMin (24%) to HK 0%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: UNIT_VAR_MIN, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(0);
  });

  it('maps unit 100% to HK 100%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 100, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(100);
  });

  it('maps unit 62% to HK 50%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 62, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(50);
  });

  it('maps every unit value (24-100) to a valid HK range (0-100)', () => {
    for (let unitValue = UNIT_VAR_MIN; unitValue <= UNIT_MAX; unitValue++) {
      const { fakeAccessory, platform } = buildTestAccessory({
        airflow: { mode: 'VAR', value: unitValue, active: true },
      });
      new FanService(fakeAccessory);
      const hk = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet() as number;
      expect(hk, `unit ${unitValue}% should map to HK 0-100`).toBeGreaterThanOrEqual(0);
      expect(hk, `unit ${unitValue}% should map to HK 0-100`).toBeLessThanOrEqual(100);
      expect(hk).toBe(expectedHK(unitValue));
    }
  });

  it('clamps unit values below varMin to HK 0%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 10, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(0);
  });

  it('clamps unit values above max to HK 100%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 120, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(100);
  });

  it('maps SET mode preset to HK percentage via airflow maps', () => {
    // SET mode mark 2 → maps entry {mark:2, percent:60} → unitToHK(60) = round((60-24)/76*100) = 47
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'SET', value: 2, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(expectedHK(60));
  });

  it('returns HK 0% for SET mode with unknown mark', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'SET', value: 99, active: true },
    });
    new FanService(fakeAccessory);
    expect(getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet()).toBe(0);
  });
});

describe('FanService — RotationSpeed (set, mapping)', () => {
  it('maps HK 0% to unit varMin (24%)', async () => {
    const { fakeAccessory, mockClient } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(
      fakeAccessory.platform.Characteristic.RotationSpeed,
    );

    await speed.simulateSet(0);
    await new Promise((r) => setTimeout(r, 450));

    const calls = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].airflow.value).toBe(UNIT_VAR_MIN);
  });

  it('maps HK 100% to unit 100%', async () => {
    const { fakeAccessory, mockClient } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(
      fakeAccessory.platform.Characteristic.RotationSpeed,
    );

    await speed.simulateSet(100);
    await new Promise((r) => setTimeout(r, 450));

    const calls = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].airflow.value).toBe(UNIT_MAX);
  });

  it('maps HK 50% to unit 62%', async () => {
    const { fakeAccessory, mockClient } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(
      fakeAccessory.platform.Characteristic.RotationSpeed,
    );

    await speed.simulateSet(50);
    await new Promise((r) => setTimeout(r, 450));

    const calls = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].airflow.value).toBe(expectedUnit(50));
  });

  it('sends the correctly mapped value for a range of HK percentages', async () => {
    for (const hkValue of [0, 1, 10, 25, 50, 75, 99, 100]) {
      const { fakeAccessory, mockClient } = buildTestAccessory();
      new FanService(fakeAccessory);
      const speed = getService(fakeAccessory).getCharacteristic(
        fakeAccessory.platform.Characteristic.RotationSpeed,
      );

      await speed.simulateSet(hkValue);
      await new Promise((r) => setTimeout(r, 450));

      const calls = (mockClient.setHomeSettings as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length, `setHomeSettings should be called for HK ${hkValue}%`).toBeGreaterThan(0);
      const sentValue = calls[calls.length - 1][0].airflow.value;
      expect(sentValue, `HK ${hkValue}% should map to unit ${expectedUnit(hkValue)}%`).toBe(expectedUnit(hkValue));
      expect(calls[calls.length - 1][0].airflow.mode).toBe('VAR');
    }
  });
});

// ─── HK value caching (anti-drift) ─────────────────────────────────

describe('FanService — HK value caching', () => {
  it('returns the exact HK value after set, not the round-tripped value', async () => {
    // HK 2% → unit 26 → unitToHK(26) = 3% (drift). But with caching, get returns 2%.
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 26, active: true },
    });
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    await speed.simulateSet(2);
    // Simulate the unit accepting our value — optimistic update sets airflow.value=26
    fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: 26, active: true } });

    expect(speed.simulateGet()).toBe(2); // Cached, not 3
  });

  it('returns cached value for every HK percentage (zero drift)', async () => {
    for (const hkValue of [0, 1, 2, 3, 10, 25, 33, 50, 66, 75, 99, 100]) {
      const { fakeAccessory, platform } = buildTestAccessory();
      new FanService(fakeAccessory);
      const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

      await speed.simulateSet(hkValue);
      // Simulate poll confirming the value we sent
      const expectedUnitVal = expectedUnit(hkValue);
      fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: expectedUnitVal, active: true } });

      expect(speed.simulateGet(), `HK ${hkValue}% should be cached exactly`).toBe(hkValue);
    }
  });

  it('clears cache when unit value diverges (external change)', async () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    // User sets HK 50% → unit 62
    await speed.simulateSet(50);
    fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: 62, active: true } });
    expect(speed.simulateGet()).toBe(50); // Cached

    // External change: someone sets the unit to 80% via the app
    fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: 80, active: true } });
    // 80 is far from our sent value of 62 — cache should clear
    const result = speed.simulateGet() as number;
    expect(result).toBe(expectedHK(80)); // Recalculated, not 50
  });

  it('tolerates ±1 rounding on the unit side without clearing cache', async () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    // Set HK 2% → expect unit 26. But unit rounds to 25 (within ±1).
    await speed.simulateSet(2);
    fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: 25, active: true } });

    // ±1 from sent (26) — cache should still hold
    expect(speed.simulateGet()).toBe(2);
  });

  it('caches HK 0% when tapping "off"', async () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 62, active: true },
    });
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);
    const active = getService(fakeAccessory).getCharacteristic(platform.Characteristic.Active);

    // Tap "off"
    await active.simulateSet(0);
    // Unit gets varMin (24)
    fakeAccessory.unitState.applyOptimistic({ airflow: { mode: 'VAR', value: UNIT_VAR_MIN, active: true } });

    expect(speed.simulateGet()).toBe(0); // Cached 0%, not unitToHK(24) which is also 0 here — but validates the cache path
  });

  it('returns computed value when no cache exists (initial state)', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 62, active: true },
    });
    new FanService(fakeAccessory);
    const speed = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed);

    // No set has happened — no cache. Should compute from unit value.
    expect(speed.simulateGet()).toBe(expectedHK(62));
  });
});

// ─── Round-trip stability ───────────────────────────────────────────

describe('FanService — round-trip stability (mapping)', () => {
  it('every unit value 24-100 survives a round trip with at most ±1% HK drift', () => {
    // set unit value → read HK → convert back to unit → check drift
    for (let unitValue = UNIT_VAR_MIN; unitValue <= UNIT_MAX; unitValue++) {
      const { fakeAccessory, platform } = buildTestAccessory({
        airflow: { mode: 'VAR', value: unitValue, active: true },
      });
      new FanService(fakeAccessory);
      const hk = getService(fakeAccessory).getCharacteristic(platform.Characteristic.RotationSpeed).simulateGet() as number;
      const backToUnit = expectedUnit(hk);
      const drift = Math.abs(backToUnit - unitValue);
      expect(drift, `unit ${unitValue}% → HK ${hk}% → unit ${backToUnit}%: drift ${drift} should be ≤ 1`).toBeLessThanOrEqual(1);
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
