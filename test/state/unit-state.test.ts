import { describe, it, expect, vi } from 'vitest';
import { createUnitState } from '../../src/state/unit-state.js';
import type { EnviroventClient } from '../../src/api/client.js';
import type { PivSettings, GetCurrentSettingsResponse } from '../../src/api/types.js';
import { createMockSettings } from '../homebridge/mock-homebridge.js';

const createMockClient = (getSettingsImpl?: () => Promise<GetCurrentSettingsResponse>): EnviroventClient =>
  ({
    getSettings: getSettingsImpl ?? (async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings(),
    })),
  } as unknown as EnviroventClient);

describe('UnitState', () => {
  it('starts with null settings and disconnected', () => {
    const state = createUnitState(createMockClient());
    expect(state.settings).toBeNull();
    expect(state.connected).toBe(false);
  });

  it('starts connected with initialSettings when provided', () => {
    const settings = createMockSettings();
    const state = createUnitState(createMockClient(), { initialSettings: settings });
    expect(state.settings).not.toBeNull();
    expect(state.connected).toBe(true);
  });

  it('poll updates settings and marks as connected', async () => {
    const state = createUnitState(createMockClient());
    const settings = await state.poll();

    expect(settings).not.toBeNull();
    expect(settings!.airflow.value).toBe(45);
    expect(state.connected).toBe(true);
  });

  it('emits stateChanged on first successful poll', async () => {
    const state = createUnitState(createMockClient());
    const handler = vi.fn();
    state.on('stateChanged', handler);

    await state.poll();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits connectionRestored when reconnecting', async () => {
    const state = createUnitState(createMockClient());
    const handler = vi.fn();
    state.on('connectionRestored', handler);

    await state.poll();
    expect(handler).toHaveBeenCalledTimes(1); // First connect
  });

  it('does not emit stateChanged when settings are unchanged', async () => {
    const state = createUnitState(createMockClient());
    const handler = vi.fn();

    await state.poll(); // First poll
    state.on('stateChanged', handler);
    await state.poll(); // Same settings

    expect(handler).not.toHaveBeenCalled();
  });

  it('emits stateChanged when settings change', async () => {
    let callCount = 0;
    const client = createMockClient(async () => {
      callCount++;
      return {
        success: true as const,
        unitType: 'piv',
        settings: createMockSettings({
          airflow: { mode: 'VAR', value: callCount === 1 ? 45 : 60, active: true },
        }),
      };
    });

    const state = createUnitState(client);
    const handler = vi.fn();

    await state.poll();
    state.on('stateChanged', handler);
    await state.poll();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits connectionLost after threshold failures', async () => {
    let shouldFail = false;
    const switchableClient = createMockClient(async () => {
      if (shouldFail) throw new Error('connection refused');
      return { success: true as const, unitType: 'piv', settings: createMockSettings() };
    });

    const state = createUnitState(switchableClient, { failureThreshold: 2 });
    await state.poll(); // Connected

    shouldFail = true;
    const lostHandler = vi.fn();
    state.on('connectionLost', lostHandler);

    await state.poll(); // Failure 1
    expect(lostHandler).not.toHaveBeenCalled();
    expect(state.connected).toBe(true);

    await state.poll(); // Failure 2 — threshold reached
    expect(lostHandler).toHaveBeenCalledTimes(1);
    expect(state.connected).toBe(false);
  });

  it('emits connectionRestored after reconnecting', async () => {
    let shouldFail = true;
    const client = createMockClient(async () => {
      if (shouldFail) throw new Error('fail');
      return { success: true as const, unitType: 'piv', settings: createMockSettings() };
    });

    const state = createUnitState(client, { failureThreshold: 1 });
    const restoredHandler = vi.fn();
    state.on('connectionRestored', restoredHandler);

    // Connect first
    shouldFail = false;
    await state.poll();
    expect(restoredHandler).toHaveBeenCalledTimes(1);

    // Lose connection
    shouldFail = true;
    await state.poll();
    expect(state.connected).toBe(false);

    // Restore
    shouldFail = false;
    await state.poll();
    expect(restoredHandler).toHaveBeenCalledTimes(2);
    expect(state.connected).toBe(true);
  });

  it('tracks consecutive failures', async () => {
    const client = createMockClient(async () => {
      throw new Error('fail');
    });

    const state = createUnitState(client, { failureThreshold: 5 });
    await state.poll();
    expect(state.consecutiveFailures).toBe(1);
    await state.poll();
    expect(state.consecutiveFailures).toBe(2);
  });

  it('resets consecutive failures on successful poll', async () => {
    let shouldFail = true;
    const client = createMockClient(async () => {
      if (shouldFail) throw new Error('fail');
      return { success: true as const, unitType: 'piv', settings: createMockSettings() };
    });

    const state = createUnitState(client, { failureThreshold: 10 });
    await state.poll(); // Fail
    await state.poll(); // Fail
    expect(state.consecutiveFailures).toBe(2);

    shouldFail = false;
    await state.poll(); // Success
    expect(state.consecutiveFailures).toBe(0);
  });

  it('applyOptimistic patches settings and emits stateChanged', async () => {
    const state = createUnitState(createMockClient());
    await state.poll(); // Get initial settings

    const handler = vi.fn();
    state.on('stateChanged', handler);

    state.applyOptimistic({
      boost: { enabled: true, mins: 20 },
    });

    expect(state.settings!.boost.enabled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('applyOptimistic is a no-op when no settings exist', () => {
    const state = createUnitState(createMockClient());
    const handler = vi.fn();
    state.on('stateChanged', handler);

    // No poll yet — settings are null
    state.applyOptimistic({ boost: { enabled: true, mins: 20 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('applyOptimistic deep-merges nested objects (preserves unpatched fields)', async () => {
    const state = createUnitState(createMockClient());
    await state.poll();

    // Patch only airflow.value — mode and active should be preserved
    state.applyOptimistic({ airflow: { value: 80 } } as Partial<PivSettings>);

    expect(state.settings!.airflow.value).toBe(80);
    expect(state.settings!.airflow.mode).toBe('VAR');    // preserved, not undefined
    expect(state.settings!.airflow.active).toBe(true);   // preserved, not undefined
  });

  it('returns cached settings when poll fails', async () => {
    let shouldFail = false;
    const client = createMockClient(async () => {
      if (shouldFail) throw new Error('fail');
      return { success: true as const, unitType: 'piv', settings: createMockSettings() };
    });

    const state = createUnitState(client, { failureThreshold: 10 });
    await state.poll(); // Success — cache settings

    shouldFail = true;
    const result = await state.poll(); // Fail — should return cached
    expect(result).not.toBeNull();
    expect(result!.airflow.value).toBe(45);
  });

  it('poll does not overwrite optimistic update with stale data (grace period)', async () => {
    let airflowValue = 50;
    const client = createMockClient(async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings({ airflow: { mode: 'VAR', value: airflowValue, active: true } }),
    }));

    const state = createUnitState(client);
    await state.poll(); // Initial: value=50
    expect(state.settings!.airflow.value).toBe(50);

    // Apply optimistic update (simulates user setting slider to 24%)
    state.applyOptimistic({ airflow: { mode: 'VAR', value: 24, active: true } });
    expect(state.settings!.airflow.value).toBe(24);

    // A stale poll arrives — without the grace period, this would overwrite 24 back to 50
    const staleResult = await state.poll();
    expect(staleResult!.airflow.value).toBe(24); // Optimistic state preserved
    expect(state.settings!.airflow.value).toBe(24); // NOT 50

    // No stateChanged should have fired for the stale poll
    const handler = vi.fn();
    state.on('stateChanged', handler);
    await state.poll(); // Another stale poll
    expect(handler).not.toHaveBeenCalled();
  });

  it('poll confirms optimistic update when unit agrees', async () => {
    let airflowValue = 50;
    const client = createMockClient(async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings({ airflow: { mode: 'VAR', value: airflowValue, active: true } }),
    }));

    const state = createUnitState(client);
    await state.poll(); // Initial: value=50

    state.applyOptimistic({ airflow: { mode: 'VAR', value: 24, active: true } });

    // Unit now reports 24 (command arrived)
    airflowValue = 24;
    await state.poll();

    // Grace period should be cleared, normal polling resumes
    airflowValue = 60;
    const handler = vi.fn();
    state.on('stateChanged', handler);
    await state.poll();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.settings!.airflow.value).toBe(60);
  });

  it('records failure when unit returns success=false', async () => {
    const client = createMockClient(async () => ({
      success: false as const,
      unitType: 'piv',
      settings: undefined as unknown as PivSettings,
    }));

    const state = createUnitState(client, { failureThreshold: 10 });
    await state.poll();
    expect(state.consecutiveFailures).toBe(1);
    expect(state.settings).toBeNull();
  });
});

// ─── settingsEqual coverage ───────────────────────────────────────

describe('UnitState — settingsEqual detects all field changes', () => {
  it('emits stateChanged when spigot.type changes', async () => {
    let spigotType = 1;
    const client = createMockClient(async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings({
        spigot: { type: spigotType as 1 | 2, canChange: false },
      }),
    }));

    const state = createUnitState(client);
    await state.poll();

    spigotType = 2;
    const handler = vi.fn();
    state.on('stateChanged', handler);
    await state.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.settings!.spigot.type).toBe(2);
  });

  it('emits stateChanged when kickUp.active changes', async () => {
    let kickUpActive = false;
    const client = createMockClient(async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings({
        kickUp: { active: kickUpActive },
      }),
    }));

    const state = createUnitState(client);
    await state.poll();

    kickUpActive = true;
    const handler = vi.fn();
    state.on('stateChanged', handler);
    await state.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.settings!.kickUp.active).toBe(true);
  });

  it('emits stateChanged when boostInput.enabled changes', async () => {
    let boostInputEnabled = false;
    const client = createMockClient(async () => ({
      success: true as const,
      unitType: 'piv',
      settings: createMockSettings({
        boostInput: { enabled: boostInputEnabled },
      }),
    }));

    const state = createUnitState(client);
    await state.poll();

    boostInputEnabled = true;
    const handler = vi.fn();
    state.on('stateChanged', handler);
    await state.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.settings!.boostInput.enabled).toBe(true);
  });
});
