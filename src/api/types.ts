/**
 * Envirovent Atmos PIV API type definitions.
 *
 * These types represent the domain model after parsing the unit's raw JSON responses.
 * Booleans are proper booleans (the wire protocol uses 0/1 integers).
 */

// ─── Enums ───────────────────────────────────────────────────────────

export const AirflowMode = {
  /** Discrete preset marks (1-5), mapped to specific percentages via airflow configuration */
  Preset: 'SET',
  /** Continuous percentage control within min-max range */
  Variable: 'VAR',
} as const;

export type AirflowMode = (typeof AirflowMode)[keyof typeof AirflowMode];

export const SpigotType = {
  Single: 1,
  Twin: 2,
} as const;

export type SpigotType = (typeof SpigotType)[keyof typeof SpigotType];

// ─── Settings sub-objects ────────────────────────────────────────────

export interface AirflowSettings {
  mode: AirflowMode;
  /** Preset number (if mode=SET) or percentage (if mode=VAR) */
  value: number;
  active: boolean;
}

export interface AirflowMap {
  mark: number;
  percent: number;
}

export interface AirflowConfiguration {
  maps: AirflowMap[];
  /** Absolute minimum percentage (SET mode mark 1). Not reachable in VAR mode. */
  minPercentage: number;
  /** Maximum percentage (100%). */
  maxPercentage: number;
  /** Lowest percentage VAR mode accepts (first selectable preset). Use this for slider range. */
  varMinPercentage: number;
}

export interface HeaterSettings {
  autoActive: boolean;
  /** Activation threshold in °C (5-15). Heater turns on when intake air drops below this. */
  temperature: number;
}

export interface BoostSettings {
  enabled: boolean;
  /** Boost duration in minutes. Valid values: 20, 40, 60, 720 */
  mins: number;
}

export interface BoostInputSettings {
  /** Whether the external boost input is currently active (read-only) */
  enabled: boolean;
}

export interface FilterSettings {
  /** Days until filter needs changing. 0 = needs changing now. */
  remainingDays: number;
  /** Filter reset interval in months. Valid values: 12, 24, 36, 48, 60 */
  resetMonths: number;
}

export interface SummerBypassSettings {
  active: boolean;
  /** Shutdown threshold in °C (18-28). Unit stops when intake air rises above this. */
  temperature: number;
  /** Whether summer shutdown mode is enabled */
  summerShutdown: boolean;
}

export interface SpigotSettings {
  type: SpigotType;
  canChange: boolean;
}

export interface KickUpSettings {
  active: boolean;
}

// ─── Full settings response ──────────────────────────────────────────

export interface PivSettings {
  airflow: AirflowSettings;
  airflowConfiguration: AirflowConfiguration;
  heater: HeaterSettings;
  boost: BoostSettings;
  boostInput: BoostInputSettings;
  filter: FilterSettings;
  summerBypass: SummerBypassSettings;
  spigot: SpigotSettings;
  kickUp: KickUpSettings;
  hoursRun: number;
}

// ─── Command responses ───────────────────────────────────────────────

export interface CommandResponse {
  success: boolean;
  error?: string | undefined;
  noResponse?: boolean;
}

export interface GetCurrentSettingsResponse extends CommandResponse {
  unitType: string;
  softwareVersion?: string | undefined;
  settings: PivSettings;
}

export interface GetStatusResponse extends CommandResponse {}

export interface SetBoostResponse extends CommandResponse {}

export interface SetSummerBypassResponse extends CommandResponse {}

export interface SetHomeSettingsResponse extends CommandResponse {}

export interface SetInstallerSettingsResponse extends CommandResponse {}

export interface SetSpigotTypeResponse extends CommandResponse {}

export interface FilterMaintenanceCompleteResponse extends CommandResponse {}

export interface RestoreDefaultsResponse extends CommandResponse {}

// ─── Command parameters ─────────────────────────────────────────────

export interface SetHomeSettingsParams {
  airflow: {
    mode: AirflowMode;
    value: number;
  };
  heater: {
    autoActive: boolean;
  };
  boost: {
    mins: number;
  };
  filter: {
    resetMonths: number;
  };
  summerBypass: {
    summerShutdown: boolean;
  };
}

export interface SetInstallerSettingsParams {
  airflow: {
    mode: AirflowMode;
    value: number;
  };
  heater: {
    autoActive: boolean;
    temperature: number;
  };
  boost: {
    mins: number;
  };
  filter: {
    resetMonths: number;
  };
  summerBypass: {
    temperature: number;
    summerShutdown: boolean;
  };
  spigot: {
    type: SpigotType;
  };
}

// ─── Discovery ──────────────────────────────────────────────────────

export interface DiscoveredUnit {
  name: string;
  host: string;
  port: number;
  unitType: string;
}

// ─── Client config ──────────────────────────────────────────────────

export interface EnviroventClientConfig {
  host: string;
  port?: number;
  timeout?: number;
}

// ─── Constants ──────────────────────────────────────────────────────

export const DEFAULTS = {
  PORT: 1337,
  TIMEOUT: 10_000,
  DISCOVERY_TIMEOUT: 5_000,
  SERVICE_TYPE: '_http._tcp',
} as const;

export const VALID_BOOST_MINS = [20, 40, 60, 720] as const;
export const VALID_FILTER_RESET_MONTHS = [12, 24, 36, 48, 60] as const;

export const HEATER_TEMP_RANGE = { min: 5, max: 15 } as const;
export const SUMMER_TEMP_RANGE = { min: 18, max: 28 } as const;
