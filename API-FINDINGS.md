# Envirovent Atmos PIV - Local API Reference

> Reverse-engineered from the myenvirovent Android app v1.9 (com.envirovent.myandroid).
> PIV (Positive Input Ventilation) unit only — MVHR commands excluded.

---

## Protocol Overview

The Envirovent Atmos PIV uses a **raw TCP socket** protocol with **JSON payloads**. No HTTP, no MQTT, no WebSocket — just plain TCP.

| Property | Value |
|---|---|
| Transport | Raw TCP socket |
| Port | **1337** |
| Format | JSON (UTF-8 encoded) |
| Auth | **None** — no tokens, no passwords, no handshake |
| Connection model | **One connection per command** (connect → send → receive → close) |
| Concurrency | **Single-threaded** — app uses a global lock, one command at a time |
| Socket timeout | 10,000ms |
| Read strategy | 1024-byte chunks; stops reading when a chunk is less than 1024 bytes |

---

## Discovery

The unit advertises itself on the local network via **mDNS** (Android NSD / Bonjour).

| Property | Value |
|---|---|
| Service type | `_http._tcp` |
| Discovery flow | mDNS browse → resolve to IP → send `GetCurrentSettings` → check `unitType` |

The app's discovery flow:
1. Browse for `_http._tcp` services via NSD
2. Resolve each found service to get its IP address
3. Send `{"command": "GetCurrentSettings"}` to `<ip>:1337`
4. If response contains `"unitType": "piv"`, it's an Atmos PIV unit
5. Display the unit as "PIV Unit" in the app

---

## Response Format

All responses share a common envelope:

### Success
```json
{
  "success": 1,
  ...response-specific fields...
}
```

### Error
```json
{
  "success": 0,
  "error": "error message here"
}
```

### No response (client-generated when unit doesn't reply)
```json
{
  "success": 0,
  "noresponse": 1
}
```

**Important: Booleans are integers** — `0` = false, `1` = true throughout the protocol.

---

## PIV Commands

### 1. GetCurrentSettings

Retrieves the full unit configuration. This is the primary read command.

**Request:**
```json
{"command": "GetCurrentSettings"}
```

**Response:**
```json
{
  "success": 1,
  "unitType": "piv",
  "settings": {
    "airflow": {
      "mode": "SET" | "VAR",
      "value": <int>,
      "active": 0 | 1
    },
    "heater": {
      "autoActive": 0 | 1,
      "temperature": <int>
    },
    "boost": {
      "enabled": 0 | 1,
      "mins": <int>
    },
    "boostInput": {
      "enabled": 0 | 1
    },
    "filter": {
      "remainingDays": <int>,
      "resetMonths": <int>
    },
    "summerBypass": {
      "active": 0 | 1,
      "temperature": <int>,
      "summerShutdown": 0 | 1
    },
    "spigot": {
      "type": 1 | 2,
      "canChange": 0 | 1
    },
    "kickUp": {
      "active": 0 | 1
    },
    "hoursRun": <int>
  },
  "airflowConfiguration": {
    "maps": [
      {"mark": 1, "percent": <int>},
      {"mark": 2, "percent": <int>},
      {"mark": 3, "percent": <int>},
      ...
    ]
  }
}
```

**Field details:**

