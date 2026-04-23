# Changelog — @obelus/desktop

All notable changes to the Obelus desktop app are documented here. This file is generated from Conventional Commits touching `apps/desktop/**` by [release-please](https://github.com/googleapis/release-please) and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4](https://github.com/4gentic/obelus/compare/desktop-v0.1.3...desktop-v0.1.4) (2026-04-23)


### Features

* **categories:** add enhancement, aside, flag + hover descriptions ([#50](https://github.com/4gentic/obelus/issues/50)) ([2943d0c](https://github.com/4gentic/obelus/commit/2943d0c7641f689593cc298ecb10bdcfadc545fb))
* **desktop:** Cmd+P quick-open file picker ([#51](https://github.com/4gentic/obelus/issues/51)) ([5e503c5](https://github.com/4gentic/obelus/commit/5e503c5e854056902a757b95575c5e1b877f33e5))
* **desktop:** compile .tex via latexmk ([#52](https://github.com/4gentic/obelus/issues/52)) ([a6d71f1](https://github.com/4gentic/obelus/commit/a6d71f137c2962cb0042e418e2f2506f9cb465d4))
* **desktop:** managed engine install (Typst + Tectonic) ([#54](https://github.com/4gentic/obelus/issues/54)) ([d461564](https://github.com/4gentic/obelus/commit/d4615641bcf29ca9f811938c804603b02633bd60))
* **desktop:** partial hunk apply + source lock during pending review ([#49](https://github.com/4gentic/obelus/issues/49)) ([53c812c](https://github.com/4gentic/obelus/commit/53c812ca2b094a4b93691928624bd16f03092208))
* **review:** edit a saved mark's category and note in place ([#53](https://github.com/4gentic/obelus/issues/53)) ([6635c57](https://github.com/4gentic/obelus/commit/6635c575437ffe2b3d20c880164c6b58445b8132))

## [0.1.3](https://github.com/4gentic/obelus/compare/desktop-v0.1.2...desktop-v0.1.3) (2026-04-23)


### Features

* auto-compile Typst drafts + richer plan/apply pipeline ([#45](https://github.com/4gentic/obelus/issues/45)) ([1298a68](https://github.com/4gentic/obelus/commit/1298a6804a4648ae251e7359f8216d05707a0b4d))
* **desktop:** create new files inline from the Workspace column ([#37](https://github.com/4gentic/obelus/issues/37)) ([de97c73](https://github.com/4gentic/obelus/commit/de97c73e31a2c99b1fe5af054637189366d9c630))
* **desktop:** find-in-document for the PDF surface (Cmd+F) ([#38](https://github.com/4gentic/obelus/issues/38)) ([8ddba8d](https://github.com/4gentic/obelus/commit/8ddba8d34cf8f8720d9911cf323773f21a2893a2))
* **desktop:** surface copy-command handoff in reviewer panel alongside direct Claude ([#33](https://github.com/4gentic/obelus/issues/33)) ([1c30779](https://github.com/4gentic/obelus/commit/1c30779f290a21650ab718a93bf3b216737a52da))


### Bug Fixes

* **desktop:** factory reset wipes every table via sqlite_master ([#32](https://github.com/4gentic/obelus/issues/32)) ([1c8ba1a](https://github.com/4gentic/obelus/commit/1c8ba1a75463fdc71925a16317f237b21d08b2aa))


### Performance

* faster reviews, workspace file ops, reliability fixes ([#41](https://github.com/4gentic/obelus/issues/41)) ([c55845c](https://github.com/4gentic/obelus/commit/c55845c0a251474f678ba6cddb9d24faa6bc1109))

## [0.1.2](https://github.com/4gentic/obelus/compare/desktop-v0.1.1...desktop-v0.1.2) (2026-04-21)


### Features

* **desktop:** live Claude progress, model/effort, desk rail, polish ([#27](https://github.com/4gentic/obelus/issues/27)) ([532c929](https://github.com/4gentic/obelus/commit/532c929f225caed9b988435e82078f2809ed29a5))


### Performance

* **pdf-view:** lazy-raster off-screen pages; fix selection drift ([#30](https://github.com/4gentic/obelus/issues/30)) ([5c6687d](https://github.com/4gentic/obelus/commit/5c6687d6f92fbac5caa2f6e2a285cdf0a6a3f820))

## [0.1.1](https://github.com/4gentic/obelus/compare/desktop-v0.1.0...desktop-v0.1.1) (2026-04-21)


### Features

* **plugin,web:** rename skills for clarity, narrate detect-format, add next-step hint ([c3d045a](https://github.com/4gentic/obelus/commit/c3d045a0da72ff57cbfc825d2d4a1c7f7e8398cc))


### Bug Fixes

* **web,desktop:** surface missing-category error when saving a mark ([#14](https://github.com/4gentic/obelus/issues/14)) ([6b8e25c](https://github.com/4gentic/obelus/commit/6b8e25c80f6f962e9b42dd3d1eb955774f711411))


### Refactor

* **plugin,web:** apply-marks → apply-revision; Edit tab → Revise ([de8a7eb](https://github.com/4gentic/obelus/commit/de8a7eb5113700124bb63b54e8ac92e92d5d92ed))

## [Unreleased]
