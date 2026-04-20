# Launch checklist

Run top to bottom on launch morning. Nothing ships red.

## Ownership

- [ ] `obelus.app` — WHOIS resolves to our registrar account; DNS points at the web app host. Verify before day 0.
- [ ] `obelus.ink` — parked or redirected to `obelus.app`. Verify before day 0.
- [ ] `obelus-app` GitHub org — exists, owns the repo, has the correct public-members list. Verify before day 0.
- [ ] `engineering@4gentic.ai` — receives mail; route configured to on-call inbox.

## Build and verification

- [ ] `pnpm verify` green on `main` (lint, typecheck, test, network-guard, build).
- [ ] `pnpm guard:network` clean; no `fetch` / `XMLHttpRequest` / `sendBeacon` usage anywhere in the app.
- [ ] Service worker precache budget under 3 MB gzipped. Record the measured value in the release notes.
- [ ] Sample paper fixtures round-trip through `apply-revision` in LaTeX, Markdown, and Typst. Capture each diff and attach to the release.
- [ ] Bundle schema version literal matches the value the plugin validates against.

## Infrastructure

- [ ] PWA installability verified from a clean profile on Chrome, Safari, and Firefox.

## Assets

- [ ] OG image rendered to `brand/og-image.png` and referenced in `apps/web/index.html` `<meta>` tags.
- [ ] Favicon and masked-icon SVGs present; manifest icons match disk.
- [ ] Wordmark SVG committed under `brand/` with MIT license note.

## Announcements

- [ ] Launch thread scheduled — see `docs/marketing/twitter-launch.md`.
- [ ] LinkedIn post drafted in the posting account — see `docs/marketing/linkedin-launch.md`.
- [ ] HN submission title chosen and queued — see `docs/marketing/hn-title-variants.md`. Submit from the account with prior karma.
- [ ] `README.md` opening paragraph matches `docs/marketing/copy-snippets.md`.

## Post-launch watch

- [ ] `engineering@4gentic.ai` inbox monitored for the first 72 hours.
- [ ] GitHub issues triage rotation assigned for the first week.