| Field | Type | Description |
|---|---|---|
| `unitType` | string | `"PIV"` for Atmos PIV units (uppercase; use case-insensitive comparison) |
| `softwareVersion` | string | Firmware version, e.g. `"2.5"` (not present in Android app model, discovered via live testing) |
| `settings.airflow.mode` | string | `"SET"` = preset mode, `"VAR"` = variable (percentage) mode |
| `settings.airflow.value` | int | Preset number (if SET) or percentage (if VAR) |
| `settings.airflow.active` | 0/1 | Whether airflow is currently active |
| `settings.heater.autoActive` | 0/1 | Whether auto heater is enabled |
| `settings.heater.temperature` | int | Heater activation threshold in °C (range: 5-15). When intake air temperature falls **below** this value and `autoActive` is enabled, the heater turns on. |
| `settings.boost.enabled` | 0/1 | Whether boost mode is currently active |
| `settings.boost.mins` | int | Boost duration in minutes (valid: 20, 40, 60, 720) |
| `settings.boostInput.enabled` | 0/1 | Whether external boost input is active (read-only) |
| `settings.filter.remainingDays` | int | Days until filter needs changing (0 = needs changing) |
| `settings.filter.resetMonths` | int | Filter reset interval in months (valid: 12, 24, 36, 48, 60) |
| `settings.summerBypass.active` | 0/1 | Whether summer bypass is currently active |
| `settings.summerBypass.temperature` | int | Summer shutdown threshold in °C (range: 18-28). When intake air temperature rises **above** this value and `summerShutdown` is enabled, the unit stops (0 airflow). |
| `settings.summerBypass.summerShutdown` | 0/1 | Whether summer shutdown mode is enabled |
| `settings.spigot.type` | int | `1` = single spigot, `2` = twin spigot |
| `settings.spigot.canChange` | 0/1 | Whether spigot type can be changed |
| `settings.kickUp.active` | 0/1 | Whether kick-up mode is active (read-only) |
| `settings.hoursRun` | int | Total hours the unit has run |
| `airflowConfiguration.maps` | array | Maps preset marks to percentages (first/last entries are min/max bounds) |

**Airflow configuration maps (from a real unit running firmware v2.5):**

```json
"airflowConfiguration": {
  "maps": [
    {"mark": 1, "percent": 8},
    {"mark": 2, "percent": 24},
    {"mark": 3, "percent": 37},
    {"mark": 4, "percent": 50},
    {"mark": 5, "percent": 66},
    {"mark": 6, "percent": 100}
  ]
}
```

- Mark 1 (8%) and mark 6 (100%) are the absolute min/max bounds
- Selectable presets in the app are marks 2-5 (displayed as presets 1-4)
- **VAR mode supports continuous 1% control from 24% to 100%** (verified via live testing)
- Values below 24% in VAR mode get clamped to 24% by the unit
- The 8% minimum is only reachable via SET mode mark 1

**Preset marks and measured airflow rates:**

| Preset (app) | Mark (wire) | Percent | Airflow (l/s) |
|---|---|---|---|
| — (min bound) | 1 | 8% | ~10 l/s (estimated) |
| 1 | 2 | 24% | 21 l/s |
| 2 | 3 | 37% | 29 l/s |
| 3 | 4 | 50% | 38 l/s |
| 4 | 5 | 66% | 49 l/s |
| — (max/boost) | 6 | 100% | ~72 l/s (estimated) |

**Airflow estimation formula (linear fit, R² ≈ 0.999):**

```
airflow (l/s) ≈ 0.67 × percent + 4.6
```

Each 1% increase ≈ **0.67 l/s**.

**Estimated airflow per percentage (24%–100%):**

