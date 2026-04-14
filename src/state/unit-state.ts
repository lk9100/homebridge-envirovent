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
}

export class UnitState extends EventEmitter {
  private _settings: PivSettings | null = null;
  private _connected: boolean = false;
  private _consecutiveFailures: number = 0;
  private readonly failureThreshold: number;
  private readonly client: EnviroventClient;

  constructor(client: EnviroventClient, options: UnitStateOptions = {}) {
    super();
    this.client = client;
    this.failureThreshold = options.failureThreshold ?? 3;
  }

  /** Latest known settings, or null if never successfully polled. */
  get settings(): PivSettings | null {
    return this._settings;
  }

  /** Whether the unit is currently considered reachable. */
  get connected(): boolean {
    return this._connected;
  }

  /** Number of consecutive poll failures. */
  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /**
   * Poll the unit for current settings.
   * Updates internal state and emits events on changes.
   */
  async poll(): Promise<PivSettings | null> {
    try {
      const response = await this.client.getSettings();
      if (!response.success) {
        this.recordFailure(new Error('Unit returned unsuccessful response'));
        return this._settings;
      }

      this._consecutiveFailures = 0;
      const wasDisconnected = !this._connected;
      this._connected = true;

      if (wasDisconnected) {
        this.emit('connectionRestored');
      }

      const previous = this._settings;
      this._settings = response.settings;

      if (!settingsEqual(previous, response.settings)) {
        this.emit('stateChanged', response.settings);
      }

      return response.settings;
    } catch (err) {
      this.recordFailure(err);
      return this._settings;
    }
  }

  /**
   * Apply an optimistic state patch immediately (before the next poll confirms it).
   * This makes the UI feel responsive — e.g., toggling boost shows instantly.
   */
  applyOptimistic(patch: Partial<PivSettings>): void {
    if (!this._settings) return;

    this._settings = { ...this._settings, ...patch };
    this.emit('stateChanged', this._settings);
  }

  private recordFailure(err: unknown): void {
    this._consecutiveFailures++;
    this.emit('pollError', err);

    if (this._connected && this._consecutiveFailures >= this.failureThreshold) {
      this._connected = false;
      this.emit('connectionLost');
    }
  }
}

/**
 * Shallow comparison of two PivSettings objects.
 * Compares the fields that matter for HomeKit state updates.
 */
function settingsEqual(a: PivSettings | null, b: PivSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.airflow.mode === b.airflow.mode &&
    a.airflow.value === b.airflow.value &&
    a.airflow.active === b.airflow.active &&
    a.boost.enabled === b.boost.enabled &&
    a.boost.mins === b.boost.mins &&
    a.heater.autoActive === b.heater.autoActive &&
    a.heater.temperature === b.heater.temperature &&
    a.filter.remainingDays === b.filter.remainingDays &&
    a.filter.resetMonths === b.filter.resetMonths &&
    a.summerBypass.active === b.summerBypass.active &&
    a.summerBypass.summerShutdown === b.summerBypass.summerShutdown &&
    a.summerBypass.temperature === b.summerBypass.temperature &&
    a.hoursRun === b.hoursRun
  );
}
