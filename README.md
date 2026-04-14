# homebridge-envirovent

Homebridge plugin for **Envirovent Atmos PIV** (Positive Input Ventilation) units. Provides local network control via HomeKit — no cloud, no account, no internet required.

## Features

- **Fan speed control** — continuous slider mapped to the unit's 24–100% airflow range
- **Boost mode** — toggle switch, usable in HomeKit scenes and automations
- **Filter status** — shows filter life remaining and alerts when replacement is needed
- **Local-only** — communicates directly with the unit over your LAN (TCP port 1337)
- **No polling flood** — configurable poll interval with debounced commands

## Requirements

- Node.js 22+
- Homebridge 1.8+ or 2.0 beta
- Envirovent Atmos PIV unit connected to your home WiFi

## Installation

```bash
npm install -g homebridge-envirovent
```

Or search for `homebridge-envirovent` in the Homebridge UI plugins tab.

## Configuration

Add to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "EnviroventPIV",
      "name": "Envirovent PIV",
      "host": "192.168.1.160",
      "pollInterval": 5,
      "showBoostSwitch": true
    }
  ]
}
```

| Option | Required | Default | Description |
|---|---|---|---|
| `platform` | Yes | — | Must be `"EnviroventPIV"` |
| `name` | No | `"Envirovent PIV"` | Display name in HomeKit |
| `host` | Yes | — | IP address of your unit |
| `port` | No | `1337` | TCP port |
| `pollInterval` | No | `5` | Seconds between status polls (min: 5) |
| `showBoostSwitch` | No | `true` | Expose boost as a separate switch for scenes/automations |

### Finding your unit's IP

Your Atmos PIV unit advertises itself via mDNS (`_http._tcp`). You can find its IP address through:

- Your router's DHCP client list
- The official myenvirovent app (under device info)
- Your UniFi controller's client list

> **Tip:** Assign a static IP / DHCP reservation so the address doesn't change.

## HomeKit services

| Service | Description |
|---|---|
| **Fanv2** | Main fan tile with speed slider. 0% = unit minimum (24%), 100% = maximum airflow. |
| **Switch** (Boost) | Toggles boost mode. Auto-turns off when the unit's boost timer expires. Great for scenes like "Cooking Mode". |
| **FilterMaintenance** | Shows filter life percentage and alerts when the filter needs replacing. |

## How it works

The Envirovent Atmos PIV runs a TCP server on port 1337 that accepts JSON commands. This plugin communicates directly with the unit — no cloud relay, no Envirovent account needed.

The protocol was reverse-engineered from the official myenvirovent Android app and verified against a real unit running firmware v2.5. Full protocol documentation is in [API-FINDINGS.md](./API-FINDINGS.md).

## Development

```bash
git clone https://github.com/your-username/homebridge-envirovent.git
cd homebridge-envirovent
nvm use
npm install
npm test          # Run tests (83 tests)
npm run build     # Compile TypeScript
npm run typecheck # Type check without emitting
```

### Project structure

```
src/
├── api/          # Standalone API client (zero homebridge deps)
│   ├── client.ts       # High-level EnviroventClient
│   ├── connection.ts   # TCP socket transport
│   ├── commands.ts     # Command builders + response parsers
│   ├── types.ts        # All TypeScript interfaces
│   └── errors.ts       # Typed error hierarchy
├── state/        # State management (zero homebridge deps)
│   ├── unit-state.ts   # Reactive state with polling + optimistic updates
│   └── command-queue.ts # Serialized command execution with retry
└── homebridge/   # Homebridge integration
    ├── platform.ts     # DynamicPlatformPlugin
    ├── accessory.ts    # Accessory orchestrator
    └── services/       # HomeKit service handlers
        ├── fan.ts      # Fanv2 — airflow speed
        ├── boost.ts    # Switch — boost toggle
        └── filter.ts   # FilterMaintenance — filter status
```

The `api/` and `state/` layers have no Homebridge dependencies and can be used as a standalone client library.

### Testing against a real unit

```bash
# Read-only: fetch and display unit settings
npx tsx scripts/test-unit.ts 192.168.1.160
```

## Acknowledgements

Protocol reverse-engineered from the [myenvirovent](https://play.google.com/store/apps/details?id=com.envirovent.myandroid) Android app using jadx.

## License

MIT
