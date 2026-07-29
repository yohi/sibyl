# Task 10 Report

## Status

BLOCKED

実装とコミットは完了しましたが、指定された PTY テストは Bun 1.3.14 が `node-pty` のネイティブモジュール読み込み時に `uv_version_string` 非対応でクラッシュしたため、成功を確認できませんでした。

## Changes

- `src/pane.tsx`
  - `useTerminalDimensions` と `createEffect` を追加。
  - 端末サイズを `Math.floor` で整数化し、列・行が正の場合だけ `ptyHandle.resize(cols, rows)` を呼び出すよう同期処理を追加。
- `tests/pty-manager.test.ts`
  - `resize(0, 0)` が例外を投げない契約テストを追加。
- `src/layout-manager.tsx` と `src/pty-manager.ts`
  - 追加変更なし。既存の PTY resize ガードで要件を満たしていることを確認。

## Commit

- `599884d feat: ペインリサイズをPTYサイズと同期`

## Verification

- `bun test tests/pty-manager.test.ts`: BLOCKED。`node-pty/build/Release/pty.node` 読み込み時に Bun が `unsupported uv function: uv_version_string` でクラッシュ。
- `bunx tsc --noEmit`: PASS（出力なし、終了コード 0）。
- `bun run build`: PASS（終了コード 0）。Rollup の既存の empty chunk 警告あり。
- TypeScript no-excuse audit: BLOCKED。参照スクリプト `scripts/typescript/check-no-excuse-rules.ts` がリポジトリ内に存在しない。
- LSP diagnostics: タイムアウトにより結果取得不可。

## Concerns

- Bun と現在の `node-pty` ネイティブモジュールの互換性問題により、実行時 PTY テストの再確認が必要です。
- `.omo/` の未追跡ファイルは今回のコミットに含めていません。

## Task 10 Fix Report

### Status

DONE

### Changes

- `tests/pty-manager.test.ts` の `resize validates dimensions` を実シェルから fake `node-pty` adapter に置換。
- `PtyManager` の `loadNodePty` に fake module を注入し、`pty.resize(0, 0)` が例外を投げず、fake terminal の `resize` が呼ばれないことを検証。
- Node-only の実 `node-pty` shell test は既存の `process.versions.bun` ガードを維持。
- 本修正は production code を変更していません。

### Commits

- `e4fe09a test: リサイズ契約テストをfake PTYアダプター化`

### Verification

- `bun test tests/pty-manager.test.ts`: PASS（2 tests, 0 failures, 7 expectations）。
- `bunx tsc --noEmit`: PASS（終了コード 0、出力なし）。
- `bun run build`: PASS（終了コード 0）。Rollup の既存 `index` empty chunk 警告あり。
- LSP diagnostics: 3 秒の待機時間内に fresh diagnostics を取得できずタイムアウト。

### Concerns

- `.omo/` の未追跡ファイルは今回のコミットに含めていません。
- 既存の Node-only 実シェルテストは Bun 実行時にガードされ、Node 環境でのみ実行されます。
