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
