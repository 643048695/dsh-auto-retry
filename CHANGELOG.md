# Changelog

[中文](CHANGELOG.zh.md) | English

All notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-29

First public release.

### Added

- **Host half (`lib/index.js`)** — an `agent/request-error` waterfall listener registered with `{ prepend: true }`, so it sees a failed model request before any other recovery layer. It waits, then returns `{ kind: "retry" }` to replay the same step.
- **Four-step backoff ladder** — 2s / 5s / 10s / 20s, ≈37s worst case. Counters are keyed by `provider + turn + step`, so only the failed step is replayed.
- **Abort awareness** — `signal.aborted` before or during the wait abandons the retry instead of sleeping through it.
- **Settings schema** — three `volatile` fields (`enabled`, `maxRetries`, `log`) so the settings page edits them and the host half reads them live at each failure.
- **Explicit exhaustion log** — when the cap is reached the plugin logs that it is stopping rather than silently swallowing the error.

### Notes

- Retrying is intentionally unconditional (no status-code filter): proxy gateways frequently report quota and unknown-model failures as a bare `upstream_error`. The trade-off is documented in the README.
