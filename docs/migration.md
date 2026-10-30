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
| Akane state and location | PORT | Akane alpha.2 producer contract passes against Sibyl alpha.1 reader; combined host scenario is recorded by Akane |
| Agent colors and categories | PORT | V2 location-scoped data and safe title-category path implemented |
| Public reasoning summary | PARTIAL | V2 `2.1.4` has no verified public summary field; raw reasoning is excluded |
| Cleanup and reconnection | PORT | Idempotent cleanup, V2 listener and five-second coalesced refresh tests pass |
| Server hooks, credentials, providers, LSP, tools, RPC, MCP | N/A | Observer neither owns nor invokes these capabilities |
| Compaction execution | N/A | Observer does not execute compaction; event decoding remains in scope |

## Remaining work — alpha follow-up

These items are intentionally deferred from the alpha package. They must be
completed before claiming full Akane interoperability or complete host UX
acceptance.

- [x] **Verify the migrated Akane V2 package in the same OpenCode `2.1.4` host.**
  Confirm it writes schema version `1` state for the selected session/project;
  exercise missing, disabled, malformed, stale, future-dated, recovery, and
  cross-location cases. The producer/consumer contract test and combined-host
  results are recorded in Akane's [V2 verification record][akane-v2-verification].
- [ ] **Complete live child-event host coverage.** The combined-host record
  confirms a `BUSY` direct child and parent switching; Sibyl unit tests cover
  V2 start/tool/retry/success/failure normalization. Still verify those live
  event transitions, parent move, and plugin unload together in an OpenCode
  `2.1.4` host.
- [x] **Complete formal TUI visual QA.** Akane's [V2 verification record][akane-v2-verification]
  documents three real xterm.js captures (960x800 RGB PNG; terminal checks at
  42x120) and two independent visual reviews with PASS. The captures remain in
  Akane's isolated QA workspace rather than this repository.

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
- Formal xterm.js screenshot and independent visual-oracle evidence is maintained in the linked Akane verification record; screenshot files are not mirrored into this repository.
- Akane alpha.2 producer/consumer integration: `tests/integration/opencode-v2-sibyl.test.ts` passed (1 test, 12 assertions) using Sibyl revision `2c81d141e9fed59e54ce950ea26fb53190cb9308` and the published Akane alpha.2 checkout.
- Combined-host, live visual, and width/border results for the documented scenario are recorded in Akane's verification record. Its alpha.2 package repackages the alpha.1 runtime unchanged; the combined-host run used alpha.1 artifacts.
- Reasoning summary is unavailable from the verified V2.1.4 public message schema. No raw reasoning is projected.

[akane-v2-verification]: https://github.com/yohi/akane/blob/v3.0.0-alpha.2/docs/opencode-v2-verification.md
