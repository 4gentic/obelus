# Changelog — @obelus/claude-plugin

All notable changes to the Obelus Claude Code plugin are documented here. This file is generated from Conventional Commits touching `packages/claude-plugin/**` by [release-please](https://github.com/googleapis/release-please) and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9](https://github.com/4gentic/obelus/compare/plugin-v0.1.8...plugin-v0.1.9) (2026-04-26)


### Performance

* **review:** cut rigorous-mode latency from ~25 min to ~7 min ([#82](https://github.com/4gentic/obelus/issues/82)) ([89a1935](https://github.com/4gentic/obelus/commit/89a193594e1e857770d7d75ff5691be2d82c04ed))

## [0.1.8](https://github.com/4gentic/obelus/compare/plugin-v0.1.7...plugin-v0.1.8) (2026-04-26)


### Features

* canonical bundle, writer-fast mode, holistic plans, and pre-flight prelude ([#76](https://github.com/4gentic/obelus/issues/76)) ([290d533](https://github.com/4gentic/obelus/commit/290d53349282757ac2a1e574a72f7ffede92f0d8))


### Documentation

* **marketing:** refresh README and landing for HTML/MD beta and use cases ([#70](https://github.com/4gentic/obelus/issues/70)) ([b1e2a53](https://github.com/4gentic/obelus/commit/b1e2a53261005ca4e20a9f8af4aa68374da24d4d))

## [0.1.7](https://github.com/4gentic/obelus/compare/plugin-v0.1.6...plugin-v0.1.7) (2026-04-25)


### Features

* **compile-fix:** ask Claude to fix a broken compile ([#63](https://github.com/4gentic/obelus/issues/63)) ([264f228](https://github.com/4gentic/obelus/commit/264f2288db1b23322e8ecb21080c867a8b88348e))
* **desktop,plugin:** per-project workspace under app-data ([#71](https://github.com/4gentic/obelus/issues/71)) ([0f9cd5f](https://github.com/4gentic/obelus/commit/0f9cd5fa3e3e22ce31e2199d39fb345797552b28))
* **plugin:** write-review renders inline by default, file via --out ([#64](https://github.com/4gentic/obelus/issues/64)) ([acde821](https://github.com/4gentic/obelus/commit/acde821653ed21cde3f656af9ffbb776503ae308))
* review HTML & Markdown papers, with per-paper trust and draft-nav cleanup ([#69](https://github.com/4gentic/obelus/issues/69)) ([73f619a](https://github.com/4gentic/obelus/commit/73f619a42053aad666be5d547ad6b353a7e2a9b5))
* review Markdown papers end-to-end (Phase 1) ([#68](https://github.com/4gentic/obelus/issues/68)) ([44d0c20](https://github.com/4gentic/obelus/commit/44d0c2001257e1cc277d51c3c6003b03bee53f18))

## [0.1.6](https://github.com/4gentic/obelus/compare/plugin-v0.1.5...plugin-v0.1.6) (2026-04-23)


### Refactor

* **workspace:** resolve internal package imports from src, not dist ([#57](https://github.com/4gentic/obelus/issues/57)) ([a4116c6](https://github.com/4gentic/obelus/commit/a4116c65fdaa53e1bedab56cf8dd8db2b396cea1))

## [0.1.5](https://github.com/4gentic/obelus/compare/plugin-v0.1.4...plugin-v0.1.5) (2026-04-23)


### Features

* **categories:** add enhancement, aside, flag + hover descriptions ([#50](https://github.com/4gentic/obelus/issues/50)) ([2943d0c](https://github.com/4gentic/obelus/commit/2943d0c7641f689593cc298ecb10bdcfadc545fb))

## [0.1.4](https://github.com/4gentic/obelus/compare/plugin-v0.1.3...plugin-v0.1.4) (2026-04-23)


### Features

* auto-compile Typst drafts + richer plan/apply pipeline ([#45](https://github.com/4gentic/obelus/issues/45)) ([1298a68](https://github.com/4gentic/obelus/commit/1298a6804a4648ae251e7359f8216d05707a0b4d))

## [0.1.3](https://github.com/4gentic/obelus/compare/plugin-v0.1.2...plugin-v0.1.3) (2026-04-23)


### Performance

* faster reviews, workspace file ops, reliability fixes ([#41](https://github.com/4gentic/obelus/issues/41)) ([c55845c](https://github.com/4gentic/obelus/commit/c55845c0a251474f678ba6cddb9d24faa6bc1109))

## [0.1.2](https://github.com/4gentic/obelus/compare/plugin-v0.1.1...plugin-v0.1.2) (2026-04-21)


### Features

* **desktop:** live Claude progress, model/effort, desk rail, polish ([#27](https://github.com/4gentic/obelus/issues/27)) ([532c929](https://github.com/4gentic/obelus/commit/532c929f225caed9b988435e82078f2809ed29a5))

## [0.1.1](https://github.com/4gentic/obelus/compare/plugin-v0.1.0...plugin-v0.1.1) (2026-04-21)


### Features

* **plugin,web:** rename skills for clarity, narrate detect-format, add next-step hint ([c3d045a](https://github.com/4gentic/obelus/commit/c3d045a0da72ff57cbfc825d2d4a1c7f7e8398cc))


### Bug Fixes

* **bundle-schema:** emit real JSON Schemas to committed schemas/ dir ([5351c8c](https://github.com/4gentic/obelus/commit/5351c8c6652b1dd2820085652c169c3f8155ea38))
* **plugin:** ship JSON Schemas inside the plugin cache directory ([9e9cd2a](https://github.com/4gentic/obelus/commit/9e9cd2a42bc0081c2064b089cf38ddee367f6c23))


### Refactor

* **plugin,web:** apply-marks → apply-revision; Edit tab → Revise ([de8a7eb](https://github.com/4gentic/obelus/commit/de8a7eb5113700124bb63b54e8ac92e92d5d92ed))


### Documentation

* **plugin:** align write-review skill with the peer-review letter shape ([254a646](https://github.com/4gentic/obelus/commit/254a646b2ea0a7be0d12eb5390ebdad8fffc7934))

## [Unreleased]
