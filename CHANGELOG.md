# [4.0.0-next.3](https://github.com/abdelrahmannasr/yadflow/compare/v4.0.0-next.2...v4.0.0-next.3) (2026-09-26)


### Bug Fixes

* **test:** strip the publisher's git identity from the whole test process ([8660f56](https://github.com/abdelrahmannasr/yadflow/commit/8660f5611f1c9f24a67eeead4302c4acca260ba3))

# [4.0.0-next.2](https://github.com/abdelrahmannasr/yadflow/compare/v4.0.0-next.1...v4.0.0-next.2) (2026-09-26)


### Bug Fixes

* **capture:** continue origin's branch when there is no local one; name a refused push (E43 review 2) ([8e2c07d](https://github.com/abdelrahmannasr/yadflow/commit/8e2c07d32d1b6882c7b543b9b3c65f96ca67e919))
* **capture:** every git call takes the environment runCapture was given (E43) ([c347c94](https://github.com/abdelrahmannasr/yadflow/commit/c347c9460154e6b30472a3a1aae2869354a6fce4))
* **capture:** prune deleted capture branches; read [a-z] and list brackets as GitHub does (E43 review 3) ([2322dcb](https://github.com/abdelrahmannasr/yadflow/commit/2322dcb0321ff02f0ebf22ecfe61b2979236944d))
* **capture:** subfolder Products, staged-then-deleted files, a plain push, and a truer workflow scan (E43 review) ([14f0eeb](https://github.com/abdelrahmannasr/yadflow/commit/14f0eeb6e5fe9ce21bdfe5fb168ace88a41d7ad6))
* **capture:** take design-links.json and test-links.json with the artifacts (E44) ([ad4f2cf](https://github.com/abdelrahmannasr/yadflow/commit/ad4f2cfc1f134c3b17616348081795a09939049a))
* **checks:** a C-quoted path is an artifact change; warn on a rename-blind workflow (E47 review 4) ([e6af8df](https://github.com/abdelrahmannasr/yadflow/commit/e6af8df0f4dafd3ec593da44114b07c45b67f54a))
* **checks:** E114 review 1 — one odd name per test, split lines, full hint ([df9f4dc](https://github.com/abdelrahmannasr/yadflow/commit/df9f4dcaf5736bfbd93a49c017ffae257e2b4ef6))
* **checks:** fold the long s into specs; say a file is a file (E115 review 2) ([373ba16](https://github.com/abdelrahmannasr/yadflow/commit/373ba16c81bc3c0eb5c56bb7adae48441b4f07a8))
* **checks:** let a PR of step owner files alone through on a Product (E47 review 2) ([f7ff5b0](https://github.com/abdelrahmannasr/yadflow/commit/f7ff5b062a51b455a18190a31ccbd5488fe5785f))
* **checks:** list a rename by both paths in contract-check and backfill-check (E114) ([09bb4de](https://github.com/abdelrahmannasr/yadflow/commit/09bb4de3f36e0fec0eb247565fc2364a46b482b8))
* **checks:** list renames and unquoted paths in the hub-checks diff (E47 review 3) ([bc270e0](https://github.com/abdelrahmannasr/yadflow/commit/bc270e0583a7583ffccea94b9ecaa1a11498ec46))
* **checks:** read specs/ without case; name a failed tree read (E115 review 1) ([a9fb725](https://github.com/abdelrahmannasr/yadflow/commit/a9fb72599a5980e9f2e8307cb87eca9ae31f17ca))
* **checks:** read the changed list as bytes; check each workflow line (E47 review 5) ([edc850b](https://github.com/abdelrahmannasr/yadflow/commit/edc850b20495a13d376b6f01dc02db61658d4e27))
* **checks:** refuse a second spelling of contracts/ or a story folder (E115 review 3) ([debc7b6](https://github.com/abdelrahmannasr/yadflow/commit/debc7b68f8bbddf5634322228f633327aba8c50a))
* **checks:** refuse a symlink or submodule under specs/ in contract-check (E115) ([e93387a](https://github.com/abdelrahmannasr/yadflow/commit/e93387aa036cc40b9d6741291a1ef518a0d03e1b))
* **checks:** say what the story-spelling rule does not catch (E115 review 4) ([3d36c93](https://github.com/abdelrahmannasr/yadflow/commit/3d36c934406b148c3601c5a6bfdacd40abccbad3))
* **claims:** find the first capture's base in one git call, with no cap (E46 review 2) ([e4a6fcf](https://github.com/abdelrahmannasr/yadflow/commit/e4a6fcf2a33acba0c4b76b5ba54e99d740dcd1d7))
* **claims:** keep the once-an-hour memory across a push; own edits only; over-report a missing base (E46 review 1) ([7ab038d](https://github.com/abdelrahmannasr/yadflow/commit/7ab038d436fc9d46009fd31139bd7327083ebac3))
* **claims:** pin the first-capture search against the person's git config (E46 review 3) ([80db192](https://github.com/abdelrahmannasr/yadflow/commit/80db1926695f60884a47b6a72b5a79f634ac5519))
* **claims:** read the Yad-Base trailer with a pinned separator (E46 review 4) ([c026fef](https://github.com/abdelrahmannasr/yadflow/commit/c026fef2454f6a5799b6e0f8fe5a04ee6cbbad62))
* **doctor:** read a gate one bash command at a time (E114 review 2) ([06d3f69](https://github.com/abdelrahmannasr/yadflow/commit/06d3f69113e3b19f3b9cee1cf77a637999372775))
* **doctor:** satisfy eslint — split on ** instead of a NUL placeholder; no useless assignment (E43) ([aad5822](https://github.com/abdelrahmannasr/yadflow/commit/aad582240fa0b8f4a279b0221100fba967ced20d))
* **fold:** fold a staged deletion; refuse mid-merge and on a detached HEAD (E44 review 1) ([4391b1b](https://github.com/abdelrahmannasr/yadflow/commit/4391b1b1eb6d22990b672a0d3f64b5fb5e77c5ec))
* **fold:** name a case-only rename only when git shows the new spelling (E44 review 4) ([2a6395c](https://github.com/abdelrahmannasr/yadflow/commit/2a6395c7f9ae7c7d9ee8bf1877e4cb770b2197c0))
* **fold:** never run git add with an empty list; refuse a git rm --cached path (E44 review 2) ([cfbaefc](https://github.com/abdelrahmannasr/yadflow/commit/cfbaefc9d8334a20ddbd585b9c2c25a0d31992f7))
* **fold:** tell a case-only rename from git rm --cached (E44 review 3) ([a374fc3](https://github.com/abdelrahmannasr/yadflow/commit/a374fc314f266354cdf96200b54dfa631423d4c2))
* **fold:** the Product level is seeded under either spelling; truer words (E44 review 6) ([c711326](https://github.com/abdelrahmannasr/yadflow/commit/c71132643b8c3ca1fb1d0b5c3a4739d0b18209dd))
* **fold:** the verified seed rule asks ledger-guard's own question; a change-epic's seed rides along (E44) ([f0ee36d](https://github.com/abdelrahmannasr/yadflow/commit/f0ee36d60bad06ac0920b64d97bf16e9f19a7a06))
* **gate:** a round keeps the fingerprint it opened with; one spelling across approvals and comments (E112 review 2) ([d7dbe57](https://github.com/abdelrahmannasr/yadflow/commit/d7dbe57d507f5c798236715e55b70ef42f273dbe))
* **gate:** approve keeps the review record; one spelling per person; a round is one version (E112 review) ([6f44c18](https://github.com/abdelrahmannasr/yadflow/commit/6f44c1887ae2c846bdcd1c14cf276624a2be91b6))
* **owners:** never fold an owner file; name off-chain files in doctor (E47 review 1) ([f23f606](https://github.com/abdelrahmannasr/yadflow/commit/f23f606f220aef583500c6f2a632ee8927307b6c))


### Features

* **capture:** yad capture snapshots Shape artifacts onto private yad/wip branches (E43) ([58b0181](https://github.com/abdelrahmannasr/yadflow/commit/58b0181f72fd88e97d391e0e52a46e8b5cdf1183))
* **claims:** yad claims — who else is editing which artifact, read from the capture branches (E46) ([6668441](https://github.com/abdelrahmannasr/yadflow/commit/66684416b5d3c1a2a04b069cd35b0d7f13e55ddb))
* **doctor:** warn when a step owner file does nothing (E47) ([b189abd](https://github.com/abdelrahmannasr/yadflow/commit/b189abdbc94aa0a36041d501b9cd09c5577d5a62))
* **fold:** yad fold <epic> <step> — one clean commit per authoring step (E44) ([a4a5285](https://github.com/abdelrahmannasr/yadflow/commit/a4a52857c2536b83d954e6a313863ecb16ecf01d))
* **gate:** yad gate approve, comment and advance for a Product with no platform (E112) ([50f7618](https://github.com/abdelrahmannasr/yadflow/commit/50f7618aae85fb269578055e5e12d33e58643fab))
* **owners:** assign an authoring step to one person (E47) ([f9f9bda](https://github.com/abdelrahmannasr/yadflow/commit/f9f9bdaf31206d8ac4c7d46b4d512f23b1e816d2))

# [4.0.0-next.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.19.0-next.2...v4.0.0-next.1) (2026-09-24)


* feat(checks)!: risk-route and hub-route print the approval count, not roles (E62) ([8754585](https://github.com/abdelrahmannasr/yadflow/commit/875458576c6800356980b302dd3366d0b7a5e02a))
* feat(checks)!: verified-commits checks signatures only; the author allowlist is gone (E62) ([67c0161](https://github.com/abdelrahmannasr/yadflow/commit/67c01612372f74e6c70b5af24636eae034fe34c7))
* feat(cli)!: every command answers --json in one envelope (E1) ([7862dfb](https://github.com/abdelrahmannasr/yadflow/commit/7862dfb7d496171bc5f8fa20e533ffc688c57f0e))
* feat(epic)!: shape 5 — the work-item type, and a chore may stand alone ([5eb24fb](https://github.com/abdelrahmannasr/yadflow/commit/5eb24fb04e5d6c686d92b69e4d1b8dd1ea41d46b))
* feat(gate)!: a team gate needs one approver, and approvals name the platform login (E62) ([3730b9c](https://github.com/abdelrahmannasr/yadflow/commit/3730b9cc4f58acede87f9a020ac1ded0b7cf1fdd))
* feat(gate)!: review and task PRs request no reviewers (E62) ([d9f3d76](https://github.com/abdelrahmannasr/yadflow/commit/d9f3d765cced1b50868197bf8622e891a2af0f3a))
* feat(gate)!: shape 9 — an approval's fingerprint leaves out the frontmatter status line ([226f9ec](https://github.com/abdelrahmannasr/yadflow/commit/226f9ec4b9c19bdd055a1f9094b5c95badd69864))
* feat(migrate)!: shape 8 — `yad migrate` moves the product level into foundation/ (E75) ([88e726f](https://github.com/abdelrahmannasr/yadflow/commit/88e726fe9b24737d02e2b7f32e167a60f09e6961))
* feat(setup)!: remove yad roster and stop collecting people in setup (E62) ([5eb6914](https://github.com/abdelrahmannasr/yadflow/commit/5eb69147c84aa6b83ddda2c3e394b4f183caca6a))
* feat(state)!: finish the hub to Product rename ([92a9750](https://github.com/abdelrahmannasr/yadflow/commit/92a9750e708ab130000872e09fd15ff68c4a3c00))
* feat(state)!: yad undefer re-opens a deferred step behind finished work (E41) ([518b7cc](https://github.com/abdelrahmannasr/yadflow/commit/518b7cc7c339f20cf417712b5e8da0e560312f29))
* feat(usage)!: yad usage lists people from activity, not from the roster (E62) ([0664996](https://github.com/abdelrahmannasr/yadflow/commit/0664996f4dae2f190fcd304cb259759054251a80))
* fix(docs)!: a failed docs build exits 1 and says which site failed ([381a000](https://github.com/abdelrahmannasr/yadflow/commit/381a0000754ff4eb9fec4856692d4627369d6420))


### Bug Fixes

* **agents:** answer Cursor in the protocol it actually reads ([d6d6175](https://github.com/abdelrahmannasr/yadflow/commit/d6d6175e71447e6ae735979631dd74802d3f0f13))
* **agents:** close the fifteen defects the deep review found ([cc42177](https://github.com/abdelrahmannasr/yadflow/commit/cc421772bceee0513a3ca30f382cdbb606de39d6))
* **agents:** close the five defects the E11 review found ([c4ca25f](https://github.com/abdelrahmannasr/yadflow/commit/c4ca25fd66d497157d2ee37707984b02f1c500b0))
* **agents:** close the four the audit had left open ([0e5dcd8](https://github.com/abdelrahmannasr/yadflow/commit/0e5dcd80a752f263a45865b3188edf57421818eb))
* **agents:** close the last three, and stop a comment claiming something false ([292a7b1](https://github.com/abdelrahmannasr/yadflow/commit/292a7b1c2b45457f230c39fc19f3db1535beb50d))
* **agents:** let the doctor see the script Cursor actually invokes ([a070911](https://github.com/abdelrahmannasr/yadflow/commit/a0709113dfca4b94608c0519157f0157060d3999))
* **artifact-status:** a "$" in a frontmatter value no longer corrupts the status flip ([545123a](https://github.com/abdelrahmannasr/yadflow/commit/545123a5889cf48910507872ba45607592650cd9))
* **checks:** a claimed Contract-Change with no lock at all now FAILS ([2008eea](https://github.com/abdelrahmannasr/yadflow/commit/2008eea518b4e20052fb277301140d33a9793182))
* **checks:** hub-route reads whole risk tags; route output stops claiming an author check ([53bda97](https://github.com/abdelrahmannasr/yadflow/commit/53bda9717e75367940abab8ab033f3429c274e22))
* **checks:** removing a contract slice under a lockless epic is allowed ([9d0b66a](https://github.com/abdelrahmannasr/yadflow/commit/9d0b66a412d19c6b222f9e3a24dbcac1a8bde4ad))
* **checks:** risk-route reads an older risk-map check as "not counted", never as "nothing is high" ([a486d7b](https://github.com/abdelrahmannasr/yadflow/commit/a486d7b7b46ae95df03f3a372b72f72cc61c0e6a))
* **checks:** run the risk-map awk in the C locale so every awk reads bytes ([4d0d748](https://github.com/abdelrahmannasr/yadflow/commit/4d0d748e0ce575178cfa2d1a9f42df82a40caf16))
* **cli:** a JSON refusal keeps what was done; every warning is collected (E1 review 1) ([41fce95](https://github.com/abdelrahmannasr/yadflow/commit/41fce957954e75bb64fb0ab4271270935e7dc2fc))
* **cli:** a later failure keeps its hint; every commit row has the same keys (E1 review 3) ([188b2de](https://github.com/abdelrahmannasr/yadflow/commit/188b2dec55ce8b25a9fa8fe8e471864141c1def4))
* **cli:** answer in JSON only when the running command is history (PR review 3) ([cdc8250](https://github.com/abdelrahmannasr/yadflow/commit/cdc8250b340693b5e80d8d49a26044305ec52a4a))
* **cli:** every line that names a skill asks the project, not the catalogue ([c085218](https://github.com/abdelrahmannasr/yadflow/commit/c08521818e951faddb04c4e26fe5639a70cc0f1b))
* **cli:** every sweep failure reaches the JSON; a refusal says what was committed (E1 review 2) ([dd7ef3e](https://github.com/abdelrahmannasr/yadflow/commit/dd7ef3e00713bdeba43b0870e70ac90ee4246bf7))
* **cli:** the history JSON error is exactly the documented refusal shape ([d20c9a3](https://github.com/abdelrahmannasr/yadflow/commit/d20c9a3ab7f83ed73139c62f4eb2622d8a44440d))
* **cli:** the review round — a write that ate a user's bindings, and five more ([3c63059](https://github.com/abdelrahmannasr/yadflow/commit/3c63059686c467c5a8b29367d1e7712472835b9b))
* **cli:** two more prototype holes, and yad-run reads the binding without a lane ([3a0a114](https://github.com/abdelrahmannasr/yadflow/commit/3a0a1146e2b50154a294cd8ae0e30dc0e4a2ee58))
* **codeowners:** a GitLab heading's unreadable default owners are reported (E68 review 3) ([cd9a1f1](https://github.com/abdelrahmannasr/yadflow/commit/cd9a1f1c6628040ccf3c35efad0c49185039e73e))
* **codeowners:** a path typed in another case is still the top folder; a refusal is JSON under --json (E69 review 5) ([397ccaf](https://github.com/abdelrahmannasr/yadflow/commit/397ccaf9efdf8b6807a04721a2bd726b49398863))
* **codeowners:** a pattern crosses a folder name holding a line break; no set copy per rule (E69 review 3) ([7341d79](https://github.com/abdelrahmannasr/yadflow/commit/7341d79080cc0d5558929869afbbfb812f84853e))
* **codeowners:** an exclusion's extra words are not an owner problem; describe the GitLab defaults rule ([4f50303](https://github.com/abdelrahmannasr/yadflow/commit/4f50303ac1fa9d50ad830a1c3ff7813f2a39bfc5))
* **codeowners:** exact dead-line answer for escaped characters; fast for every common shape; refuse --write= (E69 review 2) ([c52b17d](https://github.com/abdelrahmannasr/yadflow/commit/c52b17db4ba7829bd59497cd60a8e00eb52c839f))
* **codeowners:** no address in a not-read reason; fast dead-line check; exact file name; top folder only (E69 review 1) ([036f907](https://github.com/abdelrahmannasr/yadflow/commit/036f9078f09f220a45de5f10a44bb9998a3c8a9d))
* **codeowners:** read the file list only when a CODEOWNERS exists; a list git cannot produce is not known ([a2f0cc8](https://github.com/abdelrahmannasr/yadflow/commit/a2f0cc8a626be7720aaf3b7c99118a93a34ff002))
* **dial:** close the holes the E34 review found ([2038d19](https://github.com/abdelrahmannasr/yadflow/commit/2038d19bf596ae958e3b51fb2b0bc3b2fbbd4860))
* **docs:** a new yad release no longer marks every docs site stale ([bdbbff1](https://github.com/abdelrahmannasr/yadflow/commit/bdbbff1eaaf7d89e7582d43dbbc11df52de84bd4))
* **docs:** only a deploy where every site built ends on a tick (review 2) ([68251be](https://github.com/abdelrahmannasr/yadflow/commit/68251beb3d9208011481e77587ba4ffc46d923cf))
* **docs:** the review round — right site folder, a real test, no green tick after a failed deploy ([9f868d8](https://github.com/abdelrahmannasr/yadflow/commit/9f868d8332679ab437c49b8e07fc3a5d15534faf))
* **doctor:** "on every change" also when a scoped rule could not be read (E70 review 6) ([36e52ff](https://github.com/abdelrahmannasr/yadflow/commit/36e52ffd80b74a43404924f1b8aab9a0133ec8b6))
* **doctor:** a 404 on a list never means "they do not exist" (E70 review 27) ([8bdf98f](https://github.com/abdelrahmannasr/yadflow/commit/8bdf98f64dbb1924768d161d8019813e4aecf7f4))
* **doctor:** a 404 on the rules is a host without rulesets, not a permission (E70 review 28) ([f80f92d](https://github.com/abdelrahmannasr/yadflow/commit/f80f92d4c468195730ef1a9c28089fb07dfbcf28))
* **doctor:** a belief from a 404 may remove an offer, never add certainty (E70 review 30) ([a3f653d](https://github.com/abdelrahmannasr/yadflow/commit/a3f653d15514a7842cadefcd16772235df7dfee9)), closes [#7386](https://github.com/abdelrahmannasr/yadflow/issues/7386) [#29576](https://github.com/abdelrahmannasr/yadflow/issues/29576)
* **doctor:** a branch yad cannot read settles nothing (E70 review 24) ([8d9a46a](https://github.com/abdelrahmannasr/yadflow/commit/8d9a46a1a2826b09634fcfdbce4e820e94882392))
* **doctor:** a colon, not a second dash, in the GitLab sentence (E70 review 11) ([9d8c835](https://github.com/abdelrahmannasr/yadflow/commit/9d8c83525a69945753250f9acbedbe469dcc609a))
* **doctor:** a floor counts rules, not labels (E70 review 23) ([3f7d124](https://github.com/abdelrahmannasr/yadflow/commit/3f7d124d6698973d599da54bf64724f4fb8bf23a))
* **doctor:** a GitLab rule with no name reads as "an approval rule" (E70 review 12) ([5ada04a](https://github.com/abdelrahmannasr/yadflow/commit/5ada04abb6356099a81280a910bc181a09b37dae))
* **doctor:** a hint hedges wherever its own message does (E70 review 31) ([e256f06](https://github.com/abdelrahmannasr/yadflow/commit/e256f06c50db96cfbab79dda4e91a63fcf91c456))
* **doctor:** a pointer only where something was unread, and numbers that agree (E70 review 16) ([2ff23f5](https://github.com/abdelrahmannasr/yadflow/commit/2ff23f53b12d0fa3f5d5d00766a90c4333d6dd80))
* **doctor:** a protection line states only what the platform answered (E70 review 3) ([453f646](https://github.com/abdelrahmannasr/yadflow/commit/453f6463040578c297c46f4cd22ba0521860c27f))
* **doctor:** a read that answered nothing says so, and one source is named once (E70 review 22) ([25eabe8](https://github.com/abdelrahmannasr/yadflow/commit/25eabe8d02778514bafdbf25b3698caac6a4b2f5))
* **doctor:** a rule keyed on a wording must say when it stops firing (E70 review 32b) ([6beeb6f](https://github.com/abdelrahmannasr/yadflow/commit/6beeb6f8c3c1f72f30c869559b763f6e3a6097e0))
* **doctor:** a sentence for a count read beside a protection that was not (E70 review 8) ([8421b00](https://github.com/abdelrahmannasr/yadflow/commit/8421b0060e54308632bbfacaf89149eabb9da98c))
* **doctor:** an id reads as an id, and no sentence pairs two dashes (E70 review 13) ([8a07f2b](https://github.com/abdelrahmannasr/yadflow/commit/8a07f2bd8b99785ed3bcdf192269113c7ac038c4))
* **doctor:** apply round 16's fixes to their twins as well (E70 review 17) ([f99db88](https://github.com/abdelrahmannasr/yadflow/commit/f99db8823e34dce8eb84c3bde8f87c04385d0f7f))
* **doctor:** compare artifacts the way every reader of the field does ([75688d9](https://github.com/abdelrahmannasr/yadflow/commit/75688d9208608c1626cbfdbcb274b0e2f3960979))
* **doctor:** give the missing-default hint E109's two repository actions, from one string (E110) ([2e751a9](https://github.com/abdelrahmannasr/yadflow/commit/2e751a984e18a1faa007caee0488b11454292c33))
* **doctor:** name folders under epics/ that are not valid epic ids ([1e0e4ac](https://github.com/abdelrahmannasr/yadflow/commit/1e0e4ac6357f03def0362ef5201e39e352b3a40b))
* **doctor:** never read a count or "not protected" the platform did not prove (E70 review 1) ([4800bff](https://github.com/abdelrahmannasr/yadflow/commit/4800bffbbeb8bebdf8a20f228992c82d88a98028))
* **doctor:** never rule a cause out and then offer it again (E70 review 29) ([aeef14b](https://github.com/abdelrahmannasr/yadflow/commit/aeef14b152e6941e7681901ce633e87339b1435a))
* **doctor:** point the legacy BMAD hints at what still works (E3) ([60df2dc](https://github.com/abdelrahmannasr/yadflow/commit/60df2dc168751f27bd6a892698f211550abd18b6))
* **doctor:** read the GitLab branch itself; a rule on an unprotected branch is no hold (E70 review 2) ([90d8df9](https://github.com/abdelrahmannasr/yadflow/commit/90d8df9581ba9c7f21b528fc119a4fb00e75a774))
* **doctor:** restore a guard I wrongly called unreachable (E70 review 18) ([dabd9a1](https://github.com/abdelrahmannasr/yadflow/commit/dabd9a1042da5db52e51c48ba5671e833269ed87))
* **doctor:** say GitHub's flag the same way everywhere; fill the level table (E70 review 9) ([dca372b](https://github.com/abdelrahmannasr/yadflow/commit/dca372bd289461235cab097b08e87561f5f3c0c6))
* **doctor:** say only what this read leaves possible (E70 review 15) ([328cf0a](https://github.com/abdelrahmannasr/yadflow/commit/328cf0a6a32de5805b60f6f33ff159ba1c8c5d90))
* **doctor:** say the GitLab repository could not be read, not that your login cannot (E109) ([3a8ffa5](https://github.com/abdelrahmannasr/yadflow/commit/3a8ffa583d6ac7f15270a9c217c77be5700b585c))
* **doctor:** see a step that carries ONLY the new dial name ([8ad471f](https://github.com/abdelrahmannasr/yadflow/commit/8ad471f2d90ef4d90df6016b92b4064ce867631b))
* **doctor:** stop the theme checks reporting correct files ([c6c3a0c](https://github.com/abdelrahmannasr/yadflow/commit/c6c3a0c278ccad2734061e1bd04fbb8b578431f6))
* **doctor:** tell the two reach gaps apart, and check every partly read line (E70 review 25) ([31dcf1d](https://github.com/abdelrahmannasr/yadflow/commit/31dcf1d5fd0a6e7f55dc4ee249b9c9f277b00500))
* **doctor:** test the GitLab repository 404 on the shape GitLab really sends (E109) ([81f4001](https://github.com/abdelrahmannasr/yadflow/commit/81f4001f518ea9cd65f31bb93f265176244408a9))
* **doctor:** the banner needs no rule at all, and lint is green again (E70 review 5) ([7830496](https://github.com/abdelrahmannasr/yadflow/commit/783049648722440999cde7ca079f6d61f0cff536))
* **doctor:** the clause binds to the rule, not to the branch it names (E70 review 26) ([4ea1403](https://github.com/abdelrahmannasr/yadflow/commit/4ea140368d7d71451204f49304b71fba52c4bbf7))
* **doctor:** the joined GitLab phrase reads as a sentence (E70 review 10) ([f81a423](https://github.com/abdelrahmannasr/yadflow/commit/f81a423bf0b5a672e0441ebfa04f2ac3e7fd18d3))
* **doctor:** the last paired dashes, and a limit narrower than the code (E70 review 14) ([d67ae31](https://github.com/abdelrahmannasr/yadflow/commit/d67ae3144e6735db23e73b9a9daa54e29e99a0a4))
* **doctor:** the review round — a finding whose only remedy always failed ([2783186](https://github.com/abdelrahmannasr/yadflow/commit/27831861756450ed0067271a80f08062e3c35b44))
* **doctor:** the solo line carries the same facts; hedge what is not read (E70 review 4) ([7019585](https://github.com/abdelrahmannasr/yadflow/commit/7019585ec60deaa28f4217f52a531c8e2943e8fa))
* **doctor:** the split turns on what the read proved, not where the name came from (E70 review 32) ([3930636](https://github.com/abdelrahmannasr/yadflow/commit/3930636ea87f92275c19fa6751c4a5be1ba074c5))
* **doctor:** the tier framing belongs to a refusal, and the grid reaches every branch (E70 review 21) ([c2377ef](https://github.com/abdelrahmannasr/yadflow/commit/c2377ef37fd0ae9e11f9b6d7b4454c3db23c8e4c))
* **doctor:** two answers that disagree are not known; a rule elsewhere is not "no rules" (E70 review 7) ([b002fd8](https://github.com/abdelrahmannasr/yadflow/commit/b002fd89fe9d95b402cb422e7491093b89510b4d))
* **engine:** drop the profile field nothing read, and fix the test seam ([07af526](https://github.com/abdelrahmannasr/yadflow/commit/07af526629684ee5b5c53438b13e2983ccb82bfc))
* **epic:** close the holes the E42 review found ([574870f](https://github.com/abdelrahmannasr/yadflow/commit/574870f0d6ebfe1d0c5501daa74a7927662fc13e))
* **epic:** protect the reserved front-zero id, and stop a false type clash ([871f763](https://github.com/abdelrahmannasr/yadflow/commit/871f763bbf0df4ca92f4991b1456db00bb2aecec))
* **foundation:** close the holes the roadmap-status review found ([69392d4](https://github.com/abdelrahmannasr/yadflow/commit/69392d441b4212448e0e3092eb74dc313e1f19b2))
* **foundation:** skills that hand-apply the gate know the Foundation, and the preview lists every moved file ([8e20897](https://github.com/abdelrahmannasr/yadflow/commit/8e20897d56c4c047d207fffdd7a644ebb81ae149))
* **foundation:** the review round — one product level in the guard, and a move that cannot strand ([5bca4ba](https://github.com/abdelrahmannasr/yadflow/commit/5bca4baded95a108018a780fd0c6ec06f1b3c62b))
* **gate:** `gate status` counts approvals the way the gate counts them ([eda7429](https://github.com/abdelrahmannasr/yadflow/commit/eda7429d6454f93c3ce034456ab61ab6b5afa3a7))
* **gate:** `gate status` prints the shortfall, and honours a skip only where the gate does ([95c9c2a](https://github.com/abdelrahmannasr/yadflow/commit/95c9c2a49adfcea6f4e8daf13932d386d4c5a75a))
* **gate:** a hand-edited cap below 1 is not printed; the inherited test says what it checks (E72) ([49dcef7](https://github.com/abdelrahmannasr/yadflow/commit/49dcef760aa00a46ec157cba2f78b90f9103b77f))
* **gate:** a malformed record in the merged review's own epic no longer stops the merge ([24eec39](https://github.com/abdelrahmannasr/yadflow/commit/24eec393e6b8ddbdefe71944c0045bbccda2dc16))
* **gate:** a shared roster name is never matched by name; gate open stamps the old PR (E62) ([a2b15eb](https://github.com/abdelrahmannasr/yadflow/commit/a2b15eb0d4519a05abe77ebb2ff64b6039ce9ea9))
* **gate:** a short-lane review PR does not ask for a contract re-lock it cannot do ([4855f3a](https://github.com/abdelrahmannasr/yadflow/commit/4855f3afaf90a885d3e1ae1c4d1d133857d6d142))
* **gate:** an exact submission time beats the roster name table; usage and doctor follow the simulation ([4d2c55c](https://github.com/abdelrahmannasr/yadflow/commit/4d2c55c45c7409942287a1b8834f2c58da756e5d))
* **gate:** an exact submission time continues only that review's records, never the whole name ([beaa5e3](https://github.com/abdelrahmannasr/yadflow/commit/beaa5e35a3aa77e85207b00d271885bddbd69e39))
* **gate:** claim and keep older records per review, so a closed step never deletes the other person's history ([1ed2070](https://github.com/abdelrahmannasr/yadflow/commit/1ed2070779055ccf610c0ad0012978183c7b08d0))
* **gate:** close the gaps the E18 review found ([69aa2cf](https://github.com/abdelrahmannasr/yadflow/commit/69aa2cfcf88db681dfb08cc89a200ef58a23a88a))
* **gate:** close the holes the E76 review found ([e460fb2](https://github.com/abdelrahmannasr/yadflow/commit/e460fb21f8efd9eb34ef1569361973a8297f3321))
* **gate:** eighth review round — "after the cap", one dead branch, two comments (E73) ([62e47c3](https://github.com/abdelrahmannasr/yadflow/commit/62e47c3181908e49bc69407775b51ad49951f083))
* **gate:** fifth review round — an approval anywhere is evidence, and every what-if line is conditional (E73) ([5b78858](https://github.com/abdelrahmannasr/yadflow/commit/5b788587187cdce397d36bb9efdbd772cadaaefc))
* **gate:** fourth review round — the floor wording on every surface, and a cap only ever lowers (E72) ([81dc0d8](https://github.com/abdelrahmannasr/yadflow/commit/81dc0d866118b167ca18d40531abf3ba53a856e8))
* **gate:** fourth review round — two kinds of line, each said once, and the GitLab gate bot is not a person (E73) ([622c6d6](https://github.com/abdelrahmannasr/yadflow/commit/622c6d66d35df22fde619e09cd69c0dc6de97e3d))
* **gate:** keep people under a shared roster name apart; read the PR number from its own segment ([b30ba90](https://github.com/abdelrahmannasr/yadflow/commit/b30ba9051a8a4d291b70bad18f47807ac4fee21b)), closes [#2048](https://github.com/abdelrahmannasr/yadflow/issues/2048)
* **gate:** old approvals stay with their person in every platform order (E62 review) ([8379656](https://github.com/abdelrahmannasr/yadflow/commit/83796566ca4f35452e717b63b9f08c7caf081d4f))
* **gate:** recognise old approvals exactly, and never pass one that is stale (E62 review) ([58fe6d2](https://github.com/abdelrahmannasr/yadflow/commit/58fe6d295dbfaa795f771c79e1be1f6f0a052800))
* **gate:** review round — the names check needs a login, and sees a team of one that reads as two (E73) ([65512d0](https://github.com/abdelrahmannasr/yadflow/commit/65512d0decc079c0a76867b8b05065fe3baef37f))
* **gate:** round-2 review — singular in open-pr's cap, and doc/test wording that still read as enforced (E72) ([64323b0](https://github.com/abdelrahmannasr/yadflow/commit/64323b0695792c7c9e6dc6ccc97fb56f516ff76a))
* **gate:** second review round — the silent-path test compares ledgers; doc conditions stated whole (E73) ([5580624](https://github.com/abdelrahmannasr/yadflow/commit/5580624d87dcf685eba6cdb2403ffce112b28974))
* **gate:** seventh review round — the smallest team is the larger of the logins and the names (E73) ([bcbdb32](https://github.com/abdelrahmannasr/yadflow/commit/bcbdb32d3a1d8646999e183aed3b67a481a3ad7d))
* **gate:** show the capacity cap and hold on the base alone until E73 (E72) ([3da8498](https://github.com/abdelrahmannasr/yadflow/commit/3da849895011ff19d1368499d825a2b9723a5583))
* **gate:** sixth review round — "no approval" names the window, and a name is "not matched to a login" (E73) ([d592818](https://github.com/abdelrahmannasr/yadflow/commit/d592818b24d4e78d9bf3563398a45fef87447d92))
* **gate:** the login stamp merges only proven reviews and never stops a merge ([5c80ce9](https://github.com/abdelrahmannasr/yadflow/commit/5c80ce95a0852fcb2d593c0edf7aac80d54f50fd))
* **gate:** the product-level move waits for its review, a clean checkout, and the default branch ([91193be](https://github.com/abdelrahmannasr/yadflow/commit/91193be19f652db23f6229026db9d81df0f5db4b))
* **gate:** the review-PR body is the one surface where the count LASTS, so the line dates itself ([6b378fc](https://github.com/abdelrahmannasr/yadflow/commit/6b378fc28a23543da2b67bc1bf27f07f29bded46))
* **gate:** third review round — no cap on a shortcut pass, one copy of the cap's words (E72) ([81d86c8](https://github.com/abdelrahmannasr/yadflow/commit/81d86c86cea311a66c6658ac951371cc82b9e405))
* **gate:** third review round — the silent-path test compares the PR records too; one prefix on every site (E73) ([7b3d874](https://github.com/abdelrahmannasr/yadflow/commit/7b3d874c207f103479dc5df84a398cec1ca9fbf4))
* **history:** a printed [@word](https://github.com/word) is always a real login; GitLab defaults only for an ownerless entry (E68 review 4) ([cadd82b](https://github.com/abdelrahmannasr/yadflow/commit/cadd82bf43c8adecde2aa5aab1dc156f7b7bf708))
* **history:** count as the gate counts; keep a thread's root; print every field safely (E20 review 2) ([a539bfc](https://github.com/abdelrahmannasr/yadflow/commit/a539bfc595d22bd5e574e04b02d7f1fbcd2efae6))
* **history:** follow the real thread, print only safe text, judge approvals as gate status does (E20 review) ([2654480](https://github.com/abdelrahmannasr/yadflow/commit/265448010a526656ef818f710ed2e7e63e7f682c))
* **history:** name an approver by the gate's test; refuse every flag it does not take (PR review 2) ([406dce6](https://github.com/abdelrahmannasr/yadflow/commit/406dce685068993e7e187dbd76e107c6897f0468))
* **history:** second-review findings for E68, and E67's address-shaped name ([86e34c0](https://github.com/abdelrahmannasr/yadflow/commit/86e34c025dd37e397f16e22fac35485cf52ccaa6))
* **history:** the whole-PR review — strict settings, JSON refusals, shape done, exact search (E20) ([e9e13ed](https://github.com/abdelrahmannasr/yadflow/commit/e9e13ed4202c723fe3563be4cd254981ecdeb14c))
* **history:** waive a step by the gate's own test, not its final state (E20 review 3) ([dd5665e](https://github.com/abdelrahmannasr/yadflow/commit/dd5665ede9f4fec14a2b20425e5a59e12cf78009))
* **hub-bridge:** the gate-sync fragments ship the major their release publishes ([01ac858](https://github.com/abdelrahmannasr/yadflow/commit/01ac8587d5affc4e0f87c27f935b18f1342683c5))
* **index:** clean a title before unquoting it; drop bidi controls (E111 review 4) ([5ff9755](https://github.com/abdelrahmannasr/yadflow/commit/5ff97552f2af139c9634e2d398f79089ecc271a0))
* **index:** commit the index only when git holds exactly what it read (E19 review) ([1b354bc](https://github.com/abdelrahmannasr/yadflow/commit/1b354bcf4a5881aa9c74cdc028dec2562bc8418e))
* **index:** drop control characters from a title (E111 review 3) ([65ac5f7](https://github.com/abdelrahmannasr/yadflow/commit/65ac5f7c567c041c2cb027676440698ddf9e1078))
* **index:** read a double-quoted title with JSON's escapes; pin every title rule (E111 review 2) ([0a6b820](https://github.com/abdelrahmannasr/yadflow/commit/0a6b82081d63f26953c54a67af14b31ccf164674))
* **index:** read a YAML-quoted title as YAML does, keep it one line (E111 review) ([972920f](https://github.com/abdelrahmannasr/yadflow/commit/972920ffa7e462da8d79ec747060fa57d9d82b83))
* **ledger:** the lock loop could never give up — two `continue`s skipped the cap and the sleep ([e66eab6](https://github.com/abdelrahmannasr/yadflow/commit/e66eab61910eb3b4bd7c3f9ba50f9fa9c39b5fa9))
* **lifecycle:** place an epic in Build, and keep the discovery epic off the ladder ([1c01e0c](https://github.com/abdelrahmannasr/yadflow/commit/1c01e0c8cf7aa2410b12969e43e5e45b5402edf2))
* **migrate:** name every file the apply writes, and repair a half-made pair ([a3211e3](https://github.com/abdelrahmannasr/yadflow/commit/a3211e3dfc246bbe89ef3bc322fa6be29bd735bb))
* **migrate:** the --json preview names the product config's mirror partner ([1eb4738](https://github.com/abdelrahmannasr/yadflow/commit/1eb4738c64899db78fad46036603e2fc7b71f99c))
* **mode:** close the gaps the E10 review found ([afbeca4](https://github.com/abdelrahmannasr/yadflow/commit/afbeca4599f379e0e815a3bb48e253461f9d931a))
* **mode:** only a login's approval proves a second person; one wiring for the suggestion (E74) ([0bd132f](https://github.com/abdelrahmannasr/yadflow/commit/0bd132f7664645f56dcb182c29721f7a94713245))
* **next:** an off-route step is not an unknown one, and a phase is not a passed one ([7f08da2](https://github.com/abdelrahmannasr/yadflow/commit/7f08da218463caa7f630a464ba0423bba145c746))
* **open-pr:** no address, no cross-platform join, no quiet "nobody" (E68 review) ([0d7814e](https://github.com/abdelrahmannasr/yadflow/commit/0d7814e1021dfc73845e65e7403a6ea66d2f9b6d))
* **people:** a mistyped future approval is not proof even beside a current commit (E74) ([c1b9d7c](https://github.com/abdelrahmannasr/yadflow/commit/c1b9d7c18963133fca92e2eaaa4fdcd76676986e))
* **people:** ask git for an absolute date, so the count really does read no clock (E71) ([e065734](https://github.com/abdelrahmannasr/yadflow/commit/e0657347462310ef315068a3e9f3ba52d08b2b0a))
* **people:** close the identity question — `source: 'bridge'` is the proof, and the keyspace is namespaced ([9e055d7](https://github.com/abdelrahmannasr/yadflow/commit/9e055d711a70c2a6b6798dc5f87ec8a53be45158))
* **people:** the review round — eleven ways a partial read still became a number ([edf858e](https://github.com/abdelrahmannasr/yadflow/commit/edf858e6d3b2f5bd29877fe04517d8bcd5c4cdc8))
* **people:** validate the date git hands back — a formatter is not a validator ([dc1249a](https://github.com/abdelrahmannasr/yadflow/commit/dc1249aeae31e107eec359494b95e2230a16a4eb))
* **release:** refuse to ship a file-shape change as anything but a major ([173dc9a](https://github.com/abdelrahmannasr/yadflow/commit/173dc9a76453b0e5e0ec2341ad05458b71d9a085))
* **release:** the release checks ask semantic-release what a commit releases ([c5de745](https://github.com/abdelrahmannasr/yadflow/commit/c5de7453ed41bb5a6bac514652a857b6db5d7f8a))
* **risk-map:** close ten review findings in the map, its check and its command ([aafc578](https://github.com/abdelrahmannasr/yadflow/commit/aafc578c43cc2282e5aa837f3f88768cd7e5e30d))
* **risk-map:** doctor's section sat under threadChecks' comment; stale comments and help alignment ([5258b54](https://github.com/abdelrahmannasr/yadflow/commit/5258b54f352ba1d0276bec098d766e233beee77a))
* **risk-map:** every pathspec is :(literal) — a map name describes a directory, it never tells git what to do ([6a4ef28](https://github.com/abdelrahmannasr/yadflow/commit/6a4ef28bb105b3129445cef925d420863b7f271b))
* **risk-map:** first-review findings — a quoted path, a move out, an older check, and a name's own spacing ([016ad87](https://github.com/abdelrahmannasr/yadflow/commit/016ad87d050b611d69b6fb7d48a850dfac17a2a7))
* **risk-map:** first-review findings — read the base map from any subfolder, and never exit 1 on a trailing comma ([e6ac49f](https://github.com/abdelrahmannasr/yadflow/commit/e6ac49f32f5944d2beddbe3adc0b1b4ee2ca3ed7))
* **risk-map:** four second-review findings in the PR check and the file list ([c5eb332](https://github.com/abdelrahmannasr/yadflow/commit/c5eb33293b9dde0bfc0509dbcba45e94116646b0))
* **risk-map:** second-review findings — a failing git step is "not counted", and the check runs from the repo root ([c51a882](https://github.com/abdelrahmannasr/yadflow/commit/c51a882bcac73561b216e936ff495158d050782a))
* **risk-map:** second-review findings — a newline in a file name, and a merge that hid a real author ([845a341](https://github.com/abdelrahmannasr/yadflow/commit/845a341e08495cfc81dc24998e7bd80190587a62))
* **risk-map:** third-review finding — a failing git ls-tree is "not counted", not "no map" ([efeffc0](https://github.com/abdelrahmannasr/yadflow/commit/efeffc0e4bf5edfadbcc2a67fbc6b6397e1a63c5))
* **risk-map:** third-review findings — bytes for every tool in the check, and only the map itself counts as deleted ([ac4569e](https://github.com/abdelrahmannasr/yadflow/commit/ac4569ec8dba85ea39a7659e8b6038e7a1025d89))
* **setup:** keep a team's edit to .sdlc/config.yaml through yad update (E3) ([86b2034](https://github.com/abdelrahmannasr/yadflow/commit/86b20348a08bb0a82ce5de03bad0ec5347cbc15e))
* **skills:** the epic.md templates were unreadable by the gates they feed ([96922de](https://github.com/abdelrahmannasr/yadflow/commit/96922de4ae3e08efe8faee2cbff5abe6c468eabc))
* **skills:** the review gate must open the gate with the engine, not by hand ([f453509](https://github.com/abdelrahmannasr/yadflow/commit/f453509cbcdd0ec7fa9156af9324eb940846efb4))
* **skip:** close the holes the E39 review found ([33eb17a](https://github.com/abdelrahmannasr/yadflow/commit/33eb17a85f982456549b225603db04747cd27d94))
* **skip:** close the holes the verified-skip review found ([311e1ca](https://github.com/abdelrahmannasr/yadflow/commit/311e1cab3f439fc3a4752d997bdb2260ac42bf47))
* **skip:** refuse a skip on a ledger CI owns on a verified Product ([b9b2d1a](https://github.com/abdelrahmannasr/yadflow/commit/b9b2d1a54f7a31deaf75746581beb3e217611555)), closes [#162](https://github.com/abdelrahmannasr/yadflow/issues/162)
* **state:** a corrupt ledger gets an error with a hint, not a stack trace ([2cda22d](https://github.com/abdelrahmannasr/yadflow/commit/2cda22d76328e373dfc46b072385b02715529b95))
* **state:** a gate write moves the recorded shape, not just the fields ([6906c57](https://github.com/abdelrahmannasr/yadflow/commit/6906c577251d96ddf583e5fb83dfb265eb985a86))
* **state:** a short lane has no optional steps, and that is not a broken chain ([136eec8](https://github.com/abdelrahmannasr/yadflow/commit/136eec83888d5915facdf80c9dd073ff56d95513))
* **state:** close the holes the E41 review found in re-open and debt ([9b8565e](https://github.com/abdelrahmannasr/yadflow/commit/9b8565e165869f5a6b10f5c46c887bc422ce78d2))
* **state:** keep the product-level role under BOTH spellings, and report drift ([1b9ac44](https://github.com/abdelrahmannasr/yadflow/commit/1b9ac441a6055f2b17422f11c0aee0a025c7b3ba))
* **state:** make the two names one file, in both directions ([0a842c7](https://github.com/abdelrahmannasr/yadflow/commit/0a842c74560d96c47064009b3ab4714f0f00ab7f))
* **state:** one rule for "this epic's route never had that step" ([b687048](https://github.com/abdelrahmannasr/yadflow/commit/b687048e49c7bcfa4f512c7e92de31e6dce8f0d7))
* **state:** shape 6 stamps against the routes that existed when it landed ([939c862](https://github.com/abdelrahmannasr/yadflow/commit/939c86228b20540ad22c621c19b63e4859899647))
* **state:** the count reports, it does not hold a gate — yet (E7 review round) ([10bc3ff](https://github.com/abdelrahmannasr/yadflow/commit/10bc3ff06816ff6430bc47b8382363d57c6b9380))
* **state:** the review round — a live writer of `blocked` this change said did not exist ([7136b93](https://github.com/abdelrahmannasr/yadflow/commit/7136b930b10bba4e8ffe03d217e706409bd5153e))
* **state:** write the work-item type at the top of state.json, not the bottom ([195c03a](https://github.com/abdelrahmannasr/yadflow/commit/195c03aa96f5c12526b22d54c4db9ad9d4a4ef63))
* **thread:** an epic never owns an artifact its route has no step for ([6725c5a](https://github.com/abdelrahmannasr/yadflow/commit/6725c5ae9dde8e226f34ae1e1d5888fa86811641))


### Features

* **agents:** support agents beyond Claude Code, and guard Cursor too (E11) ([8481398](https://github.com/abdelrahmannasr/yadflow/commit/848139856c5d23cdf52b601d02f7155d5756d9b4))
* **checks:** guard the Foundation ledger in foundation/ (E75) ([0608e41](https://github.com/abdelrahmannasr/yadflow/commit/0608e41f8a203a633b4ef2e3449711de9201890c)), closes [#162](https://github.com/abdelrahmannasr/yadflow/issues/162)
* **checks:** guard the Product index as CI-owned on a verified Product (E19) ([5396827](https://github.com/abdelrahmannasr/yadflow/commit/5396827650597341cd98e935c595c73899b4a61f))
* **checks:** risk-map-check.sh warns on every PR where the risk map went stale ([bc2ada8](https://github.com/abdelrahmannasr/yadflow/commit/bc2ada8707a9499d5ef8afcb1e4259be02980eef))
* **cli:** add `yad skill` to bind, list and unbind a step's skill ([7b4c9c6](https://github.com/abdelrahmannasr/yadflow/commit/7b4c9c6cdc2e5734a5f670b805003782d877674f))
* **cli:** the project chooses which skill runs a step (E6) ([a07746e](https://github.com/abdelrahmannasr/yadflow/commit/a07746e327056448f1c3566490cf7d17aa13122d))
* **cli:** warn before any command reads a project on a newer file shape ([f5695da](https://github.com/abdelrahmannasr/yadflow/commit/f5695da00299169f3bdb34913aa7c90448501510))
* **cli:** yad epic new — the engine writes an epic's lifecycle (E17) ([92e67d6](https://github.com/abdelrahmannasr/yadflow/commit/92e67d635efddcadbd8f4399dac27b0c56402cbe))
* **codeowners:** warn when CODEOWNERS is stale (E69) ([6c35d6a](https://github.com/abdelrahmannasr/yadflow/commit/6c35d6a2d854e089561b708c6441616117816cf6))
* **defer:** yad defer --debt marks a deferral owed back, reminded until paid (E41) ([b20d57d](https://github.com/abdelrahmannasr/yadflow/commit/b20d57dc85abbb8509a6298bb5c98bff66cd827c))
* **defer:** yad defer and yad undefer set an optional step aside (E37) ([b6f2391](https://github.com/abdelrahmannasr/yadflow/commit/b6f2391df9feb0f9a0b9cf5af74eb928de138767))
* **dial:** yad dial, yad kill and yad unkill — the advance dial set freely (E34) ([56e8300](https://github.com/abdelrahmannasr/yadflow/commit/56e8300c37839f6a688d821f52ceee9ea682f219))
* **doctor:** keep the access cause open when GitLab names no default branch (E110) ([ddb8159](https://github.com/abdelrahmannasr/yadflow/commit/ddb8159c792e5bddb42fa135b68e25ab5774a073))
* **doctor:** name a leftover _bmad/sdlc/ folder (E3) ([5d7b1ab](https://github.com/abdelrahmannasr/yadflow/commit/5d7b1ab4632b5712226057a7d41a796070512bae))
* **doctor:** name the cause behind a GitLab branch 404 from its body (E109) ([64865d7](https://github.com/abdelrahmannasr/yadflow/commit/64865d71a8449453e05942f0dac69ec413b5e4c0))
* **doctor:** people:roster-unused says when the roster can go ([eb0c012](https://github.com/abdelrahmannasr/yadflow/commit/eb0c012963af43a15b62dc3c229cd32f7c791a3a))
* **doctor:** say whether each repo's branch requires an approval (E70) ([e93dd3b](https://github.com/abdelrahmannasr/yadflow/commit/e93dd3b7cbe4ed52fc1d9a9a7b91613c2bfe0cf8))
* **engine:** lifecycle profiles, with today's chains written down (E5) ([44564d4](https://github.com/abdelrahmannasr/yadflow/commit/44564d44d826265138d6fdc1f5feee5ab5760988))
* **engine:** the step catalogue, validated in code (E4) ([c3823bf](https://github.com/abdelrahmannasr/yadflow/commit/c3823bf4bed067a91496fe79c8cd490088c9e71c))
* **epic:** `yad foundation new` — the engine seeds the Product level (E75) ([2cf2241](https://github.com/abdelrahmannasr/yadflow/commit/2cf2241556d8bfef4e6682460c51ab86319024e7))
* **epic:** the grouping theme tag (E31) ([bf8a31c](https://github.com/abdelrahmannasr/yadflow/commit/bf8a31c880c445dedd1b4abb78f6314971c1cacb))
* **epic:** yad epic new --parent seeds a threaded change-epic (E42) ([3786ae2](https://github.com/abdelrahmannasr/yadflow/commit/3786ae246ec9b5759de590c72a928e33e2ad7d96))
* **foundation:** yad foundation status reads roadmap features from the epic ledgers ([e6a4a85](https://github.com/abdelrahmannasr/yadflow/commit/e6a4a853b2f31204ed687b16f0bdba3dd68c245c))
* **gate:** approvals record the platform's evidence; GitLab's approval time is read ([0e16728](https://github.com/abdelrahmannasr/yadflow/commit/0e167282349f832128757caeda10200617b0a2d7)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** cap the approval count at the active people less one, and record every cap (E72) ([f99e77d](https://github.com/abdelrahmannasr/yadflow/commit/f99e77da98484623d6ed1cb270dcc1dea3a08c1f))
* **gate:** every surface that reports a gate prints the arithmetic ([0ac5617](https://github.com/abdelrahmannasr/yadflow/commit/0ac56179cd49ab3d66ee2e8642500cd3f420e27c))
* **gate:** print how many people there are to ask, on every surface a gate reports itself (E71) ([cfabed9](https://github.com/abdelrahmannasr/yadflow/commit/cfabed9521d431b043ab356b46f9f54ec306a005))
* **gate:** record how a step closed (E18) ([a1c9050](https://github.com/abdelrahmannasr/yadflow/commit/a1c905037061437ecdf6183df26f246cb8cb049b))
* **gate:** record the platform login on older records while the roster exists ([cc7b02f](https://github.com/abdelrahmannasr/yadflow/commit/cc7b02f36658c5517fcc49b3f464ca1cfeeff048))
* **gate:** rename the PR ledger too, and guard both names ([c0b8b00](https://github.com/abdelrahmannasr/yadflow/commit/c0b8b00bdf77203346127984f67cce95206ba054))
* **gate:** say on the closing record when solo mode waived the approvals (E10) ([f733e5e](https://github.com/abdelrahmannasr/yadflow/commit/f733e5e10a9b8ae3c6255e4e724122e9346ac64b))
* **gate:** say when a gate may not be met — reported, never enforced (E73) ([444b67c](https://github.com/abdelrahmannasr/yadflow/commit/444b67c0e77087d286fab60bd853e1f3272320c0))
* **gate:** the gate bot converts a verified Product's product level to foundation/ ([ad3bc94](https://github.com/abdelrahmannasr/yadflow/commit/ad3bc94b0a373bd131bb1609afd6cac610aeeef8))
* **gate:** warn when a Foundation section still holds only its template (E76) ([8a5be38](https://github.com/abdelrahmannasr/yadflow/commit/8a5be38404bcb022cf9e98b10d529815d6bc4ad4))
* **history:** yad history — list, show, search, all with --json (E20) ([c37c9fe](https://github.com/abdelrahmannasr/yadflow/commit/c37c9fe8c346855c3a04d6921438ccaade336d3f))
* **index:** `yad index` rebuilds the front door on the default branch (E19) ([5b6dfd6](https://github.com/abdelrahmannasr/yadflow/commit/5b6dfd6f3ae01a5f9409fb63e59f32dad5ab429d))
* **index:** a title for every work item, carried by the Product index (E111) ([7ab7833](https://github.com/abdelrahmannasr/yadflow/commit/7ab78334eab64153e5d5e7a31939416ff4224f19))
* **index:** build the Product index from every work item's own files (E19) ([5024d61](https://github.com/abdelrahmannasr/yadflow/commit/5024d61807a4354c6969dedf1d0d87aa01e318c2))
* **index:** the gate, CI and migrate keep the index; doctor says when it is behind (E19) ([97aba2b](https://github.com/abdelrahmannasr/yadflow/commit/97aba2be1d3c934548c195a5d8b6b1647ba8910b))
* **lifecycle:** name the six phases, derived from the step ([1b77249](https://github.com/abdelrahmannasr/yadflow/commit/1b77249c197ca70df7f95270004ca94a6b930d6a))
* **mode:** suggest team mode when the count disagrees with solo (E74) ([4756ef9](https://github.com/abdelrahmannasr/yadflow/commit/4756ef92ecedfe0dda0e5bfa3f2785a10ac6424a))
* **mode:** yad mode solo|team sets who must approve, and records the change (E10) ([ce4077c](https://github.com/abdelrahmannasr/yadflow/commit/ce4077c5055812f61736924c2f76c903acd6db66))
* **open-pr:** suggest reviewers from history and CODEOWNERS (E68) ([9214ed9](https://github.com/abdelrahmannasr/yadflow/commit/9214ed90123d55ea1fed59541df9148b0b322ed9))
* **people:** count active people live, three windows, unknown is never a small number (E71) ([1b186a0](https://github.com/abdelrahmannasr/yadflow/commit/1b186a0125f3b5a1ece5edc85521e0b58596fd59))
* **platform:** a record names the login gh/glab reports, not the roster's (E62) ([6c2ef4e](https://github.com/abdelrahmannasr/yadflow/commit/6c2ef4ee4df6da9e8f9000055e1aa32359ded0bc))
* **risk-map:** a directory to risk-level map per code repo, with yad risk-map check|draft and a doctor section ([f3d8115](https://github.com/abdelrahmannasr/yadflow/commit/f3d811547360381409560583cce2e601f1e73cc4))
* **risk-map:** a high directory asks for an approver who has worked there lately (E67) ([28f4e58](https://github.com/abdelrahmannasr/yadflow/commit/28f4e58903432d4bb1cfa7e45529ad65f840c9b6))
* **risk-map:** a high directory on the base branch's map adds the high step (E66) ([ad6fcac](https://github.com/abdelrahmannasr/yadflow/commit/ad6fcaca496c7dbc377268a9771bdf18b3737e91))
* **setup:** install the module config into .sdlc/, not _bmad/sdlc/ (E3) ([da18dac](https://github.com/abdelrahmannasr/yadflow/commit/da18dacc1b02c9dba9f1079aeb26c89286805137))
* **setup:** let a scripted setup choose its agent directories ([8c13a06](https://github.com/abdelrahmannasr/yadflow/commit/8c13a0672a231b70646501a8b780da85bf503ff6))
* **skills:** the epic and change templates carry a theme ([8b0c71d](https://github.com/abdelrahmannasr/yadflow/commit/8b0c71ddeaec9ea189e663644f7353a1a3c8246a))
* **skills:** the skills call the engine instead of writing state.json (E17b) ([f0e0d77](https://github.com/abdelrahmannasr/yadflow/commit/f0e0d77eb97ae20a929f04d5bb4d947546c3d4bc))
* **skip:** yad skip <epic> <story> --repo skips a whole Build lane (E39) ([261e73e](https://github.com/abdelrahmannasr/yadflow/commit/261e73e360bb31cc35272d7c4f6a06394b713515))
* **skip:** yad skip and yad unskip name no step (E36) ([abbb4e0](https://github.com/abdelrahmannasr/yadflow/commit/abbb4e080fc2c21c61776f555a5b1c66e2359b53))
* **state:** a chore lane and a spike lane (E40) ([f521c22](https://github.com/abdelrahmannasr/yadflow/commit/f521c22487e5ad44b029e977ae6716925f4ec731))
* **state:** a Shape author step is not a gate because it is locked (E34) ([298546e](https://github.com/abdelrahmannasr/yadflow/commit/298546ef6ef67ea1c42cf01178aecc494bd938ef))
* **state:** a step is optional because the epic's ROUTE says so (E35) ([1641b46](https://github.com/abdelrahmannasr/yadflow/commit/1641b46e6fd3b57526862ce4448c4506ccdce4ec))
* **state:** a step's gate says how many people it needs (E7) ([314e709](https://github.com/abdelrahmannasr/yadflow/commit/314e70982a0b61927c0a379516d4233c08260b99))
* **state:** every ledger walker finds the Foundation (E75) ([bf86753](https://github.com/abdelrahmannasr/yadflow/commit/bf867537d17150633faa5a9014df2c4b1e59238c))
* **state:** give the product settings their new name, keeping the old one beside it ([8d0cf1b](https://github.com/abdelrahmannasr/yadflow/commit/8d0cf1b500a6a15fcbb5e53b7806966bf1457a90))
* **state:** the Product level — Foundation in the model (E75) ([676bbd1](https://github.com/abdelrahmannasr/yadflow/commit/676bbd1ae4557e0c4eb744f62f75ada74969b36b))
* **state:** the step-state model, and shape 7 writes it (E38) ([4064067](https://github.com/abdelrahmannasr/yadflow/commit/40640673adae5f2065041d92d431fdda522b6b32))
* **unblock:** yad unblock clears a recorded blocker (E37) ([5ba73f5](https://github.com/abdelrahmannasr/yadflow/commit/5ba73f560923fcf297ab460a82cca26ee2c1feeb))
* **update:** name an edited gate-sync fragment left on another major ([b33f9e6](https://github.com/abdelrahmannasr/yadflow/commit/b33f9e61c51101f2e5ebb9756e185ece3ce7de74)), closes [#164](https://github.com/abdelrahmannasr/yadflow/issues/164)


### BREAKING CHANGES

* `yad docs build`, `yad docs deploy` and
`yad docs sync --refresh` now exit 1 when a site's npm install or build
fails, or when a site named with --epic/--overview was never generated;
`yad docs build` also exits 1 when npm is not on PATH. Under --json these
are refusals (`ok: false`) naming the site. A script that ran them and
ignored build failures will now stop.
* every `--json` answer is now the E1 envelope. `yad
history --json` carries `jsonVersion` instead of `schemaVersion`; `yad
thread --json` and the review bundles gain `ok`; `yad usage --json`
wraps the model (`--format json` still prints the bare model); a refusal
always has `error`, `code` and `hint`; `warnings` is always present. The
full list is in docs/CLI.md, "--json on every command".
* the ROUTE line of risk-route.sh and hub-route.sh
changed; anything parsing it must be updated.
* in a repo whose refreshed gate has landed, a Verified
commit from an email nobody listed now passes CI.
* `yad roster` is removed, and `yad setup` no longer
collects reviewers or repo owners.
* `yad usage --json` members carry no `role` or `rostered`,
and the `dormant` and `reviewer-not-reviewing` flags are no longer raised.
* review and task PRs no longer request reviewers
automatically.
* the owner/reviewer/domain-owner rule no longer holds a
team gate; one approver does. `defaultReviewers` and the roster shape
check are gone.
* file shape 10. An older yadflow reading a chain with a
re-opened step names that step the blocker of the work after it, and
re-opens that work when its review passes. See docs/migrations/shape-10.md.
* file shape 9. An older yadflow fingerprints the whole
file, so it reads every approval this release records on a file with a
`status:` line as stale. On a local ledger with mixed versions, that
holds an open gate for the teammate on the older release. Upgrade
everyone on the project together. A verified project runs
`yad migrate --apply` and commits the result; CI brings each state.json
to shape 9 at its next write.
* file shape 8. A migrated project keeps its product level
in `foundation/`, which a 3.x yadflow does not read. Upgrade everyone on
the project together. On a verified Product, run `yad update` so the
committed checks guard `foundation/`.
* **state:** shape 7 is the first file shape that changes a value in place
rather than adding a key beside an old one, so a 3.x CLI cannot read a migrated
project: it sees `todo` as an unknown status and reads `skipped` / `satisfied` as
"not done", which makes a UI-less epic or a change-epic look stuck. This release
reads every pre-shape-7 project correctly; run `yad migrate --preview` first and
upgrade everyone on the project. See docs/migrations/shape-7.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
* file shape 5. Run `yad migrate` to preview, then
`yad migrate --apply`. See docs/migrations/shape-5.md.
* project files change shape twice in this release, and both are
handled by one command. Shape 2 records who writes the ledger as
`"ledger": "verified" | "local"` in the product settings; shape 3 renames those
settings from `.sdlc/hub.json` to `.sdlc/product.json`, renames each epic's
`hub-prs.json` to `product-prs.json`, and gives every reviewer's product-level
role a second spelling. Nothing is taken away: every old name is still written
and is still the one read, so a check gate committed in your repository keeps
working whether or not you have run `yad update`. Run `npx yadflow@<version>
migrate` to preview — it writes nothing — then `yad migrate --apply`, which backs
up every file it rewrites. docs/migrations/shape-2.md and shape-3.md explain both.

Shape 2 shipped earlier as 3.19.0-next without declaring a break, which meant the
"run yad migrate first" banner never fired for it. This footer covers both.

# [3.19.0-next.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.19.0-next.1...v3.19.0-next.2) (2026-09-07)


### Bug Fixes

* **release:** let a pre-release publish past its own test suite ([70286ce](https://github.com/abdelrahmannasr/yadflow/commit/70286ce833b300d02d2781ac589d727481f5e7eb))

# [3.19.0-next.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.18.1...v3.19.0-next.1) (2026-09-07)


### Bug Fixes

* **checks:** accept every integrity algorithm Corepack accepts in packageManager ([367947d](https://github.com/abdelrahmannasr/yadflow/commit/367947d8d9856138b531061e4b686057ee9f715f))
* **checks:** cache the Corepack home alongside the dependency cache ([23d92bc](https://github.com/abdelrahmannasr/yadflow/commit/23d92bc8204063bbd7754bfd038585eeb6f705bb))
* **checks:** close configurable CI review findings ([6d90018](https://github.com/abdelrahmannasr/yadflow/commit/6d900183bbee5785f4ff0d5c868a6a55ce01a9b7))
* **checks:** fail with guidance when corepack is missing for a declared packageManager ([3a9f576](https://github.com/abdelrahmannasr/yadflow/commit/3a9f5760bcca050d87008e414b856d5b307f30b8))
* **checks:** give the same guidance when Corepack is present but stale ([0cdf4d1](https://github.com/abdelrahmannasr/yadflow/commit/0cdf4d157946d9185bfcc286ebddcdfb5d65a6aa))
* **checks:** keep a yarn/bun-declared repo with an npm lockfile on the npm path ([713e707](https://github.com/abdelrahmannasr/yadflow/commit/713e7074b6813de0e0fd6e12e970e8372a1309eb))
* **checks:** keep the gate jobs' variables off the host GitLab pipeline ([7cb2c35](https://github.com/abdelrahmannasr/yadflow/commit/7cb2c35a3011dbd8bf8d048f7aa02578ac54a1db))
* **checks:** keep the npm path when a repo carries both lockfiles ([67fbdb4](https://github.com/abdelrahmannasr/yadflow/commit/67fbdb4e2c82188b37b1d175260b48da17d5e051))
* **checks:** make build-test-lint fail closed on a rejected package.json ([83241ee](https://github.com/abdelrahmannasr/yadflow/commit/83241eed61e4306853151e6105c0b7c8bdd06d55))
* **checks:** pass the worker cap to jest/vitest under pnpm without npm's `--` ([55db7ee](https://github.com/abdelrahmannasr/yadflow/commit/55db7eed85173472a17e7591636d7fc830a5a5b6))
* **checks:** read package.json the way npm does before judging it ([8021c78](https://github.com/abdelrahmannasr/yadflow/commit/8021c7850d4f7d0887923165adc585fc27da260a))
* **checks:** require lowercase Corepack digests ([4750b8b](https://github.com/abdelrahmannasr/yadflow/commit/4750b8b597bfdd4d7d2739a0525f91a2002e41a3))
* **checks:** restore dependency caching in the GitHub quality job, for pnpm too ([21c92f0](https://github.com/abdelrahmannasr/yadflow/commit/21c92f026aa590ec464eec7152af27ad2be9a49d))
* **checks:** run the gate's lint/build/test through the pinned npm too ([8404da3](https://github.com/abdelrahmannasr/yadflow/commit/8404da326f8a19ae807c58808b6203572aadb9b4))
* **checks:** support configurable CI toolchains ([30557e4](https://github.com/abdelrahmannasr/yadflow/commit/30557e419a9fec5adca06a3ecb8ca09469b2a58a))
* **checks:** validate Corepack integrity metadata ([a6c3fd3](https://github.com/abdelrahmannasr/yadflow/commit/a6c3fd3d84a370f81477ed9b551bc29f5765296f))
* **skills:** teach the skill layer that `ledger` is the switch ([d4622ab](https://github.com/abdelrahmannasr/yadflow/commit/d4622ab2293cfe49a36791f6cf51472b4d5701ad)), closes [#186](https://github.com/abdelrahmannasr/yadflow/issues/186)
* **state:** read an unstamped file as shape 1, not as the engine's shape ([6d8c608](https://github.com/abdelrahmannasr/yadflow/commit/6d8c608215175fac98933ffee6f714471454a8d9))
* **update:** install templates newly added to a wired repo on `yad update` ([8e8d92f](https://github.com/abdelrahmannasr/yadflow/commit/8e8d92f1265e2ed375bf0a53307270a25d8c33f3))
* **update:** take only yad's own wiring as proof a repo is wired ([3c90134](https://github.com/abdelrahmannasr/yadflow/commit/3c90134985eebb3b7faa91be2c45387d54851324))


### Features

* **state:** record who writes the ledger as `ledger: verified | local` ([6623199](https://github.com/abdelrahmannasr/yadflow/commit/66231997156bb1ffa446ebb5edd28d8ebf8def91)), closes [#186](https://github.com/abdelrahmannasr/yadflow/issues/186)

## [3.18.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.18.0...v3.18.1) (2026-09-05)


### Bug Fixes

* **docs:** raise the template's react-router-dom floor to the patched version ([ca510d4](https://github.com/abdelrahmannasr/yadflow/commit/ca510d40d42600254aa39821de99ae5990698605))
* **docs:** ship the docs template with a patched react-router-dom ([28b6ff7](https://github.com/abdelrahmannasr/yadflow/commit/28b6ff768fb6b11799ab28e4e4d780aa6bfca5bc)), closes [hi#severity](https://github.com/hi/issues/severity)

# [3.18.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.17.3...v3.18.0) (2026-09-05)


### Features

* **cli:** add yad migrate with preview, backup and report ([39dde87](https://github.com/abdelrahmannasr/yadflow/commit/39dde87b9f38936b05b6cd6243a67b9a2aea7fb9))
* **doctor:** report shape drift against the engine ([f2dc377](https://github.com/abdelrahmannasr/yadflow/commit/f2dc377815a1135b4015cff9f46f3384dc08ee56))
* **release:** publish majors to a next channel and warn before upgrading ([70d2334](https://github.com/abdelrahmannasr/yadflow/commit/70d23347021a3635e8d71f6465d516bd6e72322d))
* **state:** stamp schemaVersion 1 on every engine-written file ([872dde6](https://github.com/abdelrahmannasr/yadflow/commit/872dde61975b942e95670c60f329621802256ab8)), closes [#163](https://github.com/abdelrahmannasr/yadflow/issues/163)

## [3.17.3](https://github.com/abdelrahmannasr/yadflow/compare/v3.17.2...v3.17.3) (2026-09-03)

## [3.17.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.17.1...v3.17.2) (2026-09-03)

## [3.17.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.17.0...v3.17.1) (2026-09-02)

# [3.17.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.16.3...v3.17.0) (2026-08-12)


### Bug Fixes

* **check:** leave an already-wired settings.json byte-identical ([1d50ed4](https://github.com/abdelrahmannasr/yadflow/commit/1d50ed4b173f7de2350344fc5facb1de19bd9c61))
* **check:** stop the hook wiring from damaging a file the team owns ([a348c99](https://github.com/abdelrahmannasr/yadflow/commit/a348c997ba3b87406addef4e5868bdd14406fa49))
* **doctor:** give an unparseable settings file its own advice ([0862875](https://github.com/abdelrahmannasr/yadflow/commit/08628750a3c8e8642075db0fc0712d217dacdeb4))
* **doctor:** report the ledger guard against what actually arms it ([a1ec4ba](https://github.com/abdelrahmannasr/yadflow/commit/a1ec4bafec8441b6bf8c0515bf4f1bd68cb00ef7))
* **hook:** read the seeded set the way the CI gate reads it ([38cd206](https://github.com/abdelrahmannasr/yadflow/commit/38cd206fc94256782a074a309fe6dbc2ae3ce135)), closes [#171](https://github.com/abdelrahmannasr/yadflow/issues/171)
* **hook:** resolve the command before suppressing the update notice ([44d8768](https://github.com/abdelrahmannasr/yadflow/commit/44d87683abbc8acff02b011b6ce47d140e8075d3))
* **hook:** survive an empty command array on bash 3.2 ([7fd6984](https://github.com/abdelrahmannasr/yadflow/commit/7fd698412d8229f312f62c2a21f299dad445700b))


### Features

* **check:** install and report the agent ledger guardrail ([8251d9f](https://github.com/abdelrahmannasr/yadflow/commit/8251d9f92740690ca7b3e27a0280f999593793f3))
* **hook:** refuse an agent the CI-owned ledger write, at the edit ([15291ce](https://github.com/abdelrahmannasr/yadflow/commit/15291ce2d73167cebeb5aba52920bdb078d6d0aa))

## [3.16.3](https://github.com/abdelrahmannasr/yadflow/compare/v3.16.2...v3.16.3) (2026-08-12)


### Bug Fixes

* **open-pr:** base the task PR on the repo default branch, not main ([63da011](https://github.com/abdelrahmannasr/yadflow/commit/63da011fd2c4b6e81940c646879cc692b634a877)), closes [#168](https://github.com/abdelrahmannasr/yadflow/issues/168)


### Performance Improvements

* **review:** stop probing the platform for an already-configured base ([0fc3de3](https://github.com/abdelrahmannasr/yadflow/commit/0fc3de34c7a522ec3463953778787f247ab28071)), closes [#191](https://github.com/abdelrahmannasr/yadflow/issues/191)

## [3.16.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.16.1...v3.16.2) (2026-08-12)


### Bug Fixes

* **checkpoint:** make a --retro-ship dry run honest and side-effect free ([b03704f](https://github.com/abdelrahmannasr/yadflow/commit/b03704fb0564b1510dca121a24853758431f9374)), closes [112/#142](https://github.com/abdelrahmannasr/yadflow/issues/142) [#167](https://github.com/abdelrahmannasr/yadflow/issues/167)
* **checkpoint:** name the shard path and the fold step after --retro-ship ([64c33b3](https://github.com/abdelrahmannasr/yadflow/commit/64c33b37171ee1cebf540b7a66c35ee56cdc61a7)), closes [#167](https://github.com/abdelrahmannasr/yadflow/issues/167) [#167](https://github.com/abdelrahmannasr/yadflow/issues/167)
* **skills:** read build-log as the folded + shard union ([4302de2](https://github.com/abdelrahmannasr/yadflow/commit/4302de2e5f569989e8fc51c0a165aaae5abe1625)), closes [#167](https://github.com/abdelrahmannasr/yadflow/issues/167)

## [3.16.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.16.0...v3.16.1) (2026-08-12)


### Bug Fixes

* **checkpoint:** guard --retro-ship per repo so a multi-repo story can be fully recorded ([d6d2fae](https://github.com/abdelrahmannasr/yadflow/commit/d6d2faeea91c0d59a00a532c0605f76c5b77eace)), closes [#166](https://github.com/abdelrahmannasr/yadflow/issues/166)
* **checkpoint:** validate the retro-ship repo instead of relying on the duplicate guard ([f1e085e](https://github.com/abdelrahmannasr/yadflow/commit/f1e085e89e4eb10fbf853647ab10c1912237daf8)), closes [#166](https://github.com/abdelrahmannasr/yadflow/issues/166) [#166](https://github.com/abdelrahmannasr/yadflow/issues/166) [#166](https://github.com/abdelrahmannasr/yadflow/issues/166)
* **ledger:** hold an exclusive lock across a ledger read-modify-write ([45b849a](https://github.com/abdelrahmannasr/yadflow/commit/45b849a7755a5bc58bc646e627218170a54b31bc)), closes [#166](https://github.com/abdelrahmannasr/yadflow/issues/166)

# [3.16.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.5...v3.16.0) (2026-08-12)


### Bug Fixes

* **pr-template:** name GitLab's 2700-character description truncation ([475e2b7](https://github.com/abdelrahmannasr/yadflow/commit/475e2b7db8f0d24909ce5c874122f18dc6508985)), closes [#164](https://github.com/abdelrahmannasr/yadflow/issues/164)
* **update:** reject an unusable provenance record instead of ignoring it ([5107381](https://github.com/abdelrahmannasr/yadflow/commit/5107381ae2c08b261fddda76433cfc2a3fe3ea46)), closes [#188](https://github.com/abdelrahmannasr/yadflow/issues/188) [#164](https://github.com/abdelrahmannasr/yadflow/issues/164)


### Features

* **update:** never silently overwrite a locally modified managed file ([28d6ee4](https://github.com/abdelrahmannasr/yadflow/commit/28d6ee4c1af250415c3ad50d999a263ebe91cd83)), closes [#164](https://github.com/abdelrahmannasr/yadflow/issues/164)

## [3.15.5](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.4...v3.15.5) (2026-08-12)


### Bug Fixes

* **bridge:** resolve the wired gate-sync pin from the repo, not a floating major ([8489bf5](https://github.com/abdelrahmannasr/yadflow/commit/8489bf5298f529868dc65085068882b59e89bbb5)), closes [#163](https://github.com/abdelrahmannasr/yadflow/issues/163) [#163](https://github.com/abdelrahmannasr/yadflow/issues/163)
* **checks:** require a platform for the ledger-guard bridge gate ([297d13a](https://github.com/abdelrahmannasr/yadflow/commit/297d13a0ebf26bec995ce64e0aacfa022b228e18)), closes [#185](https://github.com/abdelrahmannasr/yadflow/issues/185) [#186](https://github.com/abdelrahmannasr/yadflow/issues/186)
* **checks:** scope the ledger-guard bridge read to root-level keys ([4fb83a9](https://github.com/abdelrahmannasr/yadflow/commit/4fb83a968d4537e89a9367d72418aede9cf305f0)), closes [#186](https://github.com/abdelrahmannasr/yadflow/issues/186) [#186](https://github.com/abdelrahmannasr/yadflow/issues/186)

## [3.15.4](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.3...v3.15.4) (2026-08-12)

## [3.15.3](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.2...v3.15.3) (2026-08-11)


### Bug Fixes

* **bridge:** pass the PR head ref through env, not into the run script ([306f49f](https://github.com/abdelrahmannasr/yadflow/commit/306f49f569c5398bbfb36ce9aa3fb38d8341336c))
* **gate:** make the reconcile sweep converge instead of committing forever ([6bcb8fd](https://github.com/abdelrahmannasr/yadflow/commit/6bcb8fd8cd296b669bcf11226013fcd2e107f650)), closes [#163](https://github.com/abdelrahmannasr/yadflow/issues/163)
* **gate:** stage the merge commit from an allowlist, not the whole epic dir ([8142ddc](https://github.com/abdelrahmannasr/yadflow/commit/8142ddcce0f889505a29558c6664e42548d9d671))

## [3.15.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.1...v3.15.2) (2026-08-11)


### Bug Fixes

* **checks:** exempt a new epic's ledger seed from ledger-guard ([ba923c2](https://github.com/abdelrahmannasr/yadflow/commit/ba923c2a3823e8bf17b2fc59b41f0160a3a11a19)), closes [#162](https://github.com/abdelrahmannasr/yadflow/issues/162)

## [3.15.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.15.0...v3.15.1) (2026-08-11)


### Bug Fixes

* **checks:** close the silent-PASS holes the [#161](https://github.com/abdelrahmannasr/yadflow/issues/161) fix left open ([0f180ab](https://github.com/abdelrahmannasr/yadflow/commit/0f180abc72618fcd793ef6717fe1e128aa5ccfa5))
* **checks:** pin every changed contract slice, not just the first ([a79a946](https://github.com/abdelrahmannasr/yadflow/commit/a79a946aa37c08615741082bc638d006f7e80b76)), closes [#161](https://github.com/abdelrahmannasr/yadflow/issues/161)
* **checks:** read hub.json and the contract lock across line breaks ([43a618d](https://github.com/abdelrahmannasr/yadflow/commit/43a618d0822ed8576b9a164889bc53a52bbdf713)), closes [#161](https://github.com/abdelrahmannasr/yadflow/issues/161)

# [3.15.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.14.0...v3.15.0) (2026-08-10)


### Features

* **testing:** add maestro as a testing-tool adapter ([7718b50](https://github.com/abdelrahmannasr/yadflow/commit/7718b502814ee8e0eb46f5e6f20342fc2471dbd7))

# [3.14.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.13.2...v3.14.0) (2026-08-10)


### Features

* **next:** emit the action object with --json ([40d34dd](https://github.com/abdelrahmannasr/yadflow/commit/40d34ddba2492821700c7a877de28938faa74f3e))

## [3.13.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.13.1...v3.13.2) (2026-08-10)


### Bug Fixes

* **doctor:** fail a done review gate that holds no approval ([b1b23df](https://github.com/abdelrahmannasr/yadflow/commit/b1b23df5426e8523cdb1d95221cb2291200c6249))

## [3.13.1](https://github.com/abdelrahmannasr/yadflow/compare/v3.13.0...v3.13.1) (2026-07-29)


### Bug Fixes

* **checks:** apply the Task-trailer rule to the thread gates too ([18aed8d](https://github.com/abdelrahmannasr/yadflow/commit/18aed8df958718483fe929cea84275ca86ae67be)), closes [#157](https://github.com/abdelrahmannasr/yadflow/issues/157)
* **checks:** do not build a /-rooted lock path when product-repo is absent ([0d2a214](https://github.com/abdelrahmannasr/yadflow/commit/0d2a214a30c7fc31ad087fa127277b50637a00de))
* **checks:** keep product-repo resolution backward-compatible and loud ([4c00c92](https://github.com/abdelrahmannasr/yadflow/commit/4c00c928642fbab4517805be14a1c6926f41b84c)), closes [#149](https://github.com/abdelrahmannasr/yadflow/issues/149) [#149](https://github.com/abdelrahmannasr/yadflow/issues/149)
* **checks:** resolve link.md product-repo the same way in every gate ([47c9b30](https://github.com/abdelrahmannasr/yadflow/commit/47c9b30548153ef5be607cf760c3e9ec9e73699f)), closes [#149](https://github.com/abdelrahmannasr/yadflow/issues/149)
* **checks:** spec-link resolves a Task trailer even on a maintenance commit ([d24dd83](https://github.com/abdelrahmannasr/yadflow/commit/d24dd83abadc63bb00e8c8d6d7c6008e32344db8)), closes [#157](https://github.com/abdelrahmannasr/yadflow/issues/157)
* **doctor:** refuse a decorative contract lock, and report a gate that went stale ([1ee3296](https://github.com/abdelrahmannasr/yadflow/commit/1ee3296dbddfdd308949b8013b3bf678f638fc80)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** bound the review-branch probe so it can never hang gate open ([afa5416](https://github.com/abdelrahmannasr/yadflow/commit/afa54167efd5879537c4bc19ab29531fe08ed31b))
* **gate:** hash the contract surface exactly as the documented recipe does ([f29e781](https://github.com/abdelrahmannasr/yadflow/commit/f29e78183b92c7baf33b46dbdfa7a4776aa06e4e)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** keep the recorded PR entry when --pr names that same PR ([b1febe1](https://github.com/abdelrahmannasr/yadflow/commit/b1febe184278109f0bafc2968648da362d68483a))
* **gate:** make a merged review PR reachable by hand ([4ccbd17](https://github.com/abdelrahmannasr/yadflow/commit/4ccbd1736640935175d63bac15a01a94e381b44e)), closes [#158](https://github.com/abdelrahmannasr/yadflow/issues/158)
* **gate:** never drop a done step's approval record on re-sync ([1a5e434](https://github.com/abdelrahmannasr/yadflow/commit/1a5e4348d00edd4e775a735a49fc0a86a3f0e391)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** re-bind approvals recorded before PR provenance existed ([6b7e816](https://github.com/abdelrahmannasr/yadflow/commit/6b7e816638a329d9365c6e727b2c12debdbd24aa)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156) [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** re-sync a re-opened review so its approvals re-bind ([28eabd2](https://github.com/abdelrahmannasr/yadflow/commit/28eabd222214ad2af7d18ef20c56795c9eb171d1)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** require the review branch on origin, and check before writing state ([27f0d92](https://github.com/abdelrahmannasr/yadflow/commit/27f0d92ce680c26df6ea7ff6510879a11f05d00f)), closes [#158](https://github.com/abdelrahmannasr/yadflow/issues/158)
* **gate:** stop a done-step re-sync from churning the ledger ([68462a6](https://github.com/abdelrahmannasr/yadflow/commit/68462a622753c0d30b458d22d9e1ad890ad8e61f)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)
* **gate:** validate --pr and confirm it names this artifact's review ([f5d7773](https://github.com/abdelrahmannasr/yadflow/commit/f5d7773da474784a43cc3e24298da94c8f38bbdb)), closes [#7](https://github.com/abdelrahmannasr/yadflow/issues/7) [#158](https://github.com/abdelrahmannasr/yadflow/issues/158)
* **hub-bridge:** serialize the GitLab gate-sync job ([4294979](https://github.com/abdelrahmannasr/yadflow/commit/4294979f80cb4491d074fe27e74f9af454a2f62a)), closes [#156](https://github.com/abdelrahmannasr/yadflow/issues/156)

# [3.13.0](https://github.com/abdelrahmannasr/yadflow/compare/v3.12.2...v3.13.0) (2026-07-14)


### Features

* **checkpoint:** add --retro-ship to reconcile pre-tracking shipped stories ([#142](https://github.com/abdelrahmannasr/yadflow/issues/142)) ([d7988a3](https://github.com/abdelrahmannasr/yadflow/commit/d7988a335da7d675dd7b53456c12610c3f442d97)), closes [#112](https://github.com/abdelrahmannasr/yadflow/issues/112) [#112](https://github.com/abdelrahmannasr/yadflow/issues/112)

## [3.12.2](https://github.com/abdelrahmannasr/yadflow/compare/v3.12.1...v3.12.2) (2026-07-14)


### Bug Fixes

* **checks:** waive verified-commits signature for content-free merge commits ([1e73837](https://github.com/abdelrahmannasr/yadflow/commit/1e738372f821e93020069b565d40315cd7be2591)), closes [#138](https://github.com/abdelrahmannasr/yadflow/issues/138)

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