| % | l/s | % | l/s | % | l/s | % | l/s |
|---|---|---|---|---|---|---|---|
| 24 | 20.7 | 44 | 34.1 | 64 | 47.5 | 84 | 60.9 |
| 25 | 21.4 | 45 | 34.8 | 65 | 48.2 | 85 | 61.6 |
| 26 | 22.0 | 46 | 35.4 | 66 | 48.8 | 86 | 62.2 |
| 27 | 22.7 | 47 | 36.1 | 67 | 49.5 | 87 | 62.9 |
| 28 | 23.4 | 48 | 36.8 | 68 | 50.2 | 88 | 63.6 |
| 29 | 24.0 | 49 | 37.4 | 69 | 50.8 | 89 | 64.2 |
| 30 | 24.7 | 50 | 38.1 | 70 | 51.5 | 90 | 64.9 |
| 31 | 25.4 | 51 | 38.8 | 71 | 52.2 | 91 | 65.6 |
| 32 | 26.0 | 52 | 39.4 | 72 | 52.8 | 92 | 66.2 |
| 33 | 26.7 | 53 | 40.1 | 73 | 53.5 | 93 | 66.9 |
| 34 | 27.4 | 54 | 40.8 | 74 | 54.2 | 94 | 67.6 |
| 35 | 28.1 | 55 | 41.5 | 75 | 54.9 | 95 | 68.3 |
| 36 | 28.7 | 56 | 42.1 | 76 | 55.5 | 96 | 68.9 |
| 37 | 29.4 | 57 | 42.8 | 77 | 56.2 | 97 | 69.6 |
| 38 | 30.1 | 58 | 43.5 | 78 | 56.9 | 98 | 70.3 |
| 39 | 30.7 | 59 | 44.1 | 79 | 57.5 | 99 | 70.9 |
| 40 | 31.4 | 60 | 44.8 | 80 | 58.2 | 100 | 71.6 |
| 41 | 32.1 | 61 | 45.5 | 81 | 58.9 | | |
| 42 | 32.7 | 62 | 46.1 | 82 | 59.5 | | |
| 43 | 33.4 | 63 | 46.8 | 83 | 60.2 | | |

> Note: measured data points are at 24%, 37%, 50%, 66%. All other values are estimated
> from linear regression. Actual airflow may vary with ductwork, filter condition, and
> installation specifics.

---

### 2. GetStatus

Retrieves current unit status. Response is a basic success/error envelope — the app only checks `success`.

**Request:**
```json
{"command": "GetStatus"}
```

**Response:**
```json
{"success": 1}
```

---

### 3. SetBoost

Enables or disables boost mode. Boost can only be enabled when the current airflow is not already at maximum.

**Request:**
```json
{"command": "SetBoost", "enabled": 1}
```
```json
{"command": "SetBoost", "enabled": 0}
```

**Response:** Standard success/error envelope.

---

### 4. SetSummerBypass

Enables or disables summer bypass.

**Request:**
```json
{"command": "SetSummerBypass", "enabled": 1}
```
```json
{"command": "SetSummerBypass", "enabled": 0}
```

**Response:** Standard success/error envelope.

---

### 5. SetHomeSettings

Sets the user-facing ("home") settings. This is what a normal user adjusts.

**Request:**
```json
{
  "command": "SetHomeSettings",
  "settings": {
    "airflow": {
      "mode": "VAR" | "SET",
      "value": <int>
    },
    "heater": {
      "autoActive": 0 | 1
    },
    "boost": {
      "mins": <int>
    },
    "filter": {
      "resetMonths": <int>
    },
    "summerBypass": {
      "summerShutdown": 0 | 1
    }
  }
}
```

**Field constraints:**

| Field | Valid values |
|---|---|
| `airflow.mode` | `"VAR"` (percentage) or `"SET"` (preset) |
| `airflow.value` | If VAR: percentage (min-max from `airflowConfiguration`). If SET: preset mark number. |
| `heater.autoActive` | `0` or `1` |
| `boost.mins` | `20`, `40`, `60`, or `720` (12 hours) |
| `filter.resetMonths` | `12`, `24`, `36`, `48`, or `60` |
| `summerBypass.summerShutdown` | `0` or `1` |

**Response:** Standard success/error envelope.

---

### 6. SetInstallerSettings

Sets the installer-level settings. Superset of home settings with additional fields. Requires installer access code (`16258`) in the app UI, but **no authentication is enforced at the protocol level**.

**Request:**
```json
{
  "command": "SetInstallerSettings",
  "settings": {
    "airflow": {
      "mode": "VAR" | "SET",
      "value": <int>
    },
    "heater": {
      "autoActive": 0 | 1,
      "temperature": <int>
    },
    "boost": {
      "mins": <int>
    },
    "filter": {
      "resetMonths": <int>
    },
    "summerBypass": {
      "temperature": <int>,
      "summerShutdown": 0 | 1
    },
    "spigot": {
      "type": 1 | 2
    }
  }
}
```

