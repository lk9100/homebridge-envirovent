/**
 * Command builders (produce JSON strings) and response parsers (raw JSON → typed domain objects).
 *
 * All functions are pure — no I/O, no side effects. This makes them trivial to test.
 * The wire protocol uses 0/1 for booleans; conversion happens here.
 */

import { CommandError, ParseError, ValidationError } from './errors.js';
import {
  VALID_BOOST_MINS,
  VALID_FILTER_RESET_MONTHS,
  HEATER_TEMP_RANGE,
  SUMMER_TEMP_RANGE,
  type AirflowConfiguration,
  type AirflowMap,
  type AirflowMode,
  type CommandResponse,
  type GetCurrentSettingsResponse,
  type PivSettings,
  type SetHomeSettingsParams,
  type SetInstallerSettingsParams,
  type SpigotType,
} from './types.js';

// ─── Wire format helpers ────────────────────────────────────────────

/** Convert boolean to the unit's 0/1 integer format */
const boolToInt = (v: boolean): number => (v ? 1 : 0);

/** Convert the unit's 0/1 integer to boolean */
const intToBool = (v: unknown): boolean => v === 1 || v === true;

/** Safely read a nested object property */
const getObj = (obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const val = obj[key];
  return typeof val === 'object' && val !== null ? (val as Record<string, unknown>) : undefined;
};

const getNum = (obj: Record<string, unknown>, key: string, fallback: number = 0): number => {
  const val = obj[key];
  return typeof val === 'number' ? val : fallback;
};

const getStr = (obj: Record<string, unknown>, key: string): string | undefined => {
  const val = obj[key];
  return typeof val === 'string' ? val : undefined;
};

// ─── Validation helpers ─────────────────────────────────────────────

const validateBoostMins = (mins: number): void => {
  if (!(VALID_BOOST_MINS as readonly number[]).includes(mins)) {
    throw new ValidationError(`boost.mins must be one of [${VALID_BOOST_MINS.join(', ')}], got ${mins}`);
  }
};

const validateFilterResetMonths = (months: number): void => {
  if (!(VALID_FILTER_RESET_MONTHS as readonly number[]).includes(months)) {
    throw new ValidationError(`filter.resetMonths must be one of [${VALID_FILTER_RESET_MONTHS.join(', ')}], got ${months}`);
  }
};

const validateRange = (value: number, range: { min: number; max: number }, name: string): void => {
  if (value < range.min || value > range.max) {
    throw new ValidationError(`${name} must be between ${range.min} and ${range.max}, got ${value}`);
  }
};

const validateSpigotType = (type: number): void => {
  if (type !== 1 && type !== 2) {
    throw new ValidationError(`spigot.type must be 1 or 2, got ${type}`);
  }
};

// ─── Command builders ───────────────────────────────────────────────

export const buildGetCurrentSettings = (): string =>
  JSON.stringify({ command: 'GetCurrentSettings' });

export const buildGetStatus = (): string =>
  JSON.stringify({ command: 'GetStatus' });

export const buildSetBoost = (enabled: boolean): string =>
  JSON.stringify({ command: 'SetBoost', enabled: boolToInt(enabled) });

export const buildSetSummerBypass = (enabled: boolean): string =>
  JSON.stringify({ command: 'SetSummerBypass', enabled: boolToInt(enabled) });

export const buildSetHomeSettings = (params: SetHomeSettingsParams): string => {
  validateBoostMins(params.boost.mins);
  validateFilterResetMonths(params.filter.resetMonths);

  return JSON.stringify({
    command: 'SetHomeSettings',
    settings: {
      airflow: {
        mode: params.airflow.mode,
        value: params.airflow.value,
      },
      heater: {
        autoActive: boolToInt(params.heater.autoActive),
      },
      boost: {
        mins: params.boost.mins,
      },
      filter: {
        resetMonths: params.filter.resetMonths,
      },
      summerBypass: {
        summerShutdown: boolToInt(params.summerBypass.summerShutdown),
      },
    },
  });
};

export const buildSetInstallerSettings = (params: SetInstallerSettingsParams): string => {
  validateBoostMins(params.boost.mins);
  validateFilterResetMonths(params.filter.resetMonths);
  validateRange(params.heater.temperature, HEATER_TEMP_RANGE, 'heater.temperature');
  validateRange(params.summerBypass.temperature, SUMMER_TEMP_RANGE, 'summerBypass.temperature');
  validateSpigotType(params.spigot.type);

  return JSON.stringify({
    command: 'SetInstallerSettings',
    settings: {
      airflow: {
        mode: params.airflow.mode,
        value: params.airflow.value,
      },
      heater: {
        autoActive: boolToInt(params.heater.autoActive),
        temperature: params.heater.temperature,
      },
      boost: {
        mins: params.boost.mins,
      },
      filter: {
        resetMonths: params.filter.resetMonths,
      },
      summerBypass: {
        temperature: params.summerBypass.temperature,
        summerShutdown: boolToInt(params.summerBypass.summerShutdown),
      },
      spigot: {
        type: params.spigot.type,
      },
    },
  });
};

export const buildFilterMaintenanceComplete = (): string =>
  JSON.stringify({ command: 'FilterMaintenanceComplete' });

export const buildSetSpigotType = (type: SpigotType): string =>
  JSON.stringify({ command: 'SetSpigotType', type });

export const buildRestoreHomeDefaults = (): string =>
  JSON.stringify({ command: 'RestoreHomeSettingsToFactoryDefaults' });

export const buildRestoreInstallerDefaults = (): string =>
  JSON.stringify({ command: 'RestoreInstallerSettingsToFactoryDefaults' });

