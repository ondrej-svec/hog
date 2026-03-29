# Changelog

## [1.26.0](https://github.com/ondrej-svec/hog/compare/hog-v1.25.1...hog-v1.26.0) (2026-03-29)


### Features

* add --architecture flag to pipeline create ([a2bc27e](https://github.com/ondrej-svec/hog/commit/a2bc27e21a1f711a3c5a081bdf0e06f6666677dc))
* add hog pipeline review command (Newport recommendation) ([86e6114](https://github.com/ondrej-svec/hog/commit/86e6114d9605fdec62524f730eb5f140ce327421))
* add scaffold phase — project preparation between stories and tests ([b67e4b5](https://github.com/ondrej-svec/hog/commit/b67e4b5d4261874f0cac05c61904904a3b1aa6ca))
* agents follow architecture doc for file paths, not hardcoded paths ([6d834a3](https://github.com/ondrej-svec/hog/commit/6d834a33e600411b5b76f7fcde38812fdf4cf336))
* auto-launch brainstorm session on pipeline creation ([22ff4cb](https://github.com/ondrej-svec/hog/commit/22ff4cb99c2807c0295a809483d9f2d7581bdde1))
* auto-pause pipeline on API rate limit ([2b4facc](https://github.com/ondrej-svec/hog/commit/2b4faccb58518e99fe6a1c3b9937b7d24e54549a))
* **board:** add PipelineView component skeleton ([caf893d](https://github.com/ondrej-svec/hog/commit/caf893d856509217d886011da9199410b94bce72))
* **board:** Pipeline View with real Conductor data and P key to start pipelines ([b1ea72d](https://github.com/ondrej-svec/hog/commit/b1ea72dc74c6ebff5f2444b588082cee0315a83c))
* **board:** real progress tracking, DAG status colors, inline decision answering ([4698484](https://github.com/ondrej-svec/hog/commit/46984844080f064756323bd1206d1d25b64bc99f))
* **board:** show pipeline log entries in detail panel ([314f629](https://github.com/ondrej-svec/hog/commit/314f6292bc4e3083da3e5b90942f08ab6cfc2c6e))
* **board:** status bar, agent monitoring, inline errors, all-clear state ([187e29d](https://github.com/ondrej-svec/hog/commit/187e29df7cd3bcc985c9271ec69e100ac3a959ca))
* **board:** wire Pipeline View into dashboard with view switching ([43dd224](https://github.com/ondrej-svec/hog/commit/43dd2246b9796d5ba91c9aea91efc97f61911d09))
* Claude adapter + configurable pipeline.worker ([8b186ef](https://github.com/ondrej-svec/hog/commit/8b186ef220a594e12750cad0967ea2820a5ca797))
* **cli+board:** add pipeline cancel — d key in cockpit, hog pipeline cancel CLI ([afe1068](https://github.com/ondrej-svec/hog/commit/afe1068b269ab2ba4943ac2aab44c8c3ef4ea61e))
* **cli:** add hog pipeline done — advance existing pipeline, don't create new one ([f06eaec](https://github.com/ondrej-svec/hog/commit/f06eaec0763669cd8daf182f84ac7c7a8c52ff58))
* **cli:** add sync/task tombstone commands with migration messages ([1132324](https://github.com/ondrej-svec/hog/commit/113232469f36ce4b2ba64304834d7e75d7a2187d))
* **cli:** pipeline transparency — notifications, log file, status command ([6a30919](https://github.com/ondrej-svec/hog/commit/6a309193ee89fc62f5e238175dc6e8359a21128a))
* **cli:** replace hog work with hog pipeline create — fire-and-forget pipelines ([aa207fc](https://github.com/ondrej-svec/hog/commit/aa207fce3c15410bf9f7a59559f1d3e393c2b14f))
* cockpit redesign — Design A with personality ([8928809](https://github.com/ondrej-svec/hog/commit/89288095254473aaea10cb902d14470d96dd6873))
* **cockpit:** add free-text decision answering via D key (Newport) ([d7f7a3f](https://github.com/ondrej-svec/hog/commit/d7f7a3fec9c58a77098e1bc6b936a355ae36f09b))
* **cockpit:** add pipeline cockpit TUI and `hog cockpit` command ([7d90508](https://github.com/ondrej-svec/hog/commit/7d905082faf36ddbeb3afac3b3a40aaa92d0ac7f))
* **cockpit:** daemon log streaming + auto-start daemon ([e5f2a4f](https://github.com/ondrej-svec/hog/commit/e5f2a4f52157390ba088a1ede7ff2e1372e9f147))
* **cockpit:** rewrite pipeline data hook as daemon client ([1b136f1](https://github.com/ondrej-svec/hog/commit/1b136f1c7ae620cca468a90fecbe2ca5721a0003))
* **cockpit:** show phase descriptions, better empty state ([7a9b37d](https://github.com/ondrej-svec/hog/commit/7a9b37df3b671f68eb6d6cedea04720e30ecda36))
* completeness gates — summary sentiment, story coverage, stub blocking, contextual retry ([2acad71](https://github.com/ondrej-svec/hog/commit/2acad71fe2f420f19d5549d14e55d8fc1046af9b))
* **config:** add v5 schema with pipeline section, v4→v5 migration ([2a8d672](https://github.com/ondrej-svec/hog/commit/2a8d672b91a88ff33ed299665ace6da71b68a8e3))
* configurable permissionMode for pipeline agents ([dca74e7](https://github.com/ondrej-svec/hog/commit/dca74e77dd5dd76963a82c43bc58d14a38017973))
* daemon logs command + better cockpit log formatting ([ec4b9f9](https://github.com/ondrej-svec/hog/commit/ec4b9f9a694ac23a535dfffd1a091b559cbaf2fe))
* **daemon:** add hog daemon start/stop/status CLI commands ([3844ee0](https://github.com/ondrej-svec/hog/commit/3844ee00b67919f1660b36b3b6d179d63dd2dba8))
* **daemon:** add hogd daemon, IPC protocol, and client ([9008827](https://github.com/ondrej-svec/hog/commit/900882726ce8abb6ea592cf1af8994c836909a88))
* **daemon:** migrate pipeline commands to daemon RPC ([79c1d0e](https://github.com/ondrej-svec/hog/commit/79c1d0e5a00d8a20bdf9375fc00e78227b53766e))
* **daemon:** migrate pipeline watch to daemon client + add tests ([6ab5de5](https://github.com/ondrej-svec/hog/commit/6ab5de5127a5b82778bea83d87a8ab5411bf15e0))
* demo mode with in-memory Beads driver + sample project ([b55e2d0](https://github.com/ondrej-svec/hog/commit/b55e2d0c51e0a56ba579d0d71a5ace4252995081))
* **engine+cli:** Beads server lifecycle — start, stop, status, auto-cleanup ([7bfd1a8](https://github.com/ondrej-svec/hog/commit/7bfd1a856281b0c5bb2ff0446a06e7a19bcf682e))
* **engine:** add Beads CLI client and GitHub-Beads sync mapping ([33c9a8f](https://github.com/ondrej-svec/hog/commit/33c9a8f843edc3976c91ae6f5d2dd670a997c01e))
* **engine:** add brainstorm phase as first DAG node in pipeline ([477af9f](https://github.com/ondrej-svec/hog/commit/477af9fb0a63d7f3a11dea8265aa2dc3ff35f218))
* **engine:** add Conductor pipeline orchestrator and hog work command ([72b8c16](https://github.com/ondrej-svec/hog/commit/72b8c164f5a458d62efe811f0d60118442f53914))
* **engine:** add TDD enforcement, quality gates, worktree manager, and Refinery ([d1e8720](https://github.com/ondrej-svec/hog/commit/d1e8720de92344c92e209a669f68d033d0a45ffc))
* **engine:** brainstorm prompt instructs Claude to use proper tools ([19a41e9](https://github.com/ondrej-svec/hog/commit/19a41e9a790b851f7e51f8635fe7ef8eb3b8c52f))
* **engine:** brainstorm uses subagents for research, keeps context clean ([81101f5](https://github.com/ondrej-svec/hog/commit/81101f5965b1868588a2de3d698e9eabea9f6931))
* **engine:** extract orchestration engine from TUI hooks ([08e161e](https://github.com/ondrej-svec/hog/commit/08e161ec6d1eda82aacde5f2309504e95345cfe4))
* **engine:** persist pipelines to disk — survive cockpit restarts ([417c1fc](https://github.com/ondrej-svec/hog/commit/417c1fc6b8be6caa87620cfb3e975dbd72656434))
* **engine:** role-specific CLAUDE.md, tmux launch args, and story-based tests ([5c70b14](https://github.com/ondrej-svec/hog/commit/5c70b14dfca3e79be0628677fbf0e08754cd22d9))
* **engine:** upgrade brainstorm prompt — structured phases, not just "discuss" ([2353f72](https://github.com/ondrej-svec/hog/commit/2353f7251bb669bfc44b4847bd9ab1b568579ed9))
* **engine:** wire conductor to refinery, add decisions command and tests ([11d15ac](https://github.com/ondrej-svec/hog/commit/11d15ac7c98579ed2c17c08f949b083245766c82))
* **engine:** zero-knowledge Dolt setup — user never needs to know about Dolt ([7d29afc](https://github.com/ondrej-svec/hog/commit/7d29afc55c1a44dfa021ed50a68fbbd511e2739f))
* enhance brainstorm to produce ADRs, requirements, and architecture — no code ([7bc8c46](https://github.com/ondrej-svec/hog/commit/7bc8c465ac84b8ffc8c2526c726620e3d4780ed7))
* enrich pipeline compare with cost, status, and bead metadata ([8c46d6e](https://github.com/ondrej-svec/hog/commit/8c46d6ea391de2d545df95e82abde9932d2a8022))
* GitHub sync bridge + --issue/--create-issue flags for pipeline create ([8cbaf41](https://github.com/ondrej-svec/hog/commit/8cbaf41815ee8612b184e17601096423b58dd860))
* give it a soul — H2G2 theming, cockpit polish, retry action ([d97051c](https://github.com/ondrej-svec/hog/commit/d97051cc46ff94abb84353ac4412ed2a1543dcc0))
* H2G2 demo narration + performance benchmarks ([6962d6a](https://github.com/ondrej-svec/hog/commit/6962d6a447f1afdf11b40a6461941bbfd06064ab))
* Heart of Gold v2.1 ([aaf452e](https://github.com/ondrej-svec/hog/commit/aaf452e94445c94b623dffe5d1a27d08b65176d1))
* **init:** pipeline-first wizard with optional GitHub, --no-github flag ([cfe219a](https://github.com/ondrej-svec/hog/commit/cfe219a64723a1a51cc807abad0b5c4f533a5798))
* model router + budget tracking (Phase 3B) ([34a6d8e](https://github.com/ondrej-svec/hog/commit/34a6d8e2d130b3101350e318da904cacdf784b91))
* pipeline context flows between stages via git diff + beads metadata ([db82f63](https://github.com/ondrej-svec/hog/commit/db82f63ce9ace7d2fd3059a5257af773ab243069))
* Pipeline v2 Phase 1 — real code prompts + auto permission mode ([4e95275](https://github.com/ondrej-svec/hog/commit/4e9527515b0c27c8541ec7e542d9e6979c8f22b5))
* Pipeline v2 Phase 2 — architecture flow + stub detection ([b1e5a2b](https://github.com/ondrej-svec/hog/commit/b1e5a2b11ff3f48ddf336ae541695f034ab2f6ed))
* Pipeline v2 Phase 3 — parallel agents for test and impl ([50f9c23](https://github.com/ondrej-svec/hog/commit/50f9c23c3c5c239bb9fe6a0f08a7a7a4ac7982f9))
* policy-as-code engine + worker adapter interface ([b381158](https://github.com/ondrej-svec/hog/commit/b381158d1085da8ab72bb5bffd6737f9972a0a35))
* resilient agent retry with clear messaging ([4b59ff2](https://github.com/ondrej-svec/hog/commit/4b59ff28279e883697294754a242a4ec9d840ccb))
* richer agent activity display in cockpit ([ceb39ad](https://github.com/ondrej-svec/hog/commit/ceb39addf7bf7566278b6a240f493249a87c5a37))
* run replay foundation (Phase 3C) ([14ab138](https://github.com/ondrej-svec/hog/commit/14ab13812630578c2953ee4508858785b82564a5))
* safeParse for config errors + biome formatting cleanup ([3d9d495](https://github.com/ondrej-svec/hog/commit/3d9d495489d54e33c0b756ece1d41410400117af))
* **safety:** add diff-audit role gate — structural file-scope enforcement ([11d7f45](https://github.com/ondrej-svec/hog/commit/11d7f45cbdb1d6e40fe6ca23078ed9169e919f74))
* self-healing conductor — auto-repair pipeline state every tick ([0479c9e](https://github.com/ondrej-svec/hog/commit/0479c9e3d38cc9e5850d529f2c29730bc3467d13))
* show phase completion summaries in cockpit log ([264958b](https://github.com/ondrej-svec/hog/commit/264958b24e33fb734992c3bbff310b1f771b100b))
* skip stories phase when brainstorm produced them + explicit file paths ([e6652af](https://github.com/ondrej-svec/hog/commit/e6652afd5f78ab0d4513c3a9a3635e4d27a5b321))
* smart GREEN verification with baseline comparison ([d74a824](https://github.com/ondrej-svec/hog/commit/d74a824fbf6f70fb24d8a32a5bcf87bc9e7ab312))
* store storiesPath + architecturePath on pipeline explicitly ([018fb07](https://github.com/ondrej-svec/hog/commit/018fb07849e617efd808fa06e2572f553bff04e0))
* **tdd:** scoped RED verification, GREEN check, redteam→impl loop ([1757ca5](https://github.com/ondrej-svec/hog/commit/1757ca5f7fa0c66068f507c8aa9721000d6eafc5))
* upgrade pipeline agent prompts with advanced prompting techniques ([0958878](https://github.com/ondrej-svec/hog/commit/0958878bbe6f16d60421d16c144d70c40d6bccad))
* wire checkTraceability + mutation testing into pipeline gates ([063c1e9](https://github.com/ondrej-svec/hog/commit/063c1e97433839b55b5f0455bc278818edd01ceb))
* wire fuel lines — WorktreeManager + Refinery in hogd ([8a4ac3c](https://github.com/ondrej-svec/hog/commit/8a4ac3cb4727046fed6224607057286d29d6427a))
* wire GitHubSync into conductor via onPhaseCompleted callback ([65bbf32](https://github.com/ondrej-svec/hog/commit/65bbf320513cdc0218f95560b119707d0a500499))


### Bug Fixes

* address all Codex review findings — C+ → A target ([e72cdb1](https://github.com/ondrej-svec/hog/commit/e72cdb191a2dbcb3adf86dba539a65e4a7998475))
* agent failure error messages + DAG phase display mismatch ([4459c07](https://github.com/ondrej-svec/hog/commit/4459c07bcc8bf894ab4929da1ba0f0d4e25bd3e0))
* agents follow architecture doc for file paths, not hardcoded paths ([594604d](https://github.com/ondrej-svec/hog/commit/594604d3fb27eae08bf53e1fcb149da29eedca15))
* bd ready default limit was hiding pipeline beads ([aecd556](https://github.com/ondrej-svec/hog/commit/aecd5561fc884178a08716e6cd5a1932305e458a))
* **board:** brainstorm phase shows clear call-to-action, not misleading "running" ([18f9479](https://github.com/ondrej-svec/hog/commit/18f947954f2bc49e6f2bb9b1e6cec36b460bf25e))
* **board:** cockpit P key creates pipeline in cwd, not first configured repo ([9e599e7](https://github.com/ondrej-svec/hog/commit/9e599e74b7fd19bd826b08556f538f8890f2d952))
* **board:** Esc key works in start pipeline overlay ([4c6eddb](https://github.com/ondrej-svec/hog/commit/4c6eddbd1e30ea7ce5f8470dc876a28b0c1b869b))
* **board:** fix start pipeline overlay and bead title truncation ([e9e32a7](https://github.com/ondrej-svec/hog/commit/e9e32a74bde36afa0f449345702b69e65863cfb3))
* **board:** isolate Pipeline View keyboard from Issues View ([d7a3f18](https://github.com/ondrej-svec/hog/commit/d7a3f1821f41520120b0255e19f50d7abd063e1f))
* **board:** l key opens log in tmux window, not less (which fights Ink) ([cf91523](https://github.com/ondrej-svec/hog/commit/cf915231940958053c864098dd77c6b88a41f792))
* **board:** narrow layout shows decisions + detail, title truncation fixed ([f649c71](https://github.com/ondrej-svec/hog/commit/f649c7169beaa4ff982acb3b95461dbe28ba8ede))
* **board:** Pipeline View is home, Tab/Esc for view switching, fix p key conflict ([8733931](https://github.com/ondrej-svec/hog/commit/8733931f3f4fc48b766062bd6d8412d04e8284bc))
* **board:** view-aware hint bar and HOG COCKPIT header ([4c249da](https://github.com/ondrej-svec/hog/commit/4c249da32902fba5cdbd1d3a82d544247d65304a))
* **board:** Z key launches brainstorm in correct directory with proper prompt ([bebfc74](https://github.com/ondrej-svec/hog/commit/bebfc7464861d8930e2293776c0670068efe97f8))
* brainstorm closes existing pipeline instead of creating new one ([6efb224](https://github.com/ondrej-svec/hog/commit/6efb2244cb65514cb819ccff15940619c6134aaa))
* **build:** remove deleted fetch-worker from tsup config ([dd336c5](https://github.com/ondrej-svec/hog/commit/dd336c5e99114061dca25a1dfc81c098ea532fa4))
* clean up empty .hog-worktrees dir on failed worktree creation ([dbe0152](https://github.com/ondrej-svec/hog/commit/dbe0152338ca6bd934be67dfc9d45e36159b0170))
* **cli:** pipeline create works from any directory, not just configured repos ([1173d8c](https://github.com/ondrej-svec/hog/commit/1173d8cd14b2293f82ba661bf2f2f629ad311fef))
* **cli:** spawn background conductor so pipelines advance through all phases ([7f2b254](https://github.com/ondrej-svec/hog/commit/7f2b254e83a10b92f41af162cabd7d2cff5a3d5d))
* cockpit startPipeline passes localPath for ad-hoc repos ([23468a8](https://github.com/ondrej-svec/hog/commit/23468a8d5772476fcec23d6e4501089bb89a8c47))
* **cockpit:** add always-visible hint bar with context-sensitive keybindings ([a636820](https://github.com/ondrej-svec/hog/commit/a6368203ea22375b715be85796525f30bc1904f7))
* **cockpit:** cancel pipeline falls back to direct file removal ([ac2e73b](https://github.com/ondrej-svec/hog/commit/ac2e73bb6e022fd42d332c79008743bf70834ead))
* **cockpit:** compact hint bar that fits on one line ([a258216](https://github.com/ondrej-svec/hog/commit/a258216dbbf673dc555cb583029c75be942cb931))
* **cockpit:** pass full ISO timestamp to log entries ([290a173](https://github.com/ondrej-svec/hog/commit/290a1737a35155a78b3d66001f0e6437726b826a))
* **cockpit:** render hint bar as single plain text line ([353d97f](https://github.com/ondrej-svec/hog/commit/353d97f2891ade126f7d8b6c9c3b4c899dcbf7f9))
* conductor tick crashed silently on ESM require() error ([4a28940](https://github.com/ondrej-svec/hog/commit/4a28940a545db63c52c50d2bc78e54aca08e70f2))
* correct skip message — stories skips to scaffold, not tests ([76b63da](https://github.com/ondrej-svec/hog/commit/76b63da669e05d400f348f225f71fbda141b6075))
* daemon ensures Dolt is running at startup + longer create timeout ([d676db0](https://github.com/ondrej-svec/hog/commit/d676db07ede56ea5577b703e1e7e59c3c7ddf845))
* daemon stop waits for process death + conductor stop guard ([f2ef15f](https://github.com/ondrej-svec/hog/commit/f2ef15f73289abd4690a7b658d6eb9f0dff52a62))
* deduplicate RED verification and traceability logs ([38c41ce](https://github.com/ondrej-svec/hog/commit/38c41ce34489e3e59f848d8be941f268a1047c67))
* emit tool detail in agent:progress events ([cf4a886](https://github.com/ondrej-svec/hog/commit/cf4a8865b044476baa4edf947e38a0180609dcf7))
* **engine+board:** brainstorm never auto-launches, add l:log key ([3becf9c](https://github.com/ondrej-svec/hog/commit/3becf9c419b0ff5dcf69ef55799082bf6613d78b))
* **engine+board:** tick saves state to disk, log display uses proper imports ([45b6c88](https://github.com/ondrej-svec/hog/commit/45b6c88c3a913a91538ceb44c9a540f8d57b353e))
* **engine:** 6 critical cockpit bugs — conductor now actually runs ([ba1802f](https://github.com/ondrej-svec/hog/commit/ba1802f6fc61ba0fe6c837bd36a32301203f3585))
* **engine:** address all critical review findings ([130634b](https://github.com/ondrej-svec/hog/commit/130634b1c76bfa4d197b41ae0a1bed6e35a53400))
* **engine:** agent spawn --verbose flag + question deduplication ([879ac5e](https://github.com/ondrej-svec/hog/commit/879ac5e4bbd6b0b2e17fd951519de35a9bbef036))
* **engine:** align Beads client with bd v0.61 CLI output format ([cc35724](https://github.com/ondrej-svec/hog/commit/cc3572424bef524186c0c4a665d055e93eaef963))
* **engine:** auto-expire stale pipelines, add hog pipeline clear ([f8a3ae0](https://github.com/ondrej-svec/hog/commit/f8a3ae058c5e8fac8f5ac9eac9b3b4e1c03f8db3))
* **engine:** auto-start Dolt server and fix UI polish ([24dfe91](https://github.com/ondrej-svec/hog/commit/24dfe91ab251cfbc1570d215b07c8f9e2742d6dc))
* **engine:** cockpit picks up pipelines created by CLI in real-time ([2d7d0f7](https://github.com/ondrej-svec/hog/commit/2d7d0f7e7d045aa63b32f36c9ff4df1016a5a40b))
* **engine:** hog pipeline clear works even with running cockpit ([6648075](https://github.com/ondrej-svec/hog/commit/6648075431347bc5c361c6ac9a5f8b2624197a1c))
* **engine:** proper error handling chain for pipeline start failures ([9c26538](https://github.com/ondrej-svec/hog/commit/9c26538938a91b2f572cc799a0a123c47d01a84a))
* **engine:** prune orphaned questions on conductor startup ([5853eb2](https://github.com/ondrej-svec/hog/commit/5853eb2881b487fd2ec56af0f664dade78e3a7da))
* **engine:** savePipelines no longer clears newly-created pipelines ([ea29259](https://github.com/ondrej-svec/hog/commit/ea2925921190ca1a1bcbbad6c30a0b8c0f80656c))
* **engine:** saveQuestionQueue skips in test environment ([099f2e8](https://github.com/ondrej-svec/hog/commit/099f2e81d6ddef4eb604d76e6770a967543195c5))
* **engine:** startPipeline no longer ticks — watcher handles advancement ([108fa05](https://github.com/ondrej-svec/hog/commit/108fa05226a5bcf84b771eb79924683dd4e9992a))
* **engine:** syncFromDisk updates existing pipelines, not just adds new ones ([6013e77](https://github.com/ondrej-svec/hog/commit/6013e772a42237002957085dc4a9849291045ac9))
* **engine:** tests no longer leak pipeline data to user's config ([f94f46a](https://github.com/ondrej-svec/hog/commit/f94f46a11bf16cc066235a0ee74fddb64d43b19c))
* hide worktree noise from activity feed, fix log file path ([d294c83](https://github.com/ondrej-svec/hog/commit/d294c83241524e6824c1c975162c4b6b87e66742))
* **init:** modernize setup wizard for pipeline-first architecture ([5a3a634](https://github.com/ondrej-svec/hog/commit/5a3a634889fc4e269a6ed1fa1a01c8fa580189f7))
* log overflow, redteam→impl loop blocking merge, display bugs ([36057d2](https://github.com/ondrej-svec/hog/commit/36057d2e996cd2f6ef7fbe76bfa2fc77822cf5cd))
* make worktree isolation opt-in (default off) ([16f7d2d](https://github.com/ondrej-svec/hog/commit/16f7d2d087661d46f0e39cad0867d158049bd35b))
* parallel agents claim bead once, not per-agent ([b2eab52](https://github.com/ondrej-svec/hog/commit/b2eab521e250a537287c1f5092e20f34f78b0f5e))
* pass full description to brainstorm session, not just title ([512b24c](https://github.com/ondrej-svec/hog/commit/512b24cbaeddd15bc28e4cf7d0b52c7b742d291b))
* persist storiesPath + architecturePath in pipeline store ([e651a89](https://github.com/ondrej-svec/hog/commit/e651a89fce549a2de4078a80bb9ea7a97afcd261))
* pipeline clear cancels via daemon before clearing file ([d7d092f](https://github.com/ondrej-svec/hog/commit/d7d092fd2ce01ad49a30719ff6f0ecb241b48a6e))
* pollLiveness only checks agents spawned by current daemon ([d424cd7](https://github.com/ondrej-svec/hog/commit/d424cd7a7efd4077182aba2c35b1072f1c485c88))
* RED/GREEN verification uses pipeline context for test command ([7a70b58](https://github.com/ondrej-svec/hog/commit/7a70b58264f7a26fbddf2261dcec8483b49ce430))
* restart daemon needed after code changes, update stale UI text ([944f778](https://github.com/ondrej-svec/hog/commit/944f778c5f0201b469fb6491100a8bc7f53c8a41))
* revert phase labels to functional names, add brainstorm UX hints ([7fb0734](https://github.com/ondrej-svec/hog/commit/7fb0734b06a7a45ee1c6232434dda2f9c017a8e0))
* skip stories phase when brainstorm produced them + explicit file paths ([02d93e7](https://github.com/ondrej-svec/hog/commit/02d93e7a0c5144ddb2c04556da3945bb86eeb337))
* support ad-hoc repos in daemon pipeline.create ([8e55843](https://github.com/ondrej-svec/hog/commit/8e5584307d6e47e43a1520fbcbfd1a5485416c23))
* **tests:** fix 6 conductor tests — add tick() after startPipeline ([eb559b7](https://github.com/ondrej-svec/hog/commit/eb559b74b64dca67ca3a6cf29cbd0d0fc09e2a87))

## [2.0.0](https://github.com/ondrej-svec/hog/compare/hog-v1.25.1...hog-v2.0.0) (2026-03-26)

### BREAKING CHANGES

* **pivot:** hog is now a pipeline orchestrator, not a GitHub Issues dashboard
* **board removed:** `hog board --live` replaced by `hog cockpit`
* **commands removed:** `pick`, `issue *`, `task *`, `sync *` — all print migration messages
* **config v5:** new `pipeline` section; auto-migrates from v4

### Features

* **cockpit:** pipeline-focused TUI with real-time progress, decision answering, agent monitoring
* **pipeline:** 6-phase TDD-enforced development pipeline (brainstorm → stories → tests → impl → redteam → merge)
* **github-sync:** optional push-only sync — pipeline phases update GitHub issue labels/status
* **pipeline create --issue:** link pipeline to existing GitHub issue
* **pipeline create --create-issue:** create GitHub issue and link it
* **init --no-github:** pipeline-only setup, no GitHub required
* **config v5:** `pipeline` section with owner, maxConcurrentAgents, tddEnforcement, phases, qualityGates

### Migration

See [MIGRATION.md](./MIGRATION.md) for a complete guide.

## [1.25.1](https://github.com/ondrej-svec/hog/compare/hog-v1.25.0...hog-v1.25.1) (2026-03-15)


### Bug Fixes

* **board:** filter project enrichment by repo to prevent cross-repo status collisions ([#71](https://github.com/ondrej-svec/hog/issues/71)) ([c31b1e0](https://github.com/ondrej-svec/hog/commit/c31b1e0f7e4edb0712e1f700c27bcc0251753412))

## [1.25.0](https://github.com/ondrej-svec/hog/compare/hog-v1.24.3...hog-v1.25.0) (2026-03-15)


### Features

* **board:** add field:value search syntax for project fields ([#69](https://github.com/ondrej-svec/hog/issues/69)) ([e88a0ed](https://github.com/ondrej-svec/hog/commit/e88a0ed8cb439a310367ed50a0980ee3e4bed247))

## [1.24.3](https://github.com/ondrej-svec/hog/compare/hog-v1.24.2...hog-v1.24.3) (2026-03-08)


### Bug Fixes

* **board:** tighten stacked layout — smaller top row, exact widths ([2a9cf79](https://github.com/ondrej-svec/hog/commit/2a9cf7958daf37cdaa7868b9862509444f1efc76))

## [1.24.2](https://github.com/ondrej-svec/hog/compare/hog-v1.24.1...hog-v1.24.2) (2026-03-08)


### Bug Fixes

* **board:** repos and statuses side-by-side in stacked layout ([3f2719b](https://github.com/ondrej-svec/hog/commit/3f2719bba58735819ffbc0ae3cf273f9b4b4ffdf))
* **board:** repos and statuses side-by-side in stacked layout ([ac78e71](https://github.com/ondrej-svec/hog/commit/ac78e71b8c58a91c2f9ac7c1288b5130daca112b))

## [1.24.1](https://github.com/ondrej-svec/hog/compare/hog-v1.24.0...hog-v1.24.1) (2026-03-08)


### Bug Fixes

* **board:** constrain root viewport to terminal height ([0dd7131](https://github.com/ondrej-svec/hog/commit/0dd7131a1e02b175b20dd159b14d9390a30f8fa2))
* **board:** constrain root viewport to terminal height ([a79798a](https://github.com/ondrej-svec/hog/commit/a79798a47e6de1cf4a8639b16f819c40d2cd6d0d))

## [1.24.0](https://github.com/ondrej-svec/hog/compare/hog-v1.23.1...hog-v1.24.0) (2026-03-08)


### Features

* **board:** responsive viewport scrolling with page navigation ([cd5cd2d](https://github.com/ondrej-svec/hog/commit/cd5cd2d4145f30e6fb0f053b36e29b5472e6f822))
* **board:** responsive viewport scrolling with page navigation ([1703b14](https://github.com/ondrej-svec/hog/commit/1703b14ed66a58d1597542efe0ec768105ec6ce8))

## [1.23.1](https://github.com/ondrej-svec/hog/compare/hog-v1.23.0...hog-v1.23.1) (2026-03-08)


### Bug Fixes

* **board:** allow search and fuzzy picker from zen mode ([aa3061a](https://github.com/ondrej-svec/hog/commit/aa3061aac935d6559a35aec60b1bef12bc70fc48))

## [1.23.0](https://github.com/ondrej-svec/hog/compare/hog-v1.22.1...hog-v1.23.0) (2026-03-08)


### Features

* **board:** redesign zen mode — show DetailPanel when no agent, allow search/filter ([cd05dc4](https://github.com/ondrej-svec/hog/commit/cd05dc4c3c2d84e8ddb61d5a10443b341269b9fb))

## [1.22.1](https://github.com/ondrej-svec/hog/compare/hog-v1.22.0...hog-v1.22.1) (2026-03-07)


### Bug Fixes

* **board:** keep zen info pane alive with read after printf ([c7a475a](https://github.com/ondrej-svec/hog/commit/c7a475a5d328ba9c6e6e575fba62501ad5abeae8))

## [1.22.0](https://github.com/ondrej-svec/hog/compare/hog-v1.21.1...hog-v1.22.0) (2026-03-07)


### Features

* **board:** Zen Mode & Collapsible Left Panel ([#55](https://github.com/ondrej-svec/hog/issues/55)) ([a43e5af](https://github.com/ondrej-svec/hog/commit/a43e5afa96677963051f7ef99ff9f2a985b580c4))

## [1.21.1](https://github.com/ondrej-svec/hog/compare/hog-v1.21.0...hog-v1.21.1) (2026-03-03)


### Bug Fixes

* **board:** restore issues panel top border and suppress gh stderr ([59668cb](https://github.com/ondrej-svec/hog/commit/59668cbc187a7ff487b93658bb7f08f67c366774))
* **board:** suppress gh stderr in fetchRecentActivity ([006abb3](https://github.com/ondrej-svec/hog/commit/006abb34ca51c99350d326ae6d6e5990b07b1815))

## [1.21.0](https://github.com/ondrej-svec/hog/compare/hog-v1.20.0...hog-v1.21.0) (2026-03-02)


### Features

* **agents:** add background agent spawner, session hook, and activity panel ([79f0a41](https://github.com/ondrej-svec/hog/commit/79f0a418e42a5ac671adce1aaa05069a14a18c7f))
* **agents:** wire background agent launch into dashboard ([229f360](https://github.com/ondrej-svec/hog/commit/229f360a21d6e5e616e0ba1aedc36eb907ba78d0))
* **auto-status:** add useAutoStatus hook with event matching ([93697ee](https://github.com/ondrej-svec/hog/commit/93697eef8babbd0263463fbca9044500543f51fa))
* **auto-status:** wire useAutoStatus hook and enrich issue rows ([c7332bd](https://github.com/ondrej-svec/hog/commit/c7332bd90f43687252b8a111dd101c4689eb405d))
* **board:** add phase indicator and age suffix to issue rows ([edd114c](https://github.com/ondrej-svec/hog/commit/edd114c7df5cf3ce20396af51f6c473641fa124d))
* **cli:** add workflow:show, workflow:export, workflow:import subcommands ([6a3a6ca](https://github.com/ondrej-svec/hog/commit/6a3a6cadf8c7147b4bc363f496b779220982913e))
* **enrichment:** add enrichment state module and extend prompt templates ([500263c](https://github.com/ondrej-svec/hog/commit/500263cf7eb475883f1ae0cc494f0740a5b2c5f5))
* **events:** add branch/PR event parsing to fetchRecentActivity ([26e17f2](https://github.com/ondrej-svec/hog/commit/26e17f2fabebbae96d101b2868274c17d4637bde))
* **init:** add auto-status configuration to setup wizard ([0dce15c](https://github.com/ondrej-svec/hog/commit/0dce15cbe063baeb3bd42fecb86699ef8de12419))
* **init:** add workflow template selection to setup wizard ([9c1562e](https://github.com/ondrej-svec/hog/commit/9c1562e85530cf9ad5e5a62e35078a6d67aa5494))
* **notify:** add OS notification and sound support for agent completion ([80b9c2f](https://github.com/ondrej-svec/hog/commit/80b9c2f65f259e09fadee27caf81c44dc6e770ad))
* **nudges:** add nudge system, triage overlay, and completion check ([df5b192](https://github.com/ondrej-svec/hog/commit/df5b192ced4d1147537ce9d55c3cfe4a9cd1cf99))
* **templates:** add workflow template export/import/validate module ([933ca57](https://github.com/ondrej-svec/hog/commit/933ca5780b1cd0cfb15e0151681974da6fd709c7))
* Workflow Conductor — remove TickTick, add workflow orchestration system ([1290e1f](https://github.com/ondrej-svec/hog/commit/1290e1f6ff44fc908495ec89176fa705f9aa0b93))
* **workflow:** add hog workflow status CLI subcommand ([badb05e](https://github.com/ondrej-svec/hog/commit/badb05e3b722c5f991e38b621c31555b209967c5))
* **workflow:** add workflow overlay, UI state, and workflow hook ([d355353](https://github.com/ondrej-svec/hog/commit/d355353a30a69d514e7937abd411acf3e13b3aa6))
* **workflow:** wire workflow overlay into dashboard, keyboard, and help ([87663e3](https://github.com/ondrej-svec/hog/commit/87663e3c378ed5c0ba9d8f933524f892fbb2a10d))


### Bug Fixes

* **github:** support user-owned GitHub Projects in GraphQL queries ([f8e3b19](https://github.com/ondrej-svec/hog/commit/f8e3b19c81543b905ad13ed9d06d151a00f8da4d))
* resolve 22 code review findings (security, performance, quality) ([13a13f4](https://github.com/ondrej-svec/hog/commit/13a13f44834090315132af3f5837403788d2eae0))

## [1.20.0](https://github.com/ondrej-svec/hog/compare/hog-v1.19.0...hog-v1.20.0) (2026-02-28)


### Features

* **cli:** add errorOut, issue close/reopen, fix JSON mode contamination ([8bec058](https://github.com/ondrej-svec/hog/commit/8bec0584a653e1c5e7a43d679dac21499e915fd0))


### Bug Fixes

* repair test failures from quality sweep refactors ([7cfe505](https://github.com/ondrej-svec/hog/commit/7cfe505bf508dd94adea2b5012d6fa9d697c1ad2))

## [1.19.0](https://github.com/ondrej-svec/hog/compare/hog-v1.18.0...hog-v1.19.0) (2026-02-26)


### Features

* **board:** add configurable claudePrompt template for Claude launch ([8c21400](https://github.com/ondrej-svec/hog/commit/8c2140073833d31e9c8c2182901183558ce0617b))

## [1.18.0](https://github.com/ondrej-svec/hog/compare/hog-v1.17.0...hog-v1.18.0) (2026-02-26)


### Features

* **board:** Enter opens detail panel, g opens issue in browser ([fe8590a](https://github.com/ondrej-svec/hog/commit/fe8590a69fbb94d29fe7c5865072f06e7dee902e))

## [1.17.0](https://github.com/ondrej-svec/hog/compare/hog-v1.16.2...hog-v1.17.0) (2026-02-24)


### Features

* **board:** launch Claude Code from issue with C shortcut ([#45](https://github.com/ondrej-svec/hog/issues/45)) ([12bfcd8](https://github.com/ondrej-svec/hog/commit/12bfcd834d17d30ea39c5ecc5671fc9592027615))

## [1.16.2](https://github.com/ondrej-svec/hog/compare/hog-v1.16.1...hog-v1.16.2) (2026-02-24)


### Bug Fixes

* **board:** allow e/c transitions from overlay:detail in state machine ([fcbd10d](https://github.com/ondrej-svec/hog/commit/fcbd10d1376c7d2c0a45937532272c5e85804950))

## [1.16.1](https://github.com/ondrej-svec/hog/compare/hog-v1.16.0...hog-v1.16.1) (2026-02-23)


### Bug Fixes

* **board:** y/o/c/e shortcuts work from detail overlay (0 key) ([7d615c9](https://github.com/ondrej-svec/hog/commit/7d615c94cbe5fe45a46cb816b8b7848c79139c58))

## [1.16.0](https://github.com/ondrej-svec/hog/compare/hog-v1.15.0...hog-v1.16.0) (2026-02-23)


### Features

* **config:** guided interactive wizard for repos:add ([49e4379](https://github.com/ondrej-svec/hog/commit/49e4379fb4c848561de5f49ff651745338828221))

## [1.15.0](https://github.com/ondrej-svec/hog/compare/hog-v1.14.1...hog-v1.15.0) (2026-02-23)


### Features

* **board:** fetch all GitHub Project custom fields and make them searchable ([f87cdb5](https://github.com/ondrej-svec/hog/commit/f87cdb59a2be0a1fd6ba07ad3bd6d364666e2af6))
* **board:** smart multi-field search (labels, status, assignee, #num) ([ef93b37](https://github.com/ondrej-svec/hog/commit/ef93b372658fadf6abbbd4bb1d4826256752bbc5))

## [1.14.1](https://github.com/ondrej-svec/hog/compare/hog-v1.14.0...hog-v1.14.1) (2026-02-23)


### Bug Fixes

* **board:** detail overlay Esc handling and correct width/height ([2f3b231](https://github.com/ondrej-svec/hog/commit/2f3b231ec2a902ae48ffc28beed5b3a711bdd662))

## [1.14.0](https://github.com/ondrej-svec/hog/compare/hog-v1.13.0...hog-v1.14.0) (2026-02-23)


### Features

* **board:** detail panel overlay for narrow terminals (press 0) ([6fa4735](https://github.com/ondrej-svec/hog/commit/6fa4735efb4fabbc643236403cffe27da3da6322))

## [1.13.0](https://github.com/ondrej-svec/hog/compare/hog-v1.12.0...hog-v1.13.0) (2026-02-22)


### Features

* **board:** width-aware single-line issue rows with compact labels ([6a7efd5](https://github.com/ondrej-svec/hog/commit/6a7efd5621b7e86323e67b1d9dbada475b375a10))
* **board:** width-aware single-line issue rows with compact labels ([f578562](https://github.com/ondrej-svec/hog/commit/f5785625669ac1bfbc3ffe725763fa85b60c3c10))

## [1.12.0](https://github.com/ondrej-svec/hog/compare/hog-v1.11.0...hog-v1.12.0) (2026-02-22)


### Features

* **board:** lazygit-style title-in-border panels ([#31](https://github.com/ondrej-svec/hog/issues/31)) ([2b18034](https://github.com/ondrej-svec/hog/commit/2b180340e581ba7cafa4a68ebbb27d5b2367658d))

## [1.11.0](https://github.com/ondrej-svec/hog/compare/hog-v1.10.0...hog-v1.11.0) (2026-02-22)


### Features

* **board:** lazygit-style 5-panel layout ([#29](https://github.com/ondrej-svec/hog/issues/29)) ([ec4b431](https://github.com/ondrej-svec/hog/commit/ec4b43186c2d64427c88dee4c9f971b2f485f4fa))

## [1.10.0](https://github.com/ondrej-svec/hog/compare/hog-v1.9.3...hog-v1.10.0) (2026-02-22)


### Features

* **board:** add status sub-tab two-level navigation ([dc941b2](https://github.com/ondrej-svec/hog/commit/dc941b2a5803e12434df97f5350a14e66f272a24))
* **board:** status sub-tab two-level navigation ([bdef112](https://github.com/ondrej-svec/hog/commit/bdef112cade2ff688ab3ac8bebb6b5237d6322c4))

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