**Additional field constraints (beyond SetHomeSettings):**

| Field | Valid values |
|---|---|
| `heater.temperature` | `5` to `15` (°C) — heater activates when intake air drops **below** this |
| `summerBypass.temperature` | `18` to `28` (°C) — unit stops when intake air rises **above** this |
| `spigot.type` | `1` (single) or `2` (twin) |

**Response:** Standard success/error envelope.

**Note:** The "installer access code" (`16258`) is only checked in the app UI — it is **not** sent to the unit and is **not** validated by the firmware. Anyone on the network can send installer-level commands directly.

---

### 7. SetSpigotType

Sets the spigot type independently (also available within SetInstallerSettings).

**Request:**
```json
{"command": "SetSpigotType", "type": 1}
```
```json
{"command": "SetSpigotType", "type": 2}
```

| Value | Meaning |
|---|---|
| `1` | Single spigot |
| `2` | Twin spigot |

**Response:** Standard success/error envelope.

---

### 8. FilterMaintenanceComplete

Resets the filter countdown timer. After this, `filter.remainingDays` resets to `filter.resetMonths * 30`.

**Request:**
```json
{"command": "FilterMaintenanceComplete"}
```

**Response:** Standard success/error envelope.

---

### 9. RestoreHomeSettingsToFactoryDefaults

Resets home-level settings to factory defaults.

**Request:**
```json
{"command": "RestoreHomeSettingsToFactoryDefaults"}
```

**Response:** Standard success/error envelope.

**Default values (from app code):**

| Setting | Default |
|---|---|
| Airflow mode | Preset (SET) |
| Airflow value | 0 |
| Boost minutes | 30 |
| Filter reset months | 6 |
| Auto heater | Off |
| Summer mode | Off |

---

### 10. RestoreInstallerSettingsToFactoryDefaults

Resets installer-level settings to factory defaults.

**Request:**
```json
{"command": "RestoreInstallerSettingsToFactoryDefaults"}
```

**Response:** Standard success/error envelope.

**Default values (from app code):**

| Setting | Default |
|---|---|
| Airflow mode | Preset (SET) |
| Airflow value | 0 |
| Boost minutes | 30 |
| Filter reset months | 6 |
| Heater temperature | 10°C (heater activates when intake air < this) |
| Auto heater | Off |
| Summer temperature | 18°C (unit stops when intake air > this) |
| Summer mode | Off |
| Twin spigot | No (single) |

---

### 11. RestoreCommissioningSettingsToFactoryDefaults

Resets commissioning-level settings to factory defaults.

**Request:**
```json
{"command": "RestoreCommissioningSettingsToFactoryDefaults"}
```

**Response:** Standard success/error envelope.

---

## WiFi Setup Commands

These commands are used during initial unit provisioning, when the phone is connected directly to the unit's own access point (default IP: `192.168.1.1`).

### GetWifiNetworks

Scans for available WiFi networks.

**Request:**
```json
{"command": "GetWifiNetworks"}
```

**Response:** Contains available networks (exact structure TBD — verify with packet capture).

### ConnectToNetwork

Connects the unit to a WiFi network.

**Request:**
```json
{
  "command": "ConnectToNetwork",
  "ssid": "MyNetwork",
  "key": "password123",
  "securityType": "WPA2"
}
```

### ResetAccessPoint

Resets the unit's built-in access point.

**Request:**
```json
{"command": "ResetAccessPoint"}
```

---

## Constants Reference

