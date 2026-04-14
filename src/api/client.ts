/**
 * High-level Envirovent API client.
 *
 * Composes connection + commands into a clean async API.
 * Built-in mutex ensures only one command is in-flight at a time
 * (matching the unit's single-threaded TCP server).
 */

import { sendCommand } from './connection.js';
import {
  buildGetCurrentSettings,
  buildGetStatus,
  buildSetBoost,
  buildSetSummerBypass,
  buildSetHomeSettings,
  buildSetInstallerSettings,
  buildFilterMaintenanceComplete,
  buildSetSpigotType,
  buildRestoreHomeDefaults,
  buildRestoreInstallerDefaults,
  buildRestoreCommissioningDefaults,
  parseGetCurrentSettings,
  parseCommandResponse,
} from './commands.js';
import type {
  CommandResponse,
  DEFAULTS,
  EnviroventClientConfig,
  GetCurrentSettingsResponse,
  SetHomeSettingsParams,
  SetInstallerSettingsParams,
  SpigotType,
} from './types.js';

export class EnviroventClient {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;

  private mutex: Promise<void> = Promise.resolve();

  constructor(config: EnviroventClientConfig) {
    this.host = config.host;
    this.port = config.port ?? 1337;
    this.timeout = config.timeout ?? 10_000;
  }

  // ─── Read commands ──────────────────────────────────────────────

  async getSettings(): Promise<GetCurrentSettingsResponse> {
    return this.execute(buildGetCurrentSettings(), parseGetCurrentSettings);
  }

  async getStatus(): Promise<CommandResponse> {
    return this.execute(buildGetStatus(), parseCommandResponse);
  }

  // ─── Write commands ─────────────────────────────────────────────

  async setBoost(enabled: boolean): Promise<CommandResponse> {
    return this.execute(buildSetBoost(enabled), parseCommandResponse);
  }

  async setSummerBypass(enabled: boolean): Promise<CommandResponse> {
    return this.execute(buildSetSummerBypass(enabled), parseCommandResponse);
  }

  async setHomeSettings(params: SetHomeSettingsParams): Promise<CommandResponse> {
    return this.execute(buildSetHomeSettings(params), parseCommandResponse);
  }

  async setInstallerSettings(params: SetInstallerSettingsParams): Promise<CommandResponse> {
    return this.execute(buildSetInstallerSettings(params), parseCommandResponse);
  }

  async setSpigotType(type: SpigotType): Promise<CommandResponse> {
    return this.execute(buildSetSpigotType(type), parseCommandResponse);
  }

  async filterMaintenanceComplete(): Promise<CommandResponse> {
    return this.execute(buildFilterMaintenanceComplete(), parseCommandResponse);
  }

  async restoreHomeDefaults(): Promise<CommandResponse> {
    return this.execute(buildRestoreHomeDefaults(), parseCommandResponse);
  }

  async restoreInstallerDefaults(): Promise<CommandResponse> {
    return this.execute(buildRestoreInstallerDefaults(), parseCommandResponse);
  }

  async restoreCommissioningDefaults(): Promise<CommandResponse> {
    return this.execute(buildRestoreCommissioningDefaults(), parseCommandResponse);
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Execute a command with mutex serialization.
   * Only one command runs at a time — subsequent calls queue behind the current one.
   */
  private execute<T>(payload: string, parser: (raw: string) => T): Promise<T> {
    const previous = this.mutex;
    let release: () => void;
    this.mutex = new Promise<void>((resolve) => { release = resolve; });

    return previous.then(async () => {
      try {
        const raw = await sendCommand(this.host, this.port, payload, this.timeout);
        return parser(raw);
      } finally {
        release!();
      }
    });
  }
}
