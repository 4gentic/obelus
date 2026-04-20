# Security

## The threat model, explicitly

Obelus processes academic drafts before publication. The design assumes your paper is sensitive IP.

- **Paper bytes never leave the device.** PDFs live in OPFS; annotations live in IndexedDB. The service worker precaches all assets; the app functions with no network.
- **No runtime network calls.** No telemetry, no analytics, no counters. The web app has zero network surface at runtime.

## Audit surfaces

- `scripts/guard-network.mjs` — grep that fails CI if any code path calls `fetch`, `XMLHttpRequest`, `sendBeacon`, or named-vendor analytics.

## Reporting

Email `security@obelus.app` with details. We respond within 7 days. No bounty, just credit and thanks.
