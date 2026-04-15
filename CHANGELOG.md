# Changelog

## v0.3.1

### Bug Fixes

- Fix npm package including 45 MB of unnecessary files (decompiled Android app, IDE config) by updating `.npmignore`

## v0.3.0

### Features

- Add changelog for Homebridge UI visibility
- Add repository metadata to package.json

## v0.2.5

### Refactors

- Update log messages for clarity and consistency across components ([46342f9](https://github.com/lk9100/homebridge-envirovent/commit/46342f9))

## v0.2.4

### Refactors

- Improve error handling and add tests for airflow configuration edge cases ([c58a9c7](https://github.com/lk9100/homebridge-envirovent/commit/c58a9c7))
- Enhance command validation and error handling for improved robustness ([434888a](https://github.com/lk9100/homebridge-envirovent/commit/434888a))
- Update async handling in command execution and service methods ([06c0e13](https://github.com/lk9100/homebridge-envirovent/commit/06c0e13))
- Transition to factory functions for client and service creation ([5c04139](https://github.com/lk9100/homebridge-envirovent/commit/5c04139))
- Streamline function declarations and enhance code consistency ([c1f342e](https://github.com/lk9100/homebridge-envirovent/commit/c1f342e))

### Bug Fixes

- **FanService:** Refine fan behavior and optimistic update logic for improved state management ([761b729](https://github.com/lk9100/homebridge-envirovent/commit/761b729))

## v0.2.2

### Bug Fixes

- **FanService:** Implement immediate optimistic updates for grace period protection ([e9f1344](https://github.com/lk9100/homebridge-envirovent/commit/e9f1344))
- **FanService:** Update minimum RotationSpeed to 1% for accurate status representation ([a86191e](https://github.com/lk9100/homebridge-envirovent/commit/a86191e))

## v0.2.0

### Bug Fixes

- **FanService:** Map HomeKit RotationSpeed (0-100%) to unit range (24-100%) for accurate control ([214c0f7](https://github.com/lk9100/homebridge-envirovent/commit/214c0f7))

## v0.1.7

### Bug Fixes

- **FanService:** Implement optimistic update grace period to prevent stale poll overwrites ([3095c25](https://github.com/lk9100/homebridge-envirovent/commit/3095c25))

## v0.1.6

### Bug Fixes

- **FanService:** Apply optimistic update for RotationSpeed to prevent stale values ([f74ca28](https://github.com/lk9100/homebridge-envirovent/commit/f74ca28))

## v0.1.5

### Refactors

- Refactor FanService to prevent invalid RotationSpeed values and ensure UI consistency ([cf17fbb](https://github.com/lk9100/homebridge-envirovent/commit/cf17fbb))
- Update build configuration and add tsconfig.build.json ([aa5d541](https://github.com/lk9100/homebridge-envirovent/commit/aa5d541))

## v0.1.4

### Refactors

- Refactor FanService to use actual VAR percentage range and improve Active characteristic handling ([3811896](https://github.com/lk9100/homebridge-envirovent/commit/3811896))
- Refactor fan service to handle minimum airflow settings and update HomeKit characteristics ([63c774a](https://github.com/lk9100/homebridge-envirovent/commit/63c774a))
- Update poll interval to 5 seconds ([a8e4add](https://github.com/lk9100/homebridge-envirovent/commit/a8e4add))

## v0.1.1

- Initial release with Homebridge plugin for Envirovent PIV ventilation units
