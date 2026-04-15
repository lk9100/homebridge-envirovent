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
import {
  DEFAULTS,
  type CommandResponse,
  type EnviroventClientConfig,
  type GetCurrentSettingsResponse,
  type SetHomeSettingsParams,
  type SetInstallerSettingsParams,
  type SpigotType,
} from './types.js';

export const createEnviroventClient = (config: EnviroventClientConfig) => {
  const host = config.host;
  const port = config.port ?? DEFAULTS.PORT;
  const timeout = config.timeout ?? DEFAULTS.TIMEOUT;

  let mutex: Promise<void> = Promise.resolve();

  /**
   * Execute a command with mutex serialization.
   * Only one command runs at a time — subsequent calls queue behind the current one.
   */
  const execute = <T>(payload: string, parser: (raw: string) => T): Promise<T> => {
    const previous = mutex;
    let release: () => void;
    mutex = new Promise<void>((resolve) => { release = resolve; });

    return previous.then(async () => {
      try {
        const raw = await sendCommand(host, port, payload, timeout);
        return parser(raw);
      } finally {
        release!();
      }
    });
  };

  // ─── Read commands ──────────────────────────────────────────────

  const getSettings = (): Promise<GetCurrentSettingsResponse> =>
    execute(buildGetCurrentSettings(), parseGetCurrentSettings);

  const getStatus = (): Promise<CommandResponse> =>
    execute(buildGetStatus(), parseCommandResponse);

  // ─── Write commands ─────────────────────────────────────────────

  const setBoost = (enabled: boolean): Promise<CommandResponse> =>
    execute(buildSetBoost(enabled), parseCommandResponse);

  const setSummerBypass = (enabled: boolean): Promise<CommandResponse> =>
    execute(buildSetSummerBypass(enabled), parseCommandResponse);

  const setHomeSettings = (params: SetHomeSettingsParams): Promise<CommandResponse> =>
    execute(buildSetHomeSettings(params), parseCommandResponse);

  const setInstallerSettings = (params: SetInstallerSettingsParams): Promise<CommandResponse> =>
    execute(buildSetInstallerSettings(params), parseCommandResponse);

  const setSpigotType = (type: SpigotType): Promise<CommandResponse> =>
    execute(buildSetSpigotType(type), parseCommandResponse);

  const filterMaintenanceComplete = (): Promise<CommandResponse> =>
    execute(buildFilterMaintenanceComplete(), parseCommandResponse);

  const restoreHomeDefaults = (): Promise<CommandResponse> =>
    execute(buildRestoreHomeDefaults(), parseCommandResponse);

  const restoreInstallerDefaults = (): Promise<CommandResponse> =>
    execute(buildRestoreInstallerDefaults(), parseCommandResponse);

  const restoreCommissioningDefaults = (): Promise<CommandResponse> =>
    execute(buildRestoreCommissioningDefaults(), parseCommandResponse);

  return {
    host,
    port,
    timeout,
    getSettings,
    getStatus,
    setBoost,
    setSummerBypass,
    setHomeSettings,
    setInstallerSettings,
    setSpigotType,
    filterMaintenanceComplete,
    restoreHomeDefaults,
    restoreInstallerDefaults,
    restoreCommissioningDefaults,
  };
};

export type EnviroventClient = ReturnType<typeof createEnviroventClient>;
