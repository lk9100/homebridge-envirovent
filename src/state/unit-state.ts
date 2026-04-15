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

  /**
   * Timestamp of the last optimistic update. During the grace period, poll
   * results that differ from the optimistic state are ignored — preventing a
   * stale in-flight poll from overwriting a fresh value across all services
   * (fan speed, boost, etc.). The grace period covers the TCP round-trip plus
   * one full poll cycle for confirmation.
   */
  private _lastOptimisticAt: number = 0;
  private static readonly OPTIMISTIC_GRACE_MS = 5000;

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

      // If we recently applied an optimistic update, don't let a stale poll
      // overwrite it. An in-flight poll that started BEFORE our TCP command
      // will return the old value — accepting it would undo the optimistic
      // update and cause the UI to snap back to the previous state.
      const inGracePeriod =
        this._lastOptimisticAt > 0 &&
        Date.now() - this._lastOptimisticAt < UnitState.OPTIMISTIC_GRACE_MS;

      if (inGracePeriod) {
        if (settingsEqual(this._settings, response.settings)) {
          // Poll confirms the optimistic value — grace period can end
          this._lastOptimisticAt = 0;
          this._settings = response.settings;
        }
        // Otherwise keep the optimistic state; don't emit stateChanged
        return this._settings;
      }

      this._lastOptimisticAt = 0;
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
    this._lastOptimisticAt = Date.now();
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
