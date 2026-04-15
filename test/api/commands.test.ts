import { describe, it, expect } from 'vitest';
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
  buildGetWifiNetworks,
  buildConnectToNetwork,
  buildResetAccessPoint,
  parseCommandResponse,
  parseGetCurrentSettings,
} from '../../src/api/commands.js';
import { CommandError, ParseError } from '../../src/api/errors.js';
import { pivSettingsResponse } from '../fixtures.js';

// ─── Command builders ───────────────────────────────────────────────

describe('command builders', () => {
  it('buildGetCurrentSettings', () => {
    expect(JSON.parse(buildGetCurrentSettings())).toEqual({ command: 'GetCurrentSettings' });
  });

  it('buildGetStatus', () => {
    expect(JSON.parse(buildGetStatus())).toEqual({ command: 'GetStatus' });
  });

  it('buildSetBoost enabled', () => {
    expect(JSON.parse(buildSetBoost(true))).toEqual({ command: 'SetBoost', enabled: 1 });
  });

  it('buildSetBoost disabled', () => {
    expect(JSON.parse(buildSetBoost(false))).toEqual({ command: 'SetBoost', enabled: 0 });
  });

  it('buildSetSummerBypass enabled', () => {
    expect(JSON.parse(buildSetSummerBypass(true))).toEqual({ command: 'SetSummerBypass', enabled: 1 });
  });

  it('buildSetHomeSettings', () => {
    const result = JSON.parse(buildSetHomeSettings({
      airflow: { mode: 'VAR', value: 50 },
      heater: { autoActive: true },
      boost: { mins: 60 },
      filter: { resetMonths: 24 },
      summerBypass: { summerShutdown: false },
    }));

    expect(result).toEqual({
      command: 'SetHomeSettings',
      settings: {
        airflow: { mode: 'VAR', value: 50 },
        heater: { autoActive: 1 },
        boost: { mins: 60 },
        filter: { resetMonths: 24 },
        summerBypass: { summerShutdown: 0 },
      },
    });
  });

  it('buildSetInstallerSettings', () => {
    const result = JSON.parse(buildSetInstallerSettings({
      airflow: { mode: 'SET', value: 3 },
      heater: { autoActive: true, temperature: 10 },
      boost: { mins: 40 },
      filter: { resetMonths: 36 },
      summerBypass: { temperature: 25, summerShutdown: true },
      spigot: { type: 2 },
    }));

    expect(result.command).toBe('SetInstallerSettings');
    expect(result.settings.heater).toEqual({ autoActive: 1, temperature: 10 });
    expect(result.settings.spigot).toEqual({ type: 2 });
    expect(result.settings.summerBypass).toEqual({ temperature: 25, summerShutdown: 1 });
  });

  it('buildFilterMaintenanceComplete', () => {
    expect(JSON.parse(buildFilterMaintenanceComplete())).toEqual({ command: 'FilterMaintenanceComplete' });
  });

  it('buildSetSpigotType single', () => {
    expect(JSON.parse(buildSetSpigotType(1))).toEqual({ command: 'SetSpigotType', type: 1 });
  });

  it('buildSetSpigotType twin', () => {
    expect(JSON.parse(buildSetSpigotType(2))).toEqual({ command: 'SetSpigotType', type: 2 });
  });

  it('buildRestoreHomeDefaults', () => {
    expect(JSON.parse(buildRestoreHomeDefaults())).toEqual({ command: 'RestoreHomeSettingsToFactoryDefaults' });
  });

  it('buildRestoreInstallerDefaults', () => {
    expect(JSON.parse(buildRestoreInstallerDefaults())).toEqual({ command: 'RestoreInstallerSettingsToFactoryDefaults' });
  });

  it('buildRestoreCommissioningDefaults', () => {
    expect(JSON.parse(buildRestoreCommissioningDefaults())).toEqual({ command: 'RestoreCommissioningSettingsToFactoryDefaults' });
  });

  it('buildGetWifiNetworks', () => {
    expect(JSON.parse(buildGetWifiNetworks())).toEqual({ command: 'GetWifiNetworks' });
  });

  it('buildConnectToNetwork', () => {
    expect(JSON.parse(buildConnectToNetwork('MySSID', 'pass123', 'WPA2'))).toEqual({
      command: 'ConnectToNetwork',
      ssid: 'MySSID',
      key: 'pass123',
      securityType: 'WPA2',
    });
  });

  it('buildResetAccessPoint', () => {
    expect(JSON.parse(buildResetAccessPoint())).toEqual({ command: 'ResetAccessPoint' });
  });
});

// ─── Response parsers ───────────────────────────────────────────────

describe('parseCommandResponse', () => {
  it('parses a success response', () => {
    const result = parseCommandResponse('{"success":1}');
    expect(result.success).toBe(true);
  });

  it('throws CommandError for error responses', () => {
    expect(() => parseCommandResponse('{"success":0,"error":"something broke"}'))
      .toThrow(CommandError);
  });

  it('returns failure for no-response', () => {
    const result = parseCommandResponse('{"success":0,"noresponse":1}');
    expect(result.success).toBe(false);
    expect(result.noResponse).toBe(true);
  });

  it('throws ParseError for invalid JSON', () => {
    expect(() => parseCommandResponse('not json')).toThrow(ParseError);
  });
});

