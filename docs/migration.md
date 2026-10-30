# OpenCode V2 Migration

This document records the V2 migration implemented on `feature/opencode-v2-migration`.
The `master` branch remains the OpenCode V1 implementation. The V2 build targets
`2.1.4` and does not include V1 adapters. The `3.0.0-alpha.1` candidate is
pre-release; remaining validation is tracked below.

## Inventory

| Capability | Decision | Evidence and remaining work |
| --- | --- | --- |
| TUI entry, sidebar, theme | PORT | Built plugin loaded in isolated real V2 TUI; sidebar and direct child visible |
| Core exports and packaging | PORT | `@opencode/plugin` and `@opencode/client` `2.1.4`; build/export tests pass |
| Observer options and environment | PORT | V2 options/env precedence and bounds covered by tests |
| Session snapshots and events | PORT | V2 records decoded; pagination, isolation and event fixtures pass |
| Registry and safety projection | PORT | Existing bounds/redaction retained; late old refresh regression covered |
| Akane state and location | PARTIAL | State v1 fixture works in real V2 TUI; migrated Akane binary not available in this test |
| Agent colors and categories | PORT | V2 location-scoped data and safe title-category path implemented |
| Public reasoning summary | PARTIAL | V2 `2.1.4` has no verified public summary field; raw reasoning is excluded |
| Cleanup and reconnection | PORT | Idempotent cleanup, V2 listener and five-second coalesced refresh tests pass |
| Server hooks, credentials, providers, LSP, tools, RPC, MCP | N/A | Observer neither owns nor invokes these capabilities |
| Compaction execution | N/A | Observer does not execute compaction; event decoding remains in scope |

## Remaining work — alpha follow-up

These items are intentionally deferred from the alpha package. They must be
completed before claiming full Akane interoperability or complete host UX
acceptance.

- [ ] **Verify the migrated Akane V2 package in the same OpenCode `2.1.4` host.**
  Confirm it writes schema version `1` state for the selected session/project;
  exercise missing, disabled, malformed, stale, future-dated, recovery, and
  cross-location cases. A synthetic state fixture does not satisfy this item.
- [ ] **Exercise live child activity in OpenCode `2.1.4`.** Create a child using
  the host UI, observe start/tool/retry/success/failure updates, then switch and
  move the parent session and unload the plugin. Confirm no stale child or
  previous-location watchdog state remains.
- [ ] **Complete formal TUI visual QA.** Capture the current build through a
  real xterm.js browser terminal, run the terminal width/border checks, and
  obtain an independent visual review. The current checkout has no
  `script/qa/web-terminal-visual-qa.mjs`; the runtime smoke test below is not a
  substitute for this evidence.

## Evidence

- Alpha release: [`v3.0.0-alpha.1`](https://github.com/yohi/sibyl/releases/tag/v3.0.0-alpha.1); package `@yohi/sibyl@3.0.0-alpha.1` published to GitHub Packages with the `alpha` dist-tag. Commit: `2c81d141e9fed59e54ce950ea26fb53190cb9308`. Bun publish shasum: `318763df12e73ae71b4a2f78a3b5370adeb4e6ff`.
- Published `@opencode/plugin` and `@opencode/client` artifacts: `2.1.4`.
- npm integrity: `@opencode/plugin@2.1.4` `sha512-SGAkdGp0VRxos2BEkRiyRl75G7DtuvP0ywgiEiHz1PbdUwUe2EAURMrzFgLCYCpWEm/zaNrguxPDVL0carrCsA==`; `@opencode/client@2.1.4` `sha512-xNHP8Xu4wcq4G849Xnbb8IxYxMTzF0TqvohWVUQZH5aURrVHIIbHMfXbZY6s4i4C9kpVbwjXFFwWAo6KIK3oiw==`; Linux x64 CLI `@opencode/cli-linux-x64@2.1.4` `sha512-o8EJ0ZsT4dzDKN+0mpG2EKbNGzJyp+F1++Av28UReRVfiEv+N34eZEnN/unkiMoerKHad6W6Ii7k4ukTnPNmNQ==`.
- Local development host before migration: OpenCode `1.19.0`.
- OpenTUI development artifacts: `0.6.8`; Solid: `1.9.12`.
- V2 installation uses `opencode.json` for Akane's server plugin and global
  `cli.json` for Sibyl's TUI plugin/options. These config surfaces are distinct.
- Isolated OpenCode host: platform package `@opencode/cli-linux-x64@2.1.4`, reports `opencode v2.1.4`.
- Host test used temporary XDG/HOME config, a local plugin directory that re-exported the built TUI entry, and synthetic parent/child sessions. The built TUI module loaded; watchdog, direct-child card, and `[quick]` title category rendered. Child assistant/tool live execution was not exercised in the host.
- Final alpha verification: 191 unit tests and 15 browser/OpenTUI tests passed; `lint`, `typecheck`, `build`, and package dry-run completed. Biome reports 12 informational `useLiteralKeys` diagnostics in the category parser.
- Formal xterm.js screenshot and independent visual-oracle review: NOT RUN. This repository has no web-terminal visual QA harness and the current harness exposes no oracle reviewer tool; runtime layout was inspected in the isolated V2 terminal.
- Combined runtime with the parallel Akane V2 migration remains NOT RUN; synthetic version-1 state is not Akane integration evidence.
- Reasoning summary is unavailable from the verified V2.1.4 public message schema. No raw reasoning is projected.
