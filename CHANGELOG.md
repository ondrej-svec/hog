# Changelog

## [1.9.3](https://github.com/ondrej-svec/hog/compare/hog-v1.9.2...hog-v1.9.3) (2026-02-22)


### Bug Fixes

* **board:** sticky group header — always shows current status group ([#25](https://github.com/ondrej-svec/hog/issues/25)) ([4127257](https://github.com/ondrej-svec/hog/commit/41272571959915a8bc77928af2c8545c7a56b2c2))

## [1.9.2](https://github.com/ondrej-svec/hog/compare/hog-v1.9.1...hog-v1.9.2) (2026-02-21)


### Bug Fixes

* **board:** keep status group header visible when navigating up ([138decd](https://github.com/ondrej-svec/hog/commit/138decd1dab469c514097e710c933e78104b67cc))

## [1.9.1](https://github.com/ondrej-svec/hog/compare/hog-v1.9.0...hog-v1.9.1) (2026-02-21)


### Bug Fixes

* **board:** fix status group header visibility and layout shenanigans ([fc27a9b](https://github.com/ondrej-svec/hog/commit/fc27a9bdcf98d284c8bc1ce945b61586596c4679))

## [1.9.0](https://github.com/ondrej-svec/hog/compare/hog-v1.8.1...hog-v1.9.0) (2026-02-21)


### Features

* **board:** replace section collapse with lazygit-style tab bar ([6680114](https://github.com/ondrej-svec/hog/commit/6680114a181ec607bbb1b27972a3f52c6c4f2441))

## [1.8.1](https://github.com/ondrej-svec/hog/compare/hog-v1.8.0...hog-v1.8.1) (2026-02-21)


### Bug Fixes

* **board:** unify nav/row builders via BoardTree to fix collapse bugs ([47d63af](https://github.com/ondrej-svec/hog/commit/47d63afdf6b1ea457015ed247b52b5dcc9e33072))

## [1.8.0](https://github.com/ondrej-svec/hog/compare/hog-v1.7.2...hog-v1.8.0) (2026-02-21)


### Features

* **cli:** add bulk-assign/unassign/move commands and fix --dry-run --json ([bbf49a3](https://github.com/ondrej-svec/hog/commit/bbf49a3b641686e02ac8088f81c6ba7bbc203ab0))


### Bug Fixes

* **auth:** use random OAuth state; fix(ai): validate LLM labels against repo labels ([a1b0b68](https://github.com/ondrej-svec/hog/commit/a1b0b6840c0d418bf2f1a891d7a1a20881c726e2))
* **board:** add projectStatus, targetDate and activity to board --json output ([5164652](https://github.com/ondrej-svec/hog/commit/51646524495bd85f96d3cebe411f5b503288036d))
* **board:** show context-sensitive hints when cursor is on a header ([37d5c25](https://github.com/ondrej-svec/hog/commit/37d5c25ce3a071dc5eb1c606b9ec36dbde1db3ed))
* **security:** add 0o600 file permissions and URL scheme validation ([e335e75](https://github.com/ondrej-svec/hog/commit/e335e75fc74d00f127a97b7d0a219e2feb10acee))


### Performance Improvements

* **sync:** use batched fetchProjectEnrichment instead of per-issue fetchProjectFields ([2d8ed4b](https://github.com/ondrej-svec/hog/commit/2d8ed4b1d10aff90dc79358c140f1fce2f7c6a04))

## [1.7.2](https://github.com/ondrej-svec/hog/compare/hog-v1.7.1...hog-v1.7.2) (2026-02-21)


### Bug Fixes

* **board:** fix stale allItems causing cursor desync after collapse ([5a1ef8d](https://github.com/ondrej-svec/hog/commit/5a1ef8d0e0624a067d3920485135601625ff768d))

## [1.7.1](https://github.com/ondrej-svec/hog/compare/hog-v1.7.0...hog-v1.7.1) (2026-02-20)


### Bug Fixes

* **board:** prevent status reversion and blinking on auto-refresh ([d15fba0](https://github.com/ondrej-svec/hog/commit/d15fba0d80a604da00d69daa3fb0d4fd938eb635))

## [1.7.0](https://github.com/ondrej-svec/hog/compare/hog-v1.6.2...hog-v1.7.0) (2026-02-19)


### Features

* **board:** phase 1 — my issues toggle, hint bar, comments in detail panel ([7514fa2](https://github.com/ondrej-svec/hog/commit/7514fa251b747055472a05c1e20d00cf56eafa07))
* **board:** phase 2 — fuzzy issue picker (F key) ([fbc726c](https://github.com/ondrej-svec/hog/commit/fbc726cf1ace89f014e9c75dc3f12a1d99800f54))
* **board:** phase 3.1 — action log + undo (u key, L toggle) ([e3b1a9c](https://github.com/ondrej-svec/hog/commit/e3b1a9ca16758cc36f17bf075d93b78766a30032))
* **board:** phase 3.2 — full issue edit via $EDITOR (e key) ([a329199](https://github.com/ondrej-svec/hog/commit/a329199310f9f890827f5e3cef1f714540fdf757))
* **issue:** phase 4 — CLI parity commands (show/move/assign/unassign/comment/edit/label) ([ce2da17](https://github.com/ondrej-svec/hog/commit/ce2da17751ee5e175bb5fd15ddcc4c89f6656c35))


### Bug Fixes

* ensure log directory exists before writing, remove unconfigured codecov badge ([5128de6](https://github.com/ondrej-svec/hog/commit/5128de6359da7ec983a1cd38139d08e59dc7a3ea))
* resolve all 14 code review TODOs (014-027) ([693e111](https://github.com/ondrej-svec/hog/commit/693e1116bded767419423ad3132e51141075c129))

## [1.6.2](https://github.com/ondrej-svec/hog/compare/hog-v1.6.1...hog-v1.6.2) (2026-02-19)


### Bug Fixes

* **board:** fix cursor teleport to index 0 when collapsing sections (cursor now stays on header) ([cf9e16f](https://github.com/ondrej-svec/hog/commit/cf9e16f))


### Code Quality

* extract nav reducer helpers to reduce complexity; fix all biome lint warnings ([cf9e16f](https://github.com/ondrej-svec/hog/commit/cf9e16f))

## [1.6.1](https://github.com/ondrej-svec/hog/compare/hog-v1.6.0...hog-v1.6.1) (2026-02-18)


### Bug Fixes

* **board:** don't refresh after successful status change ([d6cc905](https://github.com/ondrej-svec/hog/commit/d6cc905c35263316c0f77c5909286539aab2f6e0))

## [1.6.0](https://github.com/ondrej-svec/hog/compare/hog-v1.5.0...hog-v1.6.0) (2026-02-18)


### Features

* **board:** due date via GitHub Projects v2 date field with body fallback ([a41dbad](https://github.com/ondrej-svec/hog/commit/a41dbad3f1865ef814aa0aee66ebc82170b80a8b))

## [1.5.0](https://github.com/ondrej-svec/hog/compare/hog-v1.4.0...hog-v1.5.0) (2026-02-18)


### Features

* **board:** add optional body step to NL issue creation with ctrl+e editor support ([acbc4ad](https://github.com/ondrej-svec/hog/commit/acbc4ad9afd6100d932382ad76bd3dd3e82d1424))


### Bug Fixes

* **board:** pass --body '' to gh issue create to satisfy non-interactive mode ([240effe](https://github.com/ondrej-svec/hog/commit/240effe56da11621f8461fa4f8fa75cdafef0f78))

## [1.4.0](https://github.com/ondrej-svec/hog/compare/hog-v1.3.0...hog-v1.4.0) (2026-02-18)


### Features

* **ai:** store OpenRouter key in config and surface it in hog init + hog config ai:set-key ([083c826](https://github.com/ondrej-svec/hog/commit/083c826dd3ca12a12ebe9b4146f3c0155ab4fa3c))

## [1.3.0](https://github.com/ondrej-svec/hog/compare/hog-v1.2.0...hog-v1.3.0) (2026-02-18)


### Features

* **board:** add y keybinding to copy issue link to clipboard ([257985c](https://github.com/ondrej-svec/hog/commit/257985c4dff9546e8e8eb21389f34d9cf712bbab))
* **board:** Board UX improvements + natural language issue creation ([#12](https://github.com/ondrej-svec/hog/issues/12)) ([2d33a19](https://github.com/ondrej-svec/hog/commit/2d33a197555efcae956cd0e848372d369befc9a0))

## [1.2.0](https://github.com/ondrej-svec/hog/compare/hog-v1.1.3...hog-v1.2.0) (2026-02-17)


### Features

* **init:** status option selector and skip TickTick prompt ([e1e64dd](https://github.com/ondrej-svec/hog/commit/e1e64dd07bd8e272c7edb8f2d91c7c167d325e4c))

## [1.1.3](https://github.com/ondrej-svec/hog/compare/hog-v1.1.2...hog-v1.1.3) (2026-02-17)


### Bug Fixes

* parse wrapped JSON from gh project list and field-list ([6c1f794](https://github.com/ondrej-svec/hog/commit/6c1f794d74e7bf83023e56fee41d8136aa73201a))

## [1.1.2](https://github.com/ondrej-svec/hog/compare/hog-v1.1.1...hog-v1.1.2) (2026-02-17)


### Bug Fixes

* include organization repos in hog init wizard ([90e1326](https://github.com/ondrej-svec/hog/commit/90e1326feed62b2fca70638c05a83046e7d4f70d))

## [1.1.1](https://github.com/ondrej-svec/hog/compare/hog-v1.1.0...hog-v1.1.1) (2026-02-17)


### Bug Fixes

* rename npm scope from [@hog-cli](https://github.com/hog-cli) to [@ondrej-svec](https://github.com/ondrej-svec) ([e359252](https://github.com/ondrej-svec/hog/commit/e359252690022bef47ee7e039b7496e7fb353de1))

## [1.1.0](https://github.com/ondrej-svec/hog/compare/hog-v1.0.0...hog-v1.1.0) (2026-02-16)


### Features

* initial release — unified task dashboard for GitHub Projects + TickTick ([8e3c850](https://github.com/ondrej-svec/hog/commit/8e3c850cb4b8f96bad0f4584f189be40ed5f6387))