| Constant | Value | Source |
|---|---|---|
| Unit TCP port | `1337` | `ApplicationConstants.UnitPort` |
| Socket timeout | `10000`ms | `ApplicationConstants.SocketTimeout` |
| mDNS service type | `_http._tcp` | `ApplicationConstants.ServiceType` |
| Default unit IP (AP mode) | `192.168.1.1` | `ApplicationConstants.UnitIpAddress` |
| Installer access code | `16258` | `ApplicationConstants.ValidInstallerAccessCode` |
| Unit type identifier | `"piv"` | `GetCurrentSettingsResult.ResolveUnitType()` |
| PIV dummy/test server | `137.117.201.114:10101` | `ApplicationConstants.PivDummyUnit` |
| Max resolve retries | `3` | `ApplicationConstants.MaxResolveRetryAttempts` |
| Connection failure rediscover threshold | `3` | `ApplicationConstants.UnitConnectionFailureRediscoverThreshold` |
| Connection failure threshold | `5` | `ApplicationConstants.UnitConnectionFailureThreshold` |
| Cloud API (feedback only) | `https://enviroventmobileuat.mckennaconsultants.com/` | `ApplicationConstants.BaseApiUrl` |

---

## Enumerations

### Unit Type
| Value | Meaning | Wire value |
|---|---|---|
| 0 | Unknown | (anything other than "piv" or "mvhr") |
| 2 | PIV (Atmos) | `"piv"` |

### Airflow Mode
| App constant | Wire value | Meaning |
|---|---|---|
| `0` (preset) | `"SET"` | Discrete preset marks from airflow configuration |
| `1` (variable) | `"VAR"` | Continuous percentage control |

### Airflow Presets
| Preset | Value |
|---|---|
| Mode 1 | `1` |
| Mode 2 | `2` |
| Mode 3 | `3` |
| Mode 4 | `4` |
| Mode 5 | `5` |

### Boost Duration Options
| Mark | Minutes |
|---|---|
| 1 | 20 |
| 2 | 40 |
| 3 | 60 |
| 4 | 720 (12 hours) |

### Filter Reset Options
| Mark | Months |
|---|---|
| 1 | 12 |
| 2 | 24 |
| 3 | 36 |
| 4 | 48 |
| 5 | 60 |

### Spigot Type
| Value | Meaning |
|---|---|
| `1` | Single spigot |
| `2` | Twin spigot |

---

## Security Notes

- **No authentication at the protocol level.** Anyone on the same LAN can read all settings and issue any command, including installer-level changes and factory resets.
- The "installer access code" (`16258`) is only a UI gate in the Android app — it is never transmitted to or validated by the unit.
- **Recommendation:** Use VLAN isolation on your UniFi network to restrict which devices can reach the unit's port 1337.
- The cloud API (`enviroventmobileuat.mckennaconsultants.com`) is used **only** for a feedback form (`POST /Feedback/Feedback`) — all device control is purely local.

---

## Architecture Notes (from decompilation)

- **Socket service:** PIV commands use `JSONStringSocketService` — sends the JSON as a raw UTF-8 string over TCP, receives a JSON string back.
- **No framing:** No length prefix, no delimiter, no newlines. The app reads 1024-byte chunks and stops when a read returns fewer than 1024 bytes.
- **Connection per command:** Each command opens a fresh TCP socket, sends one JSON message, reads one JSON response, then closes the socket.
- **Global mutex:** The app holds a ReentrantLock (`MyLock.mAccessLock`) around each socket transaction, ensuring only one command is in flight at a time.
- **Product variants:** The app supports both PIV (Atmos) and MVHR (Energisava) units. They share the same transport but have different command sets. PIV-specific commands are in `PivUnitApi`; shared commands (WiFi setup) are in `UnitApi`.

---

## Verification Next Steps

1. **Confirm connectivity:** `echo '{"command":"GetCurrentSettings"}' | nc <unit_ip> 1337`
2. **Capture a full response** to verify the JSON structure matches this documentation
3. **Test SetBoost** as a safe, easily reversible first write command
4. **Packet capture** via UniFi to confirm no additional traffic or cloud calls during normal operation
