## [3.12.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.12.0...v3.12.1) (2026-07-14)


### Bug Fixes

* **cli:** reject unsafe detected IDE targets and opencode write destinations ([792a40b](https://github.com/abdelrahmannasr/yadflow/commit/792a40b399b92f8db9d560e314110c432b98d93e)), closes [#134](https://github.com/abdelrahmannasr/yadflow/issues/134)
* **cli:** repair and validate persisted IDE targets ([81242ed](https://github.com/abdelrahmannasr/yadflow/commit/81242ed9a075ea067acb2f4497a745ee40e540a6))

# [3.12.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.11.1...v3.12.0) (2026-07-11)


### Features

* render an epic's kind as its noun in next/thread/status ([42e80e1](https://github.com/abdelrahmannasr/yadflow/commit/42e80e19e20e129a2a3941c85db6777a66ab00cc))

## [3.11.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.11.0...v3.11.1) (2026-07-11)


### Bug Fixes

* **gate:** close the authoring step when its review gate advances ([8baaed9](https://github.com/abdelrahmannasr/yadflow/commit/8baaed9416a063013b5e6acf1ae36c5a1b3c920b))
* **setup:** contain repo paths to the workspace so sibling repos connect ([265a7ae](https://github.com/abdelrahmannasr/yadflow/commit/265a7ae543fccf8697ff89726ecb1a6aadde62ce))

# [3.11.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.10.1...v3.11.0) (2026-07-09)


### Features

* notify when a newer yadflow is published ([9b7a5bf](https://github.com/abdelrahmannasr/yadflow/commit/9b7a5bfca4f27ab08ce4e3e48f2ba331c3e8bfd5))

## [3.10.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.10.0...v3.10.1) (2026-07-08)


### Bug Fixes

* re-run pr-template gate on an edited PR body ([17ad94a](https://github.com/abdelrahmannasr/yadflow/commit/17ad94a4881610b4b653700be50a4eddd7036c5d))
* stop yad repo refresh --push stranding the regenerated pack.md ([f0b5f4c](https://github.com/abdelrahmannasr/yadflow/commit/f0b5f4ce9f22afcd6078aae3ea1dd5a64885be35))

# [3.10.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.9.4...v3.10.0) (2026-07-08)


### Bug Fixes

* **sdlc:** satisfy lint gate and cover the yad skip CLI ([838eabc](https://github.com/abdelrahmannasr/yadflow/commit/838eabc0ba597eaeac3e9249c514e3d479de4830))


### Features

* **sdlc:** make the ui-design step optional (skippable N/A) ([2bc5583](https://github.com/abdelrahmannasr/yadflow/commit/2bc5583b58626ee0cf8f8cc993a8566e4b206221))

## [3.9.4](https://github.com/abdelrahmannasr/yadflow/compare/v3.9.3...v3.9.4) (2026-07-07)

## [3.9.3](https://github.com/abdelrahmannasr/yadflow/compare/v3.9.2...v3.9.3) (2026-07-07)


_Maintenance release — CHANGELOG backfill and dependency-audit fixes (`chore`/`docs` commits carry no user-facing changes)._



## [3.9.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.9.1...v3.9.2) (2026-07-06)


### Bug Fixes

* validate explicit `--task` id format in `yad commit` ([#116](https://github.com/abdelrahmannasr/yadflow/issues/116)) ([e3b0527](https://github.com/abdelrahmannasr/yadflow/commit/e3b05276b951dbeab6ce6bcb135e8228f73ede9d))



## [3.9.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.9.0...v3.9.1) (2026-07-06)


### Bug Fixes

* carry ship-backed story status flip in `yad checkpoint` ([#114](https://github.com/abdelrahmannasr/yadflow/issues/114)) ([478230c](https://github.com/abdelrahmannasr/yadflow/commit/478230cdfccafbcc80913dd3b0a69262a45cbea6))


### Continuous Integration

* bump `github/codeql-action/upload-sarif` from 4.36.2 to 4.36.3 ([#111](https://github.com/abdelrahmannasr/yadflow/issues/111)) ([f384d67](https://github.com/abdelrahmannasr/yadflow/commit/f384d6715da3dbe2d5f9f785920df4fe06c666b8))



# [3.9.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.8.1...v3.9.0) (2026-07-05)


### Features

* **cli:** add `yad repo refresh --push` to publish code-map refresh to the hub ([#110](https://github.com/abdelrahmannasr/yadflow/issues/110)) ([0e3697d](https://github.com/abdelrahmannasr/yadflow/commit/0e3697d0be4ec5d11c300be9b02e04468f07ba8c))


### Bug Fixes

* **cli:** retry the publish push when the index is unchanged; note the registry in docs ([55209c0](https://github.com/abdelrahmannasr/yadflow/commit/55209c01e50e3a635e7311acd1ad10e8c61c5534))



## [3.8.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.8.0...v3.8.1) (2026-07-05)


### Bug Fixes

* **hub-bridge:** filter `glab api` output with jq in gate-sync ([#109](https://github.com/abdelrahmannasr/yadflow/issues/109)) ([352c681](https://github.com/abdelrahmannasr/yadflow/commit/352c681f9e5c6d43688410cfc5092c2382ec881e))


### Tests

* **hub-bridge:** discover gitlab templates dynamically in `--jq` guard ([78d526a](https://github.com/abdelrahmannasr/yadflow/commit/78d526adf2133cd94e6a6396ac7ec5ef3ce2551e))



# [3.8.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.7.1...v3.8.0) (2026-07-05)


### Features

* **cli:** commit + push applied updates to the default branch (`yad update --push`) ([#107](https://github.com/abdelrahmannasr/yadflow/issues/107)) ([fa851c8](https://github.com/abdelrahmannasr/yadflow/commit/fa851c8784765d78df2fef153424ff9d46363731))


### Bug Fixes

* **cli:** address CodeRabbit review on `yad update --push` ([1b1b2f5](https://github.com/abdelrahmannasr/yadflow/commit/1b1b2f59ebda541acd8775a5af3f1c8044efcb57))


### Documentation

* document `yad update --push` and the `yad-update-guard` gate ([35df498](https://github.com/abdelrahmannasr/yadflow/commit/35df498f4a4d7da4d58e81052b6fce73ab438846))



## [3.7.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.7.0...v3.7.1) (2026-07-04)


### Bug Fixes

* **ledger:** sanitize shard-name components against path traversal ([#106](https://github.com/abdelrahmannasr/yadflow/issues/106)) ([5d85286](https://github.com/abdelrahmannasr/yadflow/commit/5d85286591cc9e6c78e449551c82d87683accba5))


### Documentation

* name the trust-log shard and the half-applied-tidy skip rule ([2f594e0](https://github.com/abdelrahmannasr/yadflow/commit/2f594e030c35fe1025d0521de7b022e8f93b958a))



# [3.7.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.6.1...v3.7.0) (2026-07-04)


### Features

* **cli:** wire `yad checkpoint` and `yad tidy up` into the CLI ([#105](https://github.com/abdelrahmannasr/yadflow/issues/105)) ([fe4770d](https://github.com/abdelrahmannasr/yadflow/commit/fe4770de87ebec394c3a29c78077a0baf7a924cc))
* **cli:** add `yad tidy up` to fold finished ledger shards ([59727f3](https://github.com/abdelrahmannasr/yadflow/commit/59727f32a7b5e3274c8fd96b8b39134b3acf6705))
* **cli:** add `yad checkpoint` to commit machine-written back-half state ([c09089c](https://github.com/abdelrahmannasr/yadflow/commit/c09089c698884ad39fc8cf66a7e28d8d44321668))
* **cli:** shard-then-fold storage for the back-half ledgers ([6182598](https://github.com/abdelrahmannasr/yadflow/commit/618259847e3dbdee5f00bce4fa2a5d64df0364a3))
* **cli:** add shared hub-commit default-branch guard helpers ([44290f6](https://github.com/abdelrahmannasr/yadflow/commit/44290f6109c806f077609fec352904efe801f830))


### Bug Fixes

* **cli:** read build-log through the shard union reader ([e7adbc3](https://github.com/abdelrahmannasr/yadflow/commit/e7adbc3a7dd942f2ba6dcc53f868a8f4c6f6969d))


### Refactors

* **cli:** extract `pushWithRebase` helper into lib, reuse in gate ([0cb4e26](https://github.com/abdelrahmannasr/yadflow/commit/0cb4e26c96b125accb67783a37c12a24e2b71ba2))


### Tests

* **cli:** cover checkpoint, sharded ledgers, tidy up, and concurrency ([131d46d](https://github.com/abdelrahmannasr/yadflow/commit/131d46d827ce8b61f5af584098b1dfeee0919d15))
* **cli:** point the concurrency test's bare remote HEAD at main for CI ([663ebac](https://github.com/abdelrahmannasr/yadflow/commit/663ebac306cd03f31f5bee01c38a7487171dcabe))


### Documentation

* document `yad checkpoint`, `yad tidy up`, and sharded ledgers ([322f90a](https://github.com/abdelrahmannasr/yadflow/commit/322f90af6dcf55b475bca80a31219f5a1cdade7b))
* **skills:** shard-then-fold writers/readers and checkpoint/tidy wiring ([b99c359](https://github.com/abdelrahmannasr/yadflow/commit/b99c3595013df8c90a8235d565fb693f2ca95fec))



## [3.6.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.6.0...v3.6.1) (2026-07-04)


### Bug Fixes

* **gate:** include the Checklist section in the hub review-PR body ([#104](https://github.com/abdelrahmannasr/yadflow/issues/104)) ([3134f89](https://github.com/abdelrahmannasr/yadflow/commit/3134f89658a172a3a346cf0945f62e6fa63bac74))



# [3.6.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.5.3...v3.6.0) (2026-07-03)


### Features

* **yad-stub:** mint stub genesis epics for brownfield defect intake ([#102](https://github.com/abdelrahmannasr/yadflow/issues/102)) ([7e6c4cd](https://github.com/abdelrahmannasr/yadflow/commit/7e6c4cd74f5a6e7f886115f7b9e5c0a571c2e408))
* wire stub anchors into change/backfill/reconcile flows ([54d20f1](https://github.com/abdelrahmannasr/yadflow/commit/54d20f10340831bca503f4246606b0181c74a2b0))


### Refactors

* **yad-stub:** centralize stub/anchor detection in one classifier ([5cc76b0](https://github.com/abdelrahmannasr/yadflow/commit/5cc76b08650e3d7fa03d2626ac0c36bdf9de730e))


### Chores

* **yad-stub:** register the skill (manifest, installer, config, count) ([1b63523](https://github.com/abdelrahmannasr/yadflow/commit/1b63523996bba43eb44c72d1b8a0cf5953e4e2d8))


### Documentation

* **yad-stub:** correct promote edge in the overview diagram ([fb3552e](https://github.com/abdelrahmannasr/yadflow/commit/fb3552e1f6ade7e3ec721932e6b69d8287517281))
* **yad-stub:** document the brownfield stub-epic flow ([f5b0730](https://github.com/abdelrahmannasr/yadflow/commit/f5b073029330e69b99a2e15fee6f53c1d94726f5))



## [3.5.3](https://github.com/abdelrahmannasr/yadflow/compare/v3.5.2...v3.5.3) (2026-07-03)


### Bug Fixes

* fill the PR spec dir and summary from the task and commit ([#101](https://github.com/abdelrahmannasr/yadflow/issues/101)) ([a402a54](https://github.com/abdelrahmannasr/yadflow/commit/a402a545715eeea8aef2dde5426eb7f2538687a0))



## [3.5.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.5.1...v3.5.2) (2026-07-02)


### Documentation

* **readme:** sharpen positioning, compatibility, and onboarding ([#100](https://github.com/abdelrahmannasr/yadflow/issues/100)) ([62267ec](https://github.com/abdelrahmannasr/yadflow/commit/62267ec9b87389574acce9f18198c98db88fcfce))
* **readme:** add real setup-wizard GIF and wire it in ([488a2e4](https://github.com/abdelrahmannasr/yadflow/commit/488a2e48845a99a0890542919624d06198aeef15))
* **readme:** soften absolute approval claim, note solo exception ([eb8cab5](https://github.com/abdelrahmannasr/yadflow/commit/eb8cab58625185e079e761378ee5af1debd5f710))



## [3.5.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.5.0...v3.5.1) (2026-07-02)


### Bug Fixes

* preserve roster and verified_authors on hub reconfigure ([#99](https://github.com/abdelrahmannasr/yadflow/issues/99)) ([84bd0af](https://github.com/abdelrahmannasr/yadflow/commit/84bd0affed378e9b6ed60fa2471816f7a585c9c7))



# [3.5.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.4.2...v3.5.0) (2026-07-02)


### Features

* **usage:** add derived team-member usage & behavior report ([#98](https://github.com/abdelrahmannasr/yadflow/issues/98)) ([1813026](https://github.com/abdelrahmannasr/yadflow/commit/181302613b6585b696fbf3ee132a236543c7fd63))


### Bug Fixes

* **usage:** address CodeRabbit review on PR #98 ([e5e64fa](https://github.com/abdelrahmannasr/yadflow/commit/e5e64fa1c19de53b553a8679e76e8304c2001073))


### Documentation

* **usage:** document yad usage across CLI, team guide, README, phase-5 ([2fd262c](https://github.com/abdelrahmannasr/yadflow/commit/2fd262cc1f21a1e97549b41f0179af043272f21f))
* **usage:** document yad usage in the reference site and walkthrough ([dd58f89](https://github.com/abdelrahmannasr/yadflow/commit/dd58f89efb7cd73e5eb133af1ec67d92a1d12214))



## [3.4.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.4.1...v3.4.2) (2026-07-02)


### Bug Fixes

* **doctor:** warn YAD-CFG-005 on hub.json missing git_url; stop misleading YAD-ENV-002 ([#96](https://github.com/abdelrahmannasr/yadflow/issues/96)) ([3f588af](https://github.com/abdelrahmannasr/yadflow/commit/3f588af2e01e117e661b08b5f5b8e069e41e887f))
* **setup:** write and backfill hub.json git_url from the origin remote ([c809358](https://github.com/abdelrahmannasr/yadflow/commit/c8093581319dcb9700b3dd0ebe930dbf784348ff))


### Documentation

* add YAD-CFG-005 to the CLI troubleshooting table + reference site ([4bb1bef](https://github.com/abdelrahmannasr/yadflow/commit/4bb1bef2fa27d6212d9ebc5aa7c11016ad8f38c2))



## [3.4.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.4.0...v3.4.1) (2026-07-01)


### Documentation

* document the self issue reporter + correct skill count to 37 ([#95](https://github.com/abdelrahmannasr/yadflow/issues/95)) ([cc60190](https://github.com/abdelrahmannasr/yadflow/commit/cc60190b0e8b8ecc786203cd20caca186cc91890))



# [3.4.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.3.1...v3.4.0) (2026-07-01)


### Features

* **report:** add self issue reporter with auto-scrubbed diagnostics ([#94](https://github.com/abdelrahmannasr/yadflow/issues/94)) ([cd70965](https://github.com/abdelrahmannasr/yadflow/commit/cd7096568995d52501a2e9b57a7ac091a22620f1))



## [3.3.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.3.0...v3.3.1) (2026-07-01)


### Bug Fixes

* restore npm ci in github checks template ([#93](https://github.com/abdelrahmannasr/yadflow/issues/93)) ([c3079c2](https://github.com/abdelrahmannasr/yadflow/commit/c3079c246692188b5256550a74c6fa14d214c7a7))



# [3.3.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.2.0...v3.3.0) (2026-07-01)


### Features

* **next:** surface build-half sub-steps in yad next ([#91](https://github.com/abdelrahmannasr/yadflow/issues/91)) ([603b129](https://github.com/abdelrahmannasr/yadflow/commit/603b1294194e436c35de842bc687ccb4f51c2075))


### Documentation

* **next:** include the tasks step in the build-chain blurbs ([362e6e8](https://github.com/abdelrahmannasr/yadflow/commit/362e6e8f873f33b23703ef9cca5e60723942afe3))



# [3.2.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.1.0...v3.2.0) (2026-07-01)


### Features

* **review:** add yad-pair-review — guided two-way teaching walkthrough ([#90](https://github.com/abdelrahmannasr/yadflow/issues/90)) ([337cf9a](https://github.com/abdelrahmannasr/yadflow/commit/337cf9a0814f79f411db13a59af9afbdb64cf57d))


### Bug Fixes

* **review:** keep walkthrough STDOUT pure JSON (diagnostics to stderr) ([0d46455](https://github.com/abdelrahmannasr/yadflow/commit/0d46455919997ebcaa9b1f9929f5265023d05c5a))



# [3.1.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.0.0...v3.1.0) (2026-06-30)


### Features

* **review:** add the Review Companion (front half) ([#89](https://github.com/abdelrahmannasr/yadflow/issues/89)) ([d45bf23](https://github.com/abdelrahmannasr/yadflow/commit/d45bf239fa27a7b84cba409a7fdc23f64f99753d))
* **review:** extend the companion + bridge to the back half (code PRs) ([1711ca9](https://github.com/abdelrahmannasr/yadflow/commit/1711ca9753f5eb67fad3fa5c828733e45ca9686f))
* **review:** config switch, pr-template tolerance, and docs for the companion ([13aafcd](https://github.com/abdelrahmannasr/yadflow/commit/13aafcd6f359d6a0c7c39c53f01fd75357ba6aeb))
* **cli:** install newly-added skills on `yad update` ([872b92c](https://github.com/abdelrahmannasr/yadflow/commit/872b92ce1ce2ff5e8154add48b6ebdfef0d87cd4))


### Bug Fixes

* **bridge:** harden reviewer routing on GitHub + GitLab ([8d9cf24](https://github.com/abdelrahmannasr/yadflow/commit/8d9cf24c10adf1403959fa44a30fd13f7b362fb9))
* **review:** address PR #89 code review (bridge/companion robustness) ([4864fae](https://github.com/abdelrahmannasr/yadflow/commit/4864fae0cb7131948509dc6786eae9eb18c80497))


### Tests

* **review:** cover reviewNudge bare-vs-engaged approval branch ([f350f6f](https://github.com/abdelrahmannasr/yadflow/commit/f350f6f8ac27755b584d4e4271e51a724d99d795))
* **e2e:** match the reconcile summary's new `0 new` field ([ca7df77](https://github.com/abdelrahmannasr/yadflow/commit/ca7df77aac5847c9d9c9ebb941d0e6bdc4ed1a67))



# [3.0.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.18.1...v3.0.0) (2026-06-29)


### Features

* remove unused yad-review-comments skill ([#88](https://github.com/abdelrahmannasr/yadflow/issues/88)) ([da6ad60](https://github.com/abdelrahmannasr/yadflow/commit/da6ad608bedf86a58ad09c2aefbf5e6367a41ae4))
* **cli:** purge removed skills from existing installs ([8887d6d](https://github.com/abdelrahmannasr/yadflow/commit/8887d6d5598775986729c77f1500ac6773e4591e))


### Continuous Integration

* **release:** trigger a patch release on docs: commits ([#86](https://github.com/abdelrahmannasr/yadflow/issues/86)) ([df50181](https://github.com/abdelrahmannasr/yadflow/commit/df5018156f20baa6ebab5e0612e7ed86b2a5707c))


### Chores

* **deps:** Bump eslint from 10.5.0 to 10.6.0 ([#87](https://github.com/abdelrahmannasr/yadflow/issues/87)) ([204d807](https://github.com/abdelrahmannasr/yadflow/commit/204d8070a4a9327f90b66be2ce3365b88a66b114))



## [2.18.1](https://github.com/abdelrahmannasr/yadflow/compare/v2.18.0...v2.18.1) (2026-06-28)


### Bug Fixes

* publish updated README and tutorial site to npm ([a7cd251](https://github.com/abdelrahmannasr/yadflow/commit/a7cd251203819565bbde76dd47959ff92b12900c))


### Documentation

* sync overview site + generator spec with phase 6 (feature threads) + discovery ([#84](https://github.com/abdelrahmannasr/yadflow/issues/84)) ([661bc1a](https://github.com/abdelrahmannasr/yadflow/commit/661bc1a6d9f14dde781ee748bd088ed32bc4fb02))
* governance-first README + reference split + guided tutorial site ([#85](https://github.com/abdelrahmannasr/yadflow/issues/85)) ([eb59d7e](https://github.com/abdelrahmannasr/yadflow/commit/eb59d7e365a8434ee44dc6a8313ff31b3dd65a5f))



# [2.18.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.17.0...v2.18.0) (2026-06-26)


### Features

* **change:** post-lock change management via feature threads (Phase 6) ([#83](https://github.com/abdelrahmannasr/yadflow/issues/83)) ([f8024d5](https://github.com/abdelrahmannasr/yadflow/commit/f8024d5808070656d1c3039905ada39096fe7d3b))



# [2.17.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.16.1...v2.17.0) (2026-06-26)


### Features

* **discovery:** add yad-discovery project front-zero phase ([#82](https://github.com/abdelrahmannasr/yadflow/issues/82)) ([4bb2a92](https://github.com/abdelrahmannasr/yadflow/commit/4bb2a928ea37cbd7d7b21f7c28a96a20492f527e))



## [2.16.1](https://github.com/abdelrahmannasr/yadflow/compare/v2.16.0...v2.16.1) (2026-06-25)


### Bug Fixes

* **open-pr:** make build helpers stage-aware on the hub (closes #80) ([#81](https://github.com/abdelrahmannasr/yadflow/issues/81)) ([8d74e3d](https://github.com/abdelrahmannasr/yadflow/commit/8d74e3d267d4c056992d3bc6f5a2a7a15a66b431))



# [2.16.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.15.0...v2.16.0) (2026-06-25)


### Features

* make hub pr-title/pr-template gates branch-aware so tooling PRs pass ([#79](https://github.com/abdelrahmannasr/yadflow/issues/79)) ([68050e0](https://github.com/abdelrahmannasr/yadflow/commit/68050e000010b4d98f304a7e5e1f6a39bc0c229c))



# [2.15.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.14.0...v2.15.0) (2026-06-24)


### Features

* merge-driven review gate (Path B) — CI never pushes the review branch ([#78](https://github.com/abdelrahmannasr/yadflow/issues/78)) ([d4d983a](https://github.com/abdelrahmannasr/yadflow/commit/d4d983ab4efddb4e6ec259bb940b393e9237f9cf))


### Documentation

* **diagram:** label the bridge node merge-time to match Path B ([#77](https://github.com/abdelrahmannasr/yadflow/issues/77)) ([2d558f1](https://github.com/abdelrahmannasr/yadflow/commit/2d558f193e7fb6f2c9e98ca3efaf2d35c1482181))


### Chores

* **ci:** Bump actions/checkout from 4 to 7 ([#73](https://github.com/abdelrahmannasr/yadflow/issues/73)) ([1182bca](https://github.com/abdelrahmannasr/yadflow/commit/1182bca35a3d874c897bac10009a4531f04ea13c))
* **ci:** Bump ossf/scorecard-action from 2.4.2 to 2.4.3 ([#74](https://github.com/abdelrahmannasr/yadflow/issues/74)) ([acff68c](https://github.com/abdelrahmannasr/yadflow/commit/acff68c572e7f5db6067e2411ae781dbd4c59796))
* **ci:** Bump actions/upload-pages-artifact from 3 to 5 ([#75](https://github.com/abdelrahmannasr/yadflow/issues/75)) ([9e44647](https://github.com/abdelrahmannasr/yadflow/commit/9e44647b3345d18b08fb01e643f821946a964f88))
* Redesign review gate: CI owns the ledger (branch-during-review, main-at-merge) ([#76](https://github.com/abdelrahmannasr/yadflow/issues/76)) ([80dd65e](https://github.com/abdelrahmannasr/yadflow/commit/80dd65e2f6e064bda966c5d303768cdc809997df))



# [2.14.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.13.0...v2.14.0) (2026-06-21)


### Features

* yad next driver, precondition guards, solo mode, and guided setup interview ([#72](https://github.com/abdelrahmannasr/yadflow/issues/72)) ([7125c9d](https://github.com/abdelrahmannasr/yadflow/commit/7125c9d80043cb282a7be4f08dfaa95ddf94594a))



# [2.13.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.12.0...v2.13.0) (2026-06-16)


### Features

* **docs:** make the report the main documentation, mount the SPA under /app/ ([#71](https://github.com/abdelrahmannasr/yadflow/issues/71)) ([1993e4d](https://github.com/abdelrahmannasr/yadflow/commit/1993e4dc282df281474ca1923acd52dbd1262dcb))



# [2.12.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.11.1...v2.12.0) (2026-06-16)


### Features

* **docs:** pipeline-shaped overview canvas + collapsible panels + content refresh ([#70](https://github.com/abdelrahmannasr/yadflow/issues/70)) ([da47b80](https://github.com/abdelrahmannasr/yadflow/commit/da47b8050ccd7aa1919bf4b364298a90cdd56012))


### Bug Fixes

* **checks:** harden spec-link + gitlab gate templates ([#69](https://github.com/abdelrahmannasr/yadflow/issues/69)) ([42f3949](https://github.com/abdelrahmannasr/yadflow/commit/42f3949841095624db03cb17f85db3138be8b93b))



## [2.11.1](https://github.com/abdelrahmannasr/yadflow/compare/v2.11.0...v2.11.1) (2026-06-16)


### Bug Fixes

* **doctor:** scope platform-CLI auth probe to the hub host ([#68](https://github.com/abdelrahmannasr/yadflow/issues/68)) ([3cb2801](https://github.com/abdelrahmannasr/yadflow/commit/3cb28011c80645e0ff42e544a9b3d933231daeb3))



# [2.11.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.10.0...v2.11.0) (2026-06-15)


### Features

* add yad-sync-repos — switch every connected repo to its default branch + ff pull ([#67](https://github.com/abdelrahmannasr/yadflow/issues/67)) ([0abdcdf](https://github.com/abdelrahmannasr/yadflow/commit/0abdcdf80c8a0a6bfd8c94129fde90f1d35ec365))



# [2.10.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.9.0...v2.10.0) (2026-06-15)


### Features

* **checks:** cap jest/vitest test workers in connected-repo CI gates ([#66](https://github.com/abdelrahmannasr/yadflow/issues/66)) ([7a16d51](https://github.com/abdelrahmannasr/yadflow/commit/7a16d51eb135c3240d3e94012f844c8b74210bd9))



# [2.9.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.8.0...v2.9.0) (2026-06-15)


### Features

* **docs:** enhance interactive docs — clearer diagram, brand icon, dimmed stubs ([#65](https://github.com/abdelrahmannasr/yadflow/issues/65)) ([969a20d](https://github.com/abdelrahmannasr/yadflow/commit/969a20dc1e9778e1ffd0962e557f3e2c28dfd6ef))


### Chores

* **deps:** Bump eslint from 9.39.4 to 10.5.0 ([#63](https://github.com/abdelrahmannasr/yadflow/issues/63)) ([fc9512e](https://github.com/abdelrahmannasr/yadflow/commit/fc9512e286a51d1d910f873b472de5e014ea7373))



# [2.8.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.7.0...v2.8.0) (2026-06-15)


### Features

* add `yad roster` command to manage the reviewer roster any time ([#64](https://github.com/abdelrahmannasr/yadflow/issues/64)) ([4d78225](https://github.com/abdelrahmannasr/yadflow/commit/4d78225ec25579b50d24d917f217212f4820728f))


### Documentation

* fold the legacy report into the overview site as report.html ([#55](https://github.com/abdelrahmannasr/yadflow/issues/55)) ([c7e4b65](https://github.com/abdelrahmannasr/yadflow/commit/c7e4b652a8abb6c114b901600a5376245d1eb653))


### Chores

* **ci:** Bump github/codeql-action from 3.36.2 to 4.36.2 ([#56](https://github.com/abdelrahmannasr/yadflow/issues/56)) ([78d6616](https://github.com/abdelrahmannasr/yadflow/commit/78d661642c1d1ead28ecb98eed0d84e9f573b846))
* **ci:** Bump actions/deploy-pages from 4 to 5 ([#57](https://github.com/abdelrahmannasr/yadflow/issues/57)) ([59b9d63](https://github.com/abdelrahmannasr/yadflow/commit/59b9d633f0c623be100623ce95bfa232781287c4))
* **ci:** Bump actions/setup-node from 4 to 6 ([#58](https://github.com/abdelrahmannasr/yadflow/issues/58)) ([420d454](https://github.com/abdelrahmannasr/yadflow/commit/420d454ccf08430b45e88938bbb8326224add2b7))
* **ci:** Bump actions/upload-artifact from 4.6.2 to 7.0.1 ([#60](https://github.com/abdelrahmannasr/yadflow/issues/60)) ([de00223](https://github.com/abdelrahmannasr/yadflow/commit/de0022307854e6b5970d710aab5be1a747447e28))
* **ci:** Bump actions/configure-pages from 5 to 6 ([#61](https://github.com/abdelrahmannasr/yadflow/issues/61)) ([335349a](https://github.com/abdelrahmannasr/yadflow/commit/335349a9b0693bb76a08a2b843c67ed0e796c0ae))
* **deps:** Bump semantic-release from 25.0.3 to 25.0.5 ([#59](https://github.com/abdelrahmannasr/yadflow/issues/59)) ([666d9fa](https://github.com/abdelrahmannasr/yadflow/commit/666d9fa3f6cd1f01c992fef700ea7430b4eaf27e))
* **deps:** Bump @eslint/js from 9.39.4 to 10.0.1 ([#62](https://github.com/abdelrahmannasr/yadflow/issues/62)) ([846afa8](https://github.com/abdelrahmannasr/yadflow/commit/846afa80745a8e9801de20f35e282f4fe9055ed4))



# [2.7.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.6.0...v2.7.0) (2026-06-15)


### Features

* add interactive documentation skills + yad docs CLI ([#54](https://github.com/abdelrahmannasr/yadflow/issues/54)) ([4bf7a25](https://github.com/abdelrahmannasr/yadflow/commit/4bf7a25c38e28ef47704a8e2f5acec2f724e4e29))


### Bug Fixes

* publish per-epic docs sites in CI + check shell-version staleness ([9862646](https://github.com/abdelrahmannasr/yadflow/commit/9862646fbe910de8ad8248a5f1bb586a5604b18f))
* drop unused today param from runDocs (lint) ([1c255f1](https://github.com/abdelrahmannasr/yadflow/commit/1c255f1c848b9571502e29b142a07366612d638c))


### Refactors

* rename booking-derived identifiers in the overview site ([2e85892](https://github.com/abdelrahmannasr/yadflow/commit/2e8589213f39dedb8bebb9b8f86917f4389261a2))


### Continuous Integration

* wire the GitHub Pages workflow for the docs sites ([475f329](https://github.com/abdelrahmannasr/yadflow/commit/475f329641ff3ed215389d9e1f6f79338d9ef571))


### Documentation

* generate the yadflow SDLC-overview site ([67cf8de](https://github.com/abdelrahmannasr/yadflow/commit/67cf8de5a88f18660bb8c56721e2403832ad03b5))



# [2.6.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.5.0...v2.6.0) (2026-06-15)


### Features

* add `yad ship` CLI to commit and open a PR/MR in one step ([#53](https://github.com/abdelrahmannasr/yadflow/issues/53)) ([c493e93](https://github.com/abdelrahmannasr/yadflow/commit/c493e93e5626eee590cd061c9e7dbc8047e78718))
* add yad-commit/yad-open-pr/yad-ship skills; rename Step E to yad-engineer-review ([c566567](https://github.com/abdelrahmannasr/yadflow/commit/c5665679e45f24ea53c682aca3a78eb52c9f984f))
* add commit-message/pr-title/pr-template pattern gates (code + hub) ([6658837](https://github.com/abdelrahmannasr/yadflow/commit/6658837d7685b826884b665a5e7661fd6ae99828))


### Bug Fixes

* allow scoped/breaking commit subjects + titles; parse only the trailer block ([63444c0](https://github.com/abdelrahmannasr/yadflow/commit/63444c08c1e33b4151c7389eb5e87f6ae682aee6))
* harden pattern-gate CI — pass PR title via env, write body to mktemp ([2415397](https://github.com/abdelrahmannasr/yadflow/commit/2415397f81280f459785b8fa9ca29007b473561b))
* let `yad ship` derive the PR title from the committed subject ([a5adba3](https://github.com/abdelrahmannasr/yadflow/commit/a5adba3212b236ffc5a2470b9ea50bf97c6c4138))


### Tests

* cover `yad ship` orchestration and the three pattern gates ([23190a3](https://github.com/abdelrahmannasr/yadflow/commit/23190a3c5fb4d48bc5f8f7c5ccb049e42ec9ca80))


### Builds

* register the new skills and wire the pattern-gate scripts ([7c5039e](https://github.com/abdelrahmannasr/yadflow/commit/7c5039ebbb5166cfc6d251ee7fc7f57674ce186d))


### Documentation

* document the commit/PR skills + pattern gates; bump skill count to 25 ([6a8aa71](https://github.com/abdelrahmannasr/yadflow/commit/6a8aa7120cf3c91156bb8367ae19c8cc37b82408))
* address CodeRabbit review on PR #53 ([71eaf6a](https://github.com/abdelrahmannasr/yadflow/commit/71eaf6a07f6c5da8f73285ec6cf8ba280a6a29d6))



# [2.5.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.4.2...v2.5.0) (2026-06-14)


### Features

* per-scope roster roles + auto assignee/reviewer on PRs ([#52](https://github.com/abdelrahmannasr/yadflow/issues/52)) ([5ff066b](https://github.com/abdelrahmannasr/yadflow/commit/5ff066b2a83f63ddf25353ddaf0a088b91a6adb0))



## [2.4.2](https://github.com/abdelrahmannasr/yadflow/compare/v2.4.1...v2.4.2) (2026-06-14)


### Bug Fixes

* route GitLab CI gate jobs to tag-locked runners via $YAD_RUNNER_TAGS ([#51](https://github.com/abdelrahmannasr/yadflow/issues/51)) ([a0311c5](https://github.com/abdelrahmannasr/yadflow/commit/a0311c5af647f63968f3f34e8e6e6fa48b7423d8))



## [2.4.1](https://github.com/abdelrahmannasr/yadflow/compare/v2.4.0...v2.4.1) (2026-06-14)


### Bug Fixes

* migrate pre-2.0 sdlc-* skills during `yad setup` ([#49](https://github.com/abdelrahmannasr/yadflow/issues/49)) ([5b53e40](https://github.com/abdelrahmannasr/yadflow/commit/5b53e40480b3049d4efc596792f2630597d837fd))



# [2.4.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.3.0...v2.4.0) (2026-06-14)


### Features

* add DeepTutor learning layer across all SDLC stages ([#48](https://github.com/abdelrahmannasr/yadflow/issues/48)) ([bd8d4ea](https://github.com/abdelrahmannasr/yadflow/commit/bd8d4eaaa0258242a62ed1b131f7e3f74506af64))
* make learning-layer output local-only (never committed or pushed) ([aa8f74e](https://github.com/abdelrahmannasr/yadflow/commit/aa8f74eb61855d3a663810a0c68cf8e37fbedd66))


### Bug Fixes

* address CodeRabbit review on PR #48 ([2f182f7](https://github.com/abdelrahmannasr/yadflow/commit/2f182f72b68e226196b6190802771b0e12b585f9))


### Continuous Integration

* wire the hub's gate-sync + verified-commits CI and stamp the CLI version ([#46](https://github.com/abdelrahmannasr/yadflow/issues/46)) ([c856398](https://github.com/abdelrahmannasr/yadflow/commit/c856398a213b17aebea9c46204dbf955b92ea9cf))


### Documentation

* changelog entries for #45 and #46 ([8e589aa](https://github.com/abdelrahmannasr/yadflow/commit/8e589aaaa56eaa9bdc6e1863994400a76cc5f6d8))
* document the learning layer and bump skill counts to 22 ([668cdb9](https://github.com/abdelrahmannasr/yadflow/commit/668cdb98feb31c4343c2c865d07c4d9665d0126c))



# [2.3.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.2.0...v2.3.0) (2026-06-14)


### Features

* add parallel test-cases step with pluggable testing-tool connection ([#45](https://github.com/abdelrahmannasr/yadflow/issues/45)) ([19c282f](https://github.com/abdelrahmannasr/yadflow/commit/19c282f6bd737364bca122179b05de8ea94493a9))



# [2.2.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.1.0...v2.2.0) (2026-06-14)


### Features

* add parallel test-cases step with pluggable testing-tool connection ([#45](https://github.com/abdelrahmannasr/yadflow/issues/45)) ([19c282f](https://github.com/abdelrahmannasr/yadflow/commit/19c282f6bd737364bca122179b05de8ea94493a9))


### Continuous Integration

* wire the hub's gate-sync + verified-commits CI and stamp the CLI version ([#46](https://github.com/abdelrahmannasr/yadflow/issues/46)) ([c856398](https://github.com/abdelrahmannasr/yadflow/commit/c856398a213b17aebea9c46204dbf955b92ea9cf))

# [2.1.0](https://github.com/abdelrahmannasr/yadflow/compare/v2.0.1...v2.1.0) (2026-06-13)


### Features

* yad doctor + structured YAD-* error codes with recovery hints ([#43](https://github.com/abdelrahmannasr/yadflow/issues/43)) ([94f9e9f](https://github.com/abdelrahmannasr/yadflow/commit/94f9e9f6ff6d6d3c83ed29f1cfcc97e32678615c))


### Bug Fixes

* address CodeRabbit review on the hardening PR ([7dbe9e3](https://github.com/abdelrahmannasr/yadflow/commit/7dbe9e358e731d69ecead6ecac9faa8377c37023))
* drop useless backtick escapes in a single-quoted doctor hint (lint) ([c0cf1a2](https://github.com/abdelrahmannasr/yadflow/commit/c0cf1a26c15fccc91df15013d6bac83892f2af25))


### Tests

* execute the spec-link, contract-check, build-test-lint, and risk-route gates directly ([7b217d0](https://github.com/abdelrahmannasr/yadflow/commit/7b217d0f01938f66fa4ea6a0fc6d7f0a04a3f9ff))
* e2e harness driving the installed tarball through a full gate cycle ([9a9dbde](https://github.com/abdelrahmannasr/yadflow/commit/9a9dbde8607d6890995217d76438a123bf4b2c22))


### Continuous Integration

* security signal bundle — SECURITY.md, audit gates, Scorecard, pinned actions ([2be8ba2](https://github.com/abdelrahmannasr/yadflow/commit/2be8ba207c8b50ae0c7cd559299867316801118c))
* coverage gate at 70% lines / 70% branches on the Node 22 leg ([742aa96](https://github.com/abdelrahmannasr/yadflow/commit/742aa96ecf80e409c0f465604803b65087b09bd7))
* add a macOS test leg; document platform support (Linux/macOS; Windows via WSL) ([952c624](https://github.com/abdelrahmannasr/yadflow/commit/952c624e3dc9529fd6a637454d4c568da5cd8170))
* add ESLint as a bug net (no formatter); remove the dead code it found ([3db66eb](https://github.com/abdelrahmannasr/yadflow/commit/3db66eb0e1812951bc44cc0e41b8d7d7122b95ea))


### Documentation

* GitHub community files — PR template (dogfooded), issue forms, code of conduct ([02e17b0](https://github.com/abdelrahmannasr/yadflow/commit/02e17b06c5c0d0d2fcb0eb40672400abc2eb4fd7))



## [2.0.1](https://github.com/abdelrahmannasr/yadflow/compare/v2.0.0...v2.0.1) (2026-06-13)


### Bug Fixes

* publish README with pre-rendered SVG diagrams so they display on npm ([05382f6](https://github.com/abdelrahmannasr/yadflow/commit/05382f6bfe27bb0604165692ca6fe1cdb74b9a35))


### Documentation

* pre-render README mermaid diagrams to SVG so they show on npm ([be3bce9](https://github.com/abdelrahmannasr/yadflow/commit/be3bce9e2c20949153984102149ac22a868ac9f9))



# [2.0.0](https://github.com/abdelrahmannasr/yadflow/compare/v1.4.0...v2.0.0) (2026-06-13)


### Features

* rename sdlc-* skills to yad-* and the CLI to yad; feature the report ([#42](https://github.com/abdelrahmannasr/yadflow/issues/42)) ([ea05f17](https://github.com/abdelrahmannasr/yadflow/commit/ea05f17085f992343fc9d1f25bde24c87815be1a))
* migrate pre-2.0 sdlc-* installs in place via yad update ([f85433f](https://github.com/abdelrahmannasr/yadflow/commit/f85433ff8fb4f54ce0c455abb2d72974f82fd507))


### Bug Fixes

* rewrite the root .gitlab-ci.yml include when migrating gitlab fragments ([75eeb3a](https://github.com/abdelrahmannasr/yadflow/commit/75eeb3acf4f2c77b43af4577fe5d1d3cc4285258))



# [1.4.0](https://github.com/abdelrahmannasr/yadflow/compare/v1.3.2...v1.4.0) (2026-06-12)


### Features

* rename npm package to yadflow ([#41](https://github.com/abdelrahmannasr/yadflow/issues/41)) ([1dd55e4](https://github.com/abdelrahmannasr/yadflow/commit/1dd55e4d403deeec344bb75b937ff24ccdaad64a))


### Chores

* update repo URLs after rename to abdelrahmannasr/yadflow ([297bb38](https://github.com/abdelrahmannasr/yadflow/commit/297bb38d5027a16f8ab635fda171419f65ac64f2))
* bump version to 1.0.2 ([ed03560](https://github.com/abdelrahmannasr/yadflow/commit/ed0356009923e3b9e226b43faee5ef7282ad2136))



## [1.3.2](https://github.com/abdelrahmannasr/yadflow/compare/v1.3.1...v1.3.2) (2026-06-11)


### Bug Fixes

* harden the ledger — atomic writes, fail-fast validation, CRLF-safe hashing, traversal guards ([#39](https://github.com/abdelrahmannasr/yadflow/issues/39)) ([71d1773](https://github.com/abdelrahmannasr/yadflow/commit/71d17735400b056ac666bbc75b55b13551032114))



## [1.3.1](https://github.com/abdelrahmannasr/yadflow/compare/v1.3.0...v1.3.1) (2026-06-10)


### Bug Fixes

* make test git commits immune to ambient GIT_AUTHOR/GIT_COMMITTER env ([#38](https://github.com/abdelrahmannasr/yadflow/issues/38)) ([ad92e52](https://github.com/abdelrahmannasr/yadflow/commit/ad92e525c1539a191cd3caffb12c4dc97e80b861))



# [1.3.0](https://github.com/abdelrahmannasr/yadflow/compare/v1.2.0...v1.3.0) (2026-06-10)


### Features

* **checks:** verified-commits gate — reject unverified commits from unverified users (hub + all repos) ([#37](https://github.com/abdelrahmannasr/yadflow/issues/37)) ([986bf28](https://github.com/abdelrahmannasr/yadflow/commit/986bf28e41b09478f99bff3de0ed40fe062d0cc0))



# [1.2.0](https://github.com/abdelrahmannasr/yadflow/compare/v1.1.1...v1.2.0) (2026-06-10)


### Features

* **gate:** event-driven gate sync — platform approve/request-changes/merge drives the ledger via hub CI ([#35](https://github.com/abdelrahmannasr/yadflow/issues/35)) ([e0adbd5](https://github.com/abdelrahmannasr/yadflow/commit/e0adbd512a016af5688c828702af73b20d953087))



## [1.1.1](https://github.com/abdelrahmannasr/yadflow/compare/v1.1.0...v1.1.1) (2026-06-09)


### Bug Fixes

* abort `sdlc open-pr` when the branch push fails ([#34](https://github.com/abdelrahmannasr/yadflow/issues/34)) ([2d32862](https://github.com/abdelrahmannasr/yadflow/commit/2d328628612dc906dcd28d78afa2183813cc1bc8))


### Documentation

* align the walkthroughs with the PR-driven gate and human repo refresh ([#31](https://github.com/abdelrahmannasr/yadflow/issues/31)) ([4e03ec1](https://github.com/abdelrahmannasr/yadflow/commit/4e03ec13ad291d64c5c5df7515d591b90b0b14de))
* backfill CHANGELOG for the 1.0.2–1.1.0 releases ([#32](https://github.com/abdelrahmannasr/yadflow/issues/32)) ([36c5f9d](https://github.com/abdelrahmannasr/yadflow/commit/36c5f9d027d3c25089a770ce28b170a9bb0c3a12))
* update package description to reflect the full workflow + CLI ([#33](https://github.com/abdelrahmannasr/yadflow/issues/33)) ([f461439](https://github.com/abdelrahmannasr/yadflow/commit/f4614393af195dad6d79bb1f21f6557994c7f5ba))



# [1.1.0](https://github.com/abdelrahmannasr/sdlc-workflow/compare/v1.0.3...v1.1.0) (2026-06-09)


### Features

* PR-driven review gate + build-helper CLI commands ([#30](https://github.com/abdelrahmannasr/sdlc-workflow/issues/30)) ([cc43319](https://github.com/abdelrahmannasr/sdlc-workflow/commit/cc4331903b2052b9835b0a6e3f21e148c809914c))

## [1.0.3](https://github.com/abdelrahmannasr/sdlc-workflow/compare/v1.0.2...v1.0.3) (2026-06-08)


### Bug Fixes

* install the missing analysis skill, and document the CLI + all 17 skills ([#29](https://github.com/abdelrahmannasr/sdlc-workflow/issues/29)) ([b968cbe](https://github.com/abdelrahmannasr/sdlc-workflow/commit/b968cbe0be0259746a332a10c5b79ffaf08a87be))

## [1.0.2](https://github.com/abdelrahmannasr/sdlc-workflow/compare/v1.0.1...v1.0.2) (2026-06-08)


### Bug Fixes

* drop @semantic-release/git so release works under branch protection ([#28](https://github.com/abdelrahmannasr/sdlc-workflow/issues/28)) ([4911773](https://github.com/abdelrahmannasr/sdlc-workflow/commit/491177359e6d2af291375884be3f86b3ac359f97))
* normalize package.json repository url ([#27](https://github.com/abdelrahmannasr/sdlc-workflow/issues/27)) ([1e8d93d](https://github.com/abdelrahmannasr/sdlc-workflow/commit/1e8d93d3c9cd5b89d3fa37f53cbfbe7f04126edb))

## [1.0.1](https://github.com/abdelrahmannasr/sdlc-workflow/compare/v1.0.0...v1.0.1) (2026-06-08)


### Bug Fixes

* read CLI version from package.json, not a hardcoded constant ([#26](https://github.com/abdelrahmannasr/sdlc-workflow/issues/26)) ([79a1e28](https://github.com/abdelrahmannasr/sdlc-workflow/commit/79a1e28d50d54e8b275d5f137ba456c7f4fcf76a))

# 1.0.0 (2026-06-08)


### Features

* add optional analysis front step and per-step authoring branches ([#19](https://github.com/abdelrahmannasr/sdlc-workflow/issues/19)) ([5821506](https://github.com/abdelrahmannasr/sdlc-workflow/commit/5821506db6a51ae4dfa6fc30c89670d037c109b1))
* add PR/MR templates, commit/check conventions, and a PR/MR review bridge ([#18](https://github.com/abdelrahmannasr/sdlc-workflow/issues/18)) ([e2d4747](https://github.com/abdelrahmannasr/sdlc-workflow/commit/e2d4747752bfb6dd58a16862f719596504e8ebcb))
* add sdlc gated-SDLC BMAD module with team review gate ([12367bc](https://github.com/abdelrahmannasr/sdlc-workflow/commit/12367bc0a67d5f8b252f9fd40f4c973dba85bf55))
* add sdlc setup/update/check CLI ([884b506](https://github.com/abdelrahmannasr/sdlc-workflow/commit/884b506e9bef8d47017ccb8e0e89f61eaecb6bf9))
* add sdlc setup/update/check CLI ([#21](https://github.com/abdelrahmannasr/sdlc-workflow/issues/21)) ([7d83224](https://github.com/abdelrahmannasr/sdlc-workflow/commit/7d8322478757047c2c34e244deb149d6c5ada852))
* add sdlc-backfill — Phase 3 Step G (existing-code specs) + README build half ([add5db7](https://github.com/abdelrahmannasr/sdlc-workflow/commit/add5db77d158bfa83b9eb8c8370ab888db429ca1))
* add sdlc-checks — Phase 3 Step C check gates ([f603ee5](https://github.com/abdelrahmannasr/sdlc-workflow/commit/f603ee5f2089ba5b698381303484404aff39322c))
* add sdlc-implement — Phase 3 Step B dev/implement step ([6605540](https://github.com/abdelrahmannasr/sdlc-workflow/commit/6605540fa196de075b12088922f8394c2c67fced)), closes [#1](https://github.com/abdelrahmannasr/sdlc-workflow/issues/1)
* add sdlc-pr-template — Phase 3 Step D PR/MR templates + risk routing ([f3c16cc](https://github.com/abdelrahmannasr/sdlc-workflow/commit/f3c16ccfca1cd9bc48e6fd2e10fa35bd20c65599)), closes [hi#risk](https://github.com/hi/issues/risk)
* add sdlc-run — Phase 4a (make the automation dial real, trust log, earn checks) ([d2c1a09](https://github.com/abdelrahmannasr/sdlc-workflow/commit/d2c1a09974ebbcac0be4cb6693c658c7a5fff775))
* add sdlc-ship — Phase 3 Step E AI review, engineer review, ship ([2f4fa42](https://github.com/abdelrahmannasr/sdlc-workflow/commit/2f4fa4258bbe9e04b554f2384fec3515603e6304))
* add sdlc-spec — Phase 3 Step A Spec Kit handoff ([69d1ef7](https://github.com/abdelrahmannasr/sdlc-workflow/commit/69d1ef7072912577b285b970ebff906252d0cd3c))
* complete gated-SDLC front half (Phase 2) ([76a2678](https://github.com/abdelrahmannasr/sdlc-workflow/commit/76a26781d79f322eb2a02313a4a74d6a3316192f))
* connect code repos to the hub and make the front phases code-aware ([#17](https://github.com/abdelrahmannasr/sdlc-workflow/issues/17)) ([0d4e033](https://github.com/abdelrahmannasr/sdlc-workflow/commit/0d4e03347ae7a48abf45016b7d0c21909ea28408))
* Phase 4b Step D — earn the implement→check hand-off + spec/tasks trust hooks ([e0ef03e](https://github.com/abdelrahmannasr/sdlc-workflow/commit/e0ef03e8772184c7db2d2fb52ce8c053ab5b7823))
* Phase 5 instrumentation — nudge-cost + fleet roll-up in sdlc-status ([68e417a](https://github.com/abdelrahmannasr/sdlc-workflow/commit/68e417a8340f04205ef856e83925ce1357c7bdbe))
