# Task Polish Report

## Status

DONE

## Commits

- `daa7da0` — `build: npmパッケージ収録対象を明示`
- `8398d02` — `feat: 公開APIをエントリーポイントから再公開`
- `35b7691` — `fix: PTY準備後のペインサイズ同期を修正`
- `165aa3a` — `fix: BunでのPTYアダプター未指定クラッシュを防止`

## Verification output

- `bun run lint`: 成功。Biome が24ファイルを検査し、修正不要。
- `bun run typecheck`: 成功。TypeScriptエラーなし。
- `bun run build`: 成功。`dist/index.js`、`dist/server.js`、`dist/tui.js`を生成。
- `bun test`: 成功。29 tests passed、0 failed、73 expect calls。
- `npm pack --dry-run --json`: 成功。`dist/index.js`、`dist/server.js`、`dist/tui.js`を含む29ファイルを確認。
- `git diff --check HEAD~4..HEAD`: 成功。空白エラーなし。

## Concerns

- Bun実行時は `loadBunPtyAdapter` 未指定の場合に明示的なエラーを投げるため、Bun用アダプターが提供されるまで node-pty の自動ロードは行われません。
- レポート作成時点で作業ツリーはクリーンです。

## Critical issue fix (2026-07-29)

### Status

DONE

### Commits

- `cceb465` — `fix: サーバー安全な公開APIに限定`

### Verification output

- `bun run build`: 成功。`dist/index.js`、`dist/server.js`、`dist/tui.js`を生成。
- `node -e 'import("./dist/index.js")'`: 成功。`window is not defined` は発生せず、コア公開APIのみを確認。
- `bun run lint && bun run typecheck && bun test`: 成功。Biomeは25ファイルを検査、TypeScriptエラーなし、30 tests passed、0 failed、74 expect calls。
- `npm pack --dry-run --json`: 成功。パッケージ収録対象に `dist/index.js`（9,984 bytes）が含まれることを確認。
- `GIT_MASTER=1 git diff --check`: 成功。空白エラーなし。

### Concerns

- LSP診断は2ファイルとも3秒の待機時間超過となったが、`bun run typecheck` は成功している。

## Test entrypoint regression coverage (2026-07-29)

### Status

DONE

### Commits

- `fix: ビルド済みサーバー安全エントリーポイントを回帰テスト`

### Verification output

- `bun run build`: 成功。`dist/index.js`、`dist/server.js`、`dist/tui.js`を生成。
- `bun test tests/index.test.ts`: 成功。1 test passed、0 failed、1 expect call。
- `bun run lint && bun run typecheck`: 成功。Biomeは25ファイルを検査し、TypeScriptエラーなし。

### Concerns

- `PaneBackend` は型専用 export のため、ランタイムの `dist/index.js` export 一覧には含まれません。テストでは実行時に存在する `OpenTuiPaneBackend` とその他のコア export を検証しています。