describe('parseGetCurrentSettings', () => {
  it('parses a full PIV settings response', () => {
    const result = parseGetCurrentSettings(JSON.stringify(pivSettingsResponse));
    expect(result.success).toBe(true);
    expect(result.unitType).toBe('piv');

    const s = result.settings;
    expect(s.airflow.mode).toBe('VAR');
    expect(s.airflow.value).toBe(45);
    expect(s.airflow.active).toBe(true);
    expect(s.heater.autoActive).toBe(true);
    expect(s.heater.temperature).toBe(12);
    expect(s.boost.enabled).toBe(false);
    expect(s.boost.mins).toBe(20);
    expect(s.boostInput.enabled).toBe(false);
    expect(s.filter.remainingDays).toBe(180);
    expect(s.filter.resetMonths).toBe(12);
    expect(s.summerBypass.active).toBe(false);
    expect(s.summerBypass.temperature).toBe(22);
    expect(s.summerBypass.summerShutdown).toBe(true);
    expect(s.spigot.type).toBe(1);
    expect(s.spigot.canChange).toBe(false);
    expect(s.kickUp.active).toBe(false);
    expect(s.hoursRun).toBe(8760);
  });

  it('parses airflow configuration maps correctly', () => {
    const result = parseGetCurrentSettings(JSON.stringify(pivSettingsResponse));
    const config = result.settings.airflowConfiguration;

    // First entry (mark:1, percent:20) → absolute minPercentage
    expect(config.minPercentage).toBe(20);
    // Last entry (mark:5, percent:100) → maxPercentage
    expect(config.maxPercentage).toBe(100);
    // Middle entries are the selectable presets (marks decremented by 1)
    expect(config.maps).toEqual([
      { mark: 1, percent: 40 },
      { mark: 2, percent: 60 },
      { mark: 3, percent: 80 },
    ]);
    // VAR mode floor is the first selectable preset
    expect(config.varMinPercentage).toBe(40);
  });

  it('handles SET airflow mode', () => {
    const response = {
      ...pivSettingsResponse,
      settings: {
        ...pivSettingsResponse.settings,
        airflow: { mode: 'SET', value: 3, active: 1 },
      },
    };
    const result = parseGetCurrentSettings(JSON.stringify(response));
    expect(result.settings.airflow.mode).toBe('SET');
    expect(result.settings.airflow.value).toBe(3);
  });

  it('handles twin spigot type', () => {
    const response = {
      ...pivSettingsResponse,
      settings: {
        ...pivSettingsResponse.settings,
        spigot: { type: 2, canChange: 1 },
      },
    };
    const result = parseGetCurrentSettings(JSON.stringify(response));
    expect(result.settings.spigot.type).toBe(2);
    expect(result.settings.spigot.canChange).toBe(true);
  });

  it('handles missing airflowConfiguration gracefully', () => {
    const { airflowConfiguration: _, ...responseWithoutConfig } = pivSettingsResponse;
    const result = parseGetCurrentSettings(JSON.stringify(responseWithoutConfig));
    expect(result.settings.airflowConfiguration.maps).toEqual([]);
    expect(result.settings.airflowConfiguration.minPercentage).toBe(0);
    expect(result.settings.airflowConfiguration.maxPercentage).toBe(100);
    expect(result.settings.airflowConfiguration.varMinPercentage).toBe(0);
  });

  it('handles missing sub-objects with defaults', () => {
    const response = { success: 1, unitType: 'piv', settings: {} };
    const result = parseGetCurrentSettings(JSON.stringify(response));
    expect(result.settings.airflow.mode).toBe('SET');
    expect(result.settings.airflow.value).toBe(0);
    expect(result.settings.boost.enabled).toBe(false);
    expect(result.settings.heater.autoActive).toBe(false);
  });

  it('throws CommandError on error response', () => {
    expect(() =>
      parseGetCurrentSettings('{"success":0,"error":"unit busy"}'),
    ).toThrow(CommandError);
  });

  it('throws ParseError on invalid JSON', () => {
    expect(() => parseGetCurrentSettings('garbage')).toThrow(ParseError);
  });

  it('throws ParseError when settings object is missing in success response', () => {
    expect(() =>
      parseGetCurrentSettings('{"success":1,"unitType":"piv"}'),
    ).toThrow(ParseError);
  });

  it('returns failure response without throwing when success=0 and no error string', () => {
    const result = parseGetCurrentSettings('{"success":0}');
    expect(result.success).toBe(false);
  });

  it('parses softwareVersion from response', () => {
    const response = { ...pivSettingsResponse, softwareVersion: '2.5' };
    const result = parseGetCurrentSettings(JSON.stringify(response));
    expect(result.softwareVersion).toBe('2.5');
  });

  it('handles missing softwareVersion gracefully', () => {
    const result = parseGetCurrentSettings(JSON.stringify(pivSettingsResponse));
    expect(result.softwareVersion).toBeUndefined();
  });
});