export const buildRestoreCommissioningDefaults = (): string =>
  JSON.stringify({ command: 'RestoreCommissioningSettingsToFactoryDefaults' });

// ─── WiFi setup commands ────────────────────────────────────────────

export const buildGetWifiNetworks = (): string =>
  JSON.stringify({ command: 'GetWifiNetworks' });

export const buildConnectToNetwork = (ssid: string, key: string, securityType: string): string =>
  JSON.stringify({ command: 'ConnectToNetwork', ssid, key, securityType });

export const buildResetAccessPoint = (): string =>
  JSON.stringify({ command: 'ResetAccessPoint' });

// ─── Response parsers ───────────────────────────────────────────────

/** Parse the base response envelope. Throws CommandError on failure responses. */
export const parseCommandResponse = (raw: string): CommandResponse => {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ParseError('Invalid JSON', raw);
  }

  const success = intToBool(json['success']);
  const noResponse = intToBool(json['noresponse']);
  const error = getStr(json, 'error');

  if (!success) {
    if (error) {
      throw new CommandError(error);
    }
    return { success: false, noResponse, error };
  }

  return { success: true };
};

/** Parse a GetCurrentSettings response into typed PivSettings. */
export const parseGetCurrentSettings = (raw: string): GetCurrentSettingsResponse => {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ParseError('Invalid JSON', raw);
  }

  const success = intToBool(json['success']);
  if (!success) {
    const error = getStr(json, 'error');
    if (error) throw new CommandError(error);
    return {
      success: false,
      unitType: '',
      noResponse: intToBool(json['noresponse']),
      settings: undefined as unknown as PivSettings,
    };
  }

  const unitType = getStr(json, 'unitType') ?? 'unknown';
  const softwareVersion = getStr(json, 'softwareVersion');
  const settingsObj = getObj(json, 'settings');
  if (!settingsObj) {
    throw new ParseError('Missing "settings" object in response', raw);
  }

  const settings = parseSettings(settingsObj, json);

  return { success: true, unitType, softwareVersion, settings };
};

const parseSettings = (settingsObj: Record<string, unknown>, rootJson: Record<string, unknown>): PivSettings => {
  const airflowObj = getObj(settingsObj, 'airflow') ?? {};
  const heaterObj = getObj(settingsObj, 'heater') ?? {};
  const boostObj = getObj(settingsObj, 'boost') ?? {};
  const boostInputObj = getObj(settingsObj, 'boostInput') ?? {};
  const filterObj = getObj(settingsObj, 'filter') ?? {};
  const summerBypassObj = getObj(settingsObj, 'summerBypass') ?? {};
  const spigotObj = getObj(settingsObj, 'spigot') ?? {};
  const kickUpObj = getObj(settingsObj, 'kickUp') ?? {};

  const rawMode = getStr(airflowObj, 'mode') ?? 'SET';
  const airflowMode: AirflowMode = rawMode.toUpperCase() === 'VAR' ? 'VAR' : 'SET';

  return {
    airflow: {
      mode: airflowMode,
      value: getNum(airflowObj, 'value'),
      active: intToBool(airflowObj['active']),
    },
    airflowConfiguration: parseAirflowConfiguration(getObj(rootJson, 'airflowConfiguration')),
    heater: {
      autoActive: intToBool(heaterObj['autoActive']),
      temperature: getNum(heaterObj, 'temperature'),
    },
    boost: {
      enabled: intToBool(boostObj['enabled']),
      mins: getNum(boostObj, 'mins'),
    },
    boostInput: {
      enabled: intToBool(boostInputObj['enabled']),
    },
    filter: {
      remainingDays: getNum(filterObj, 'remainingDays'),
      resetMonths: getNum(filterObj, 'resetMonths'),
    },
    summerBypass: {
      active: intToBool(summerBypassObj['active']),
      temperature: getNum(summerBypassObj, 'temperature'),
      summerShutdown: intToBool(summerBypassObj['summerShutdown']),
    },
    spigot: {
      type: (getNum(spigotObj, 'type', 1) === 2 ? 2 : 1) as SpigotType,
      canChange: intToBool(spigotObj['canChange']),
    },
    kickUp: {
      active: intToBool(kickUpObj['active']),
    },
    hoursRun: getNum(settingsObj, 'hoursRun'),
  };
};

const parseAirflowConfiguration = (configObj: Record<string, unknown> | undefined): AirflowConfiguration => {
  if (!configObj) {
    return { maps: [], minPercentage: 0, maxPercentage: 100, varMinPercentage: 0 };
  }

  const mapsArray = configObj['maps'];
  if (!Array.isArray(mapsArray) || mapsArray.length === 0) {
    return { maps: [], minPercentage: 0, maxPercentage: 100, varMinPercentage: 0 };
  }

  const rawMaps: AirflowMap[] = mapsArray.map((entry: Record<string, unknown>) => ({
    mark: getNum(entry, 'mark'),
    percent: getNum(entry, 'percent'),
  }));

  // First and last entries define the absolute min/max bounds
  const minPercentage = rawMaps[0]?.percent ?? 0;
  const maxPercentage = rawMaps[rawMaps.length - 1]?.percent ?? 100;

  // The selectable presets are everything between first and last.
  // Android app decrements mark by 1 (marks are 1-indexed from the unit).
  const maps = rawMaps.slice(1, -1).map((m) => ({
    mark: m.mark - 1,
    percent: m.percent,
  }));

  // VAR mode floor: the first selectable preset's percentage.
  // Values below this get clamped by the unit (verified via live testing).
  const varMinPercentage = maps[0]?.percent ?? minPercentage;

  return { maps, minPercentage, maxPercentage, varMinPercentage };
};
