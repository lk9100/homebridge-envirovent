/**
 * Reactive state container for an Envirovent PIV unit.
 *
 * Tracks the latest settings, connection health, and supports
 * optimistic updates for responsive UI feedback.
 */

import { EventEmitter } from 'node:events';
import type { EnviroventClient } from '../api/client.js';
import type { PivSettings } from '../api/types.js';

export type UnitStateEvent =
  | 'stateChanged'
  | 'connectionLost'
  | 'connectionRestored'
  | 'pollError';

export interface UnitStateOptions {
  /** Number of consecutive poll failures before emitting 'connectionLost'. Default: 3. */
  failureThreshold?: number;
  /** Pre-populate with known settings (useful for testing). Sets connected=true. */
  initialSettings?: PivSettings | undefined;
}

const OPTIMISTIC_GRACE_MS = 5000;

/**
 * Structural comparison of two PivSettings objects.
 * Uses JSON.stringify — safe because both objects are produced by the same
 * parser (parseSettings) or spread-based optimistic patches, guaranteeing
 * consistent key ordering. Automatically covers new fields added to PivSettings.
 */
const settingsEqual = (a: PivSettings | null, b: PivSettings | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const createUnitState = (client: EnviroventClient, options: UnitStateOptions = {}) => {
  const emitter = new EventEmitter();
  const failureThreshold = options.failureThreshold ?? 3;

  let _settings: PivSettings | null = options.initialSettings ?? null;
  let _connected = options.initialSettings != null;
  let _consecutiveFailures = 0;

  /**
   * Timestamp of the last optimistic update. During the grace period, poll
   * results that differ from the optimistic state are ignored — preventing a
   * stale in-flight poll from overwriting a fresh value across all services.
   */
  let _lastOptimisticAt = 0;

  const recordFailure = (err: unknown): void => {
    _consecutiveFailures++;
    emitter.emit('pollError', err);

    if (_connected && _consecutiveFailures >= failureThreshold) {
      _connected = false;
      emitter.emit('connectionLost');
    }
  };

  /**
   * Poll the unit for current settings.
   * Updates internal state and emits events on changes.
   */
  const poll = async (): Promise<PivSettings | null> => {
    try {
      const response = await client.getSettings();
      if (!response.success) {
        recordFailure(new Error('Unit returned unsuccessful response'));
        return _settings;
      }

      _consecutiveFailures = 0;
      const wasDisconnected = !_connected;
      _connected = true;

      if (wasDisconnected) {
        emitter.emit('connectionRestored');
      }

      const previous = _settings;

      // If we recently applied an optimistic update, don't let a stale poll
      // overwrite it. An in-flight poll that started BEFORE our TCP command
      // will return the old value — accepting it would undo the optimistic
      // update and cause the UI to snap back to the previous state.
      const inGracePeriod =
        _lastOptimisticAt > 0 &&
        Date.now() - _lastOptimisticAt < OPTIMISTIC_GRACE_MS;

      if (inGracePeriod) {
        if (settingsEqual(_settings, response.settings)) {
          // Poll confirms the optimistic value — grace period can end
          _lastOptimisticAt = 0;
          _settings = response.settings;
        }
        // Otherwise keep the optimistic state; don't emit stateChanged
        return _settings;
      }

      _lastOptimisticAt = 0;
      _settings = response.settings;

      if (!settingsEqual(previous, response.settings)) {
        emitter.emit('stateChanged', response.settings);
      }

      return response.settings;
    } catch (err) {
      recordFailure(err);
      return _settings;
    }
  };

  /**
   * Apply an optimistic state patch immediately (before the next poll confirms it).
   * This makes the UI feel responsive — e.g., toggling boost shows instantly.
   */
  const applyOptimistic = (patch: Partial<PivSettings>): void => {
    if (!_settings) return;

    // Deep merge one level: for each key in the patch, if both the existing
    // value and patch value are objects, spread-merge them. This prevents
    // partial sub-objects (e.g. { airflow: { value: 50 } }) from wiping
    // sibling fields (mode, active).
    const merged = { ..._settings };
    for (const key of Object.keys(patch) as (keyof PivSettings)[]) {
      const existing = _settings[key];
      const incoming = patch[key];
      if (typeof existing === 'object' && existing !== null && typeof incoming === 'object' && incoming !== null) {
        (merged as Record<string, unknown>)[key] = { ...existing, ...incoming };
      } else if (incoming !== undefined) {
        (merged as Record<string, unknown>)[key] = incoming;
      }
    }
    _settings = merged;
    _lastOptimisticAt = Date.now();
    emitter.emit('stateChanged', _settings);
  };

  const dispose = (): void => {
    emitter.removeAllListeners();
  };

  return {
    get settings() { return _settings; },
    get connected() { return _connected; },
    get consecutiveFailures() { return _consecutiveFailures; },
    on: emitter.on.bind(emitter) as EventEmitter['on'],
    emit: emitter.emit.bind(emitter) as EventEmitter['emit'],
    poll,
    applyOptimistic,
    dispose,
  };
};

export type UnitState = ReturnType<typeof createUnitState>;
