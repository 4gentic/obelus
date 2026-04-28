# Changelog — @obelus/desktop

All notable changes to the Obelus desktop app are documented here. This file is generated from Conventional Commits touching `apps/desktop/**` by [release-please](https://github.com/googleapis/release-please) and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.11](https://github.com/4gentic/obelus/compare/desktop-v0.1.10...desktop-v0.1.11) (2026-04-28)


### Features

* **desktop:** add refresh button to files column ([#123](https://github.com/4gentic/obelus/issues/123)) ([22a12a9](https://github.com/4gentic/obelus/commit/22a12a9da06d6b87d8d53020ef881ef86ae286d2))
* **desktop:** centralize Claude detection and gate AI actions on engine readiness ([#127](https://github.com/4gentic/obelus/issues/127)) ([b12bfed](https://github.com/4gentic/obelus/commit/b12bfedc69543d8609828c237f07759ef3868e67))
* **desktop:** route clipboard I/O through Tauri plugin ([#122](https://github.com/4gentic/obelus/issues/122)) ([443cc91](https://github.com/4gentic/obelus/commit/443cc9177cbc6d477b9dfa89ee3b506d71b98884))


### Refactor

* **desktop:** unify mark and review note inputs into shared NoteEditor ([#126](https://github.com/4gentic/obelus/issues/126)) ([04ba0ea](https://github.com/4gentic/obelus/commit/04ba0eab426877656914e841cb0a1b0dc8f4add9))

## [0.1.10](https://github.com/4gentic/obelus/compare/desktop-v0.1.9...desktop-v0.1.10) (2026-04-28)


### Bug Fixes

* **desktop:** pin updater to a rolling desktop-latest tag ([#119](https://github.com/4gentic/obelus/issues/119)) ([2bebd52](https://github.com/4gentic/obelus/commit/2bebd52255641b999096d76d2f9e8695d576f984))

## [0.1.9](https://github.com/4gentic/obelus/compare/desktop-v0.1.8...desktop-v0.1.9) (2026-04-28)


### Features

* redesign annotation categories and polish review-shell UI ([#117](https://github.com/4gentic/obelus/issues/117)) ([62b3c87](https://github.com/4gentic/obelus/commit/62b3c875632207451eed2f442959fd0598b8ac75))


### Bug Fixes

* **pdf-view:** remove render-time highlight padding ([#114](https://github.com/4gentic/obelus/issues/114)) ([60a7d13](https://github.com/4gentic/obelus/commit/60a7d1383a54b76364f2e45fd7cf52143b083cff))
* **settings:** auto-check Claude Code version on open ([#116](https://github.com/4gentic/obelus/issues/116)) ([802ffa3](https://github.com/4gentic/obelus/commit/802ffa37925c2d49692fc626755459ff866e75f0))

## [0.1.8](https://github.com/4gentic/obelus/compare/desktop-v0.1.7...desktop-v0.1.8) (2026-04-27)


### Features

* **desktop:** give .tex files a Compile pane and unblock the main star ([#111](https://github.com/4gentic/obelus/issues/111)) ([2380a9e](https://github.com/4gentic/obelus/commit/2380a9e3688264e194a2b585ff6e1594d5a193af))
* **desktop:** make the divergence banner dismissible ([#108](https://github.com/4gentic/obelus/issues/108)) ([4057b59](https://github.com/4gentic/obelus/commit/4057b59f1df9425769c3b86fed22dde29a3724ec))
* **pdf-polish:** PDF rendering, zoom, pan, highlights, and collapsible panels ([#110](https://github.com/4gentic/obelus/issues/110)) ([c61e3b0](https://github.com/4gentic/obelus/commit/c61e3b0d6461c20829395bc7fecbb30579ec6581))
* **ui:** mark LaTeX as Beta across landing, wizard, README, engines panel ([#109](https://github.com/4gentic/obelus/issues/109)) ([90779f4](https://github.com/4gentic/obelus/commit/90779f4b2beff0c1fd2e3af11cfa39c5c5bb7009))


### Bug Fixes

* **desktop:** publish updater manifest with each release ([#87](https://github.com/4gentic/obelus/issues/87)) ([9c1a607](https://github.com/4gentic/obelus/commit/9c1a607a3101f94d689e91e7d074ab5c1131e963))


### Refactor

* **plugin:** rigorous-mode measurement, prompts, and Normal/Deep toggle ([#88](https://github.com/4gentic/obelus/issues/88)) ([5abc594](https://github.com/4gentic/obelus/commit/5abc594857290edc4499efc968c10a210d3e5cd5))

## [0.1.7](https://github.com/4gentic/obelus/compare/desktop-v0.1.6...desktop-v0.1.7) (2026-04-26)


### Features

* **desktop:** stream-idle watchdog + spawn-model diagnostics ([#81](https://github.com/4gentic/obelus/issues/81)) ([75c99f3](https://github.com/4gentic/obelus/commit/75c99f3885f791f58af915350ad1f54dd56923fb))


### Performance

* **review:** cut rigorous-mode latency from ~25 min to ~7 min ([#82](https://github.com/4gentic/obelus/issues/82)) ([89a1935](https://github.com/4gentic/obelus/commit/89a193594e1e857770d7d75ff5691be2d82c04ed))


### Refactor

* **desktop:** drop the post-pick "desk is set" wizard folio ([#78](https://github.com/4gentic/obelus/issues/78)) ([0dcb2dd](https://github.com/4gentic/obelus/commit/0dcb2dd247deb6598e050a97b95967382823e156))

## [0.1.6](https://github.com/4gentic/obelus/compare/desktop-v0.1.5...desktop-v0.1.6) (2026-04-26)


### Features

* canonical bundle, writer-fast mode, holistic plans, and pre-flight prelude ([#76](https://github.com/4gentic/obelus/issues/76)) ([290d533](https://github.com/4gentic/obelus/commit/290d53349282757ac2a1e574a72f7ffede92f0d8))


### Documentation

* **marketing:** refresh README and landing for HTML/MD beta and use cases ([#70](https://github.com/4gentic/obelus/issues/70)) ([b1e2a53](https://github.com/4gentic/obelus/commit/b1e2a53261005ca4e20a9f8af4aa68374da24d4d))

## [0.1.5](https://github.com/4gentic/obelus/compare/desktop-v0.1.4...desktop-v0.1.5) (2026-04-25)


### Features

* **compile-fix:** ask Claude to fix a broken compile ([#63](https://github.com/4gentic/obelus/issues/63)) ([264f228](https://github.com/4gentic/obelus/commit/264f2288db1b23322e8ecb21080c867a8b88348e))
* **desktop,plugin:** per-project workspace under app-data ([#71](https://github.com/4gentic/obelus/issues/71)) ([0f9cd5f](https://github.com/4gentic/obelus/commit/0f9cd5fa3e3e22ce31e2199d39fb345797552b28))
* **desktop:** auto-ignore .obelus/ when project root is a git repo ([#60](https://github.com/4gentic/obelus/issues/60)) ([dbe4fc1](https://github.com/4gentic/obelus/commit/dbe4fc196b2446a49950fcc5166e43335b743002))
* **desktop:** draggable vertical dividers for review panes ([#62](https://github.com/4gentic/obelus/issues/62)) ([79ed5e9](https://github.com/4gentic/obelus/commit/79ed5e95764f385722c666ddecca6dd743ab350d))
* **plugin:** write-review renders inline by default, file via --out ([#64](https://github.com/4gentic/obelus/issues/64)) ([acde821](https://github.com/4gentic/obelus/commit/acde821653ed21cde3f656af9ffbb776503ae308))
* review HTML & Markdown papers, with per-paper trust and draft-nav cleanup ([#69](https://github.com/4gentic/obelus/issues/69)) ([73f619a](https://github.com/4gentic/obelus/commit/73f619a42053aad666be5d547ad6b353a7e2a9b5))
* review Markdown papers end-to-end (Phase 1) ([#68](https://github.com/4gentic/obelus/issues/68)) ([44d0c20](https://github.com/4gentic/obelus/commit/44d0c2001257e1cc277d51c3c6003b03bee53f18))


### Bug Fixes

* **desktop:** find bar state leaks on close, switch; CMD+F refocuses ([#59](https://github.com/4gentic/obelus/issues/59)) ([3508d38](https://github.com/4gentic/obelus/commit/3508d3877c97b89558591adecb6391890d7423c9))
* **desktop:** keep source editor mounted; reveal open file in tree ([#66](https://github.com/4gentic/obelus/issues/66)) ([231e93f](https://github.com/4gentic/obelus/commit/231e93f23cd1571ac29e75b1b5c4bb66fc1d3bdf))

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
