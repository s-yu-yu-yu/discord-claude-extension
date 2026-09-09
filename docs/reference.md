# 設定リファレンス

`bridge/config.json` の全キーと、Bridge・拡張の内部動作をまとめた技術資料です。導入手順は [導入ガイド](setup.md)、日常の操作は [使い方](usage.md) を参照してください。

## 構成

```text
Discord Web (content script)
  -> Chrome extension service worker (HTTP + SSE)
  -> Claude Bridge (Node HTTP)
  -> claude CLI (stream-json + partial messages)
  -> Chrome Side Panel
```

Bridge は設定された `workspace` を cwd として `claude -p --output-format stream-json --verbose --include-partial-messages`（prompt は標準入力）を起動し、Claude Code の既存の permission 設定をそのまま利用します。Bridge に認証はありません。社内配布では `host: "127.0.0.1"` を維持し、各自の PC で起動してください。

## config.json のキー

```json
{
  "host": "127.0.0.1",
  "port": 3456,
  "workspace": "/Users/me/claude-discord-workspace",
  "projectRoots": [{ "path": "/Users/me/src", "depth": 2 }],
  "projectDepth": 2,
  "actions": [
    { "id": "research", "label": "調査", "prompt": "この内容について必要な調査を行ってください。" }
  ]
}
```

| キー | 既定 | 説明 |
| --- | --- | --- |
| `host` / `port` | `127.0.0.1` / `3456` | Bridge の待ち受け先。拡張の Bridge URL と合わせる |
| `workspace` | `~/claude-discord-workspace` | General Workspace。Project を選ばない General Session の cwd |
| `projectRoots` | `[]` | `{ path, depth }` の配列。各 `path` を `depth` 階層まで走査し、`.git` を含むディレクトリを Project として拡張へ公開する。root 自体が Git リポジトリならその root が Project |
| `projectDepth` | `2` | `projectRoots[].depth` 省略時の走査深さ |
| `actions` | Bridge 既定 | Action Preset の配列 `{ id, label, prompt }`。省略時は `jira` Jiraに起票、`github-issue` GitHub Issue化、`summarize` 要約、`research` 調査、`critique` 批評、`freeform` 自由入力。「自由入力」も Bridge から配信される preset で、拡張側に固定の preset はない |
| `claudeCommand` | `claude` | CLI の実行ファイル。Windows ネイティブは `claude.exe` の絶対パス、WSL2 は Linux 版のパス |
| `claudeModel` / `claudeEffort` | `opus` / `high` | CLI の `--model` / `--effort` にそのまま渡す。`""` でフラグを付けず CLI 既定に従う |
| `permissionMode` | example は `default`、省略時は `auto` | CLI の `--permission-mode`。`""` でフラグを付けない。詳細は次節 |
| `terminalCommand` | `auto` | 「ターミナルで開く」に使う端末。macOS は Terminal.app、Windows は Windows PowerShell、WSL2 は Windows 端末から同じディストリビューション・Linux ユーザーで再開。`""` で起動を無効化しコピーのみ。カスタム文字列では `{command}` が再開コマンドに置換され、macOS は sh、Windows は PowerShell で実行 |
| `attachmentsDir` | OS 一時ディレクトリ配下の `claude-bridge-attachments` | Discord 添付のダウンロード先。Claude Session ごとにサブディレクトリを作り `--add-dir` で Claude Code へ渡す |
| `attachmentMaxBytes` | `20971520`（20 MB） | これを超える添付はダウンロードせず metadata と URL のみ渡す |
| `claudeConfigDir` | 未設定 | 独自の Claude 設定ルートを使う場合のみ指定。CLI の `CLAUDE_CONFIG_DIR` とセッション JSONL の参照先へ同時に適用。通常は未設定で、現在の `CLAUDE_CONFIG_DIR`（未設定なら `~/.claude`）を使う |

## 非対話モードのツール許可（MCP / gh など）

Bridge は `claude -p`（非対話）で起動するため許可ダイアログを出せません。`permissionMode` が `default` や `""` の場合、事前に許可されていないツールは自動で拒否され、回答に「権限が許可されていない」と出ます。General Workspace の `.claude/settings.json` に許可ルールを置いてください。

```json
{
  "permissions": {
    "allow": ["mcp__claude_ai_Atlassian", "Bash(gh issue create:*)", "WebSearch", "WebFetch"]
  }
}
```

`mcp__<server名>` でそのサーバーの全ツール、`mcp__<server名>__<tool名>` で個別ツールを許可できます。Project Session で使う場合は各リポジトリの `.claude/settings.json` に同様のルールが必要です。許可ルールは MCP サーバーの接続そのものは追加しません。Jira など MCP を使う場合は、対話版 Claude Code で先に接続してください。`auto` を使う場合は CLI・モデル・組織の管理設定が対応している必要があります。[公式の権限設定](https://code.claude.com/docs/en/permissions) も参照してください。

## 添付ファイル

Message Context に含まれる Discord の添付は、ファイル名・URL・MIME type・サイズを prompt に記載します。画像、PDF、テキスト、ソースコード、JSON、CSV、ログなどは Bridge が `attachmentsDir` へダウンロードし、`--add-dir` で Claude Code から読めるようにします。`attachmentMaxBytes` 超過、動画・音声、種類を判別できないファイルは metadata と URL のみです。ダウンロードの失敗は Side Panel に tool 行として表示され、残りの Message Context はそのまま送信されます。ダウンロード済みファイルは Bridge が起動時と 1 時間ごとに確認し、24 時間を過ぎたものを削除します。DOM から得た添付は MIME type とサイズが空になり、page world の message cache が見つかった場合にそれらで補完します。

## セッションの保存と再開

Side Panel のセッション一覧は Chrome の `storage.local` に保存した索引を、起動時に Bridge と照合します。Bridge は Claude Code の設定ルート（通常 `~/.claude`、`CLAUDE_CONFIG_DIR` または `claudeConfigDir` 指定時はそのルート）配下の `projects/<cwdの非英数字をハイフンに置換>/<session-id>.jsonl` を実在性の根拠にします。これは CLI の内部保存形式への依存です。

初回 turn では Claude に `[DCE_SESSION_TITLE]短いタイトル[/DCE_SESSION_TITLE]` マーカーを回答冒頭へ出すよう依頼し、Bridge がマーカーを除去してタイトルとして一覧へ保存します。

Handoff は元セッションを `claude --resume <id> --fork-session` で fork し、調査結果・決定事項・Source Link・関連リンク（Jira / GitHub）・現在判明している問題・次に実行すべき作業を見出しにした引き継ぎを生成します。元の General Session は変更されません。Handoff の内容は Claude の要約であり、Bridge は検証しません。

「ターミナルで開く」は Bridge と Chrome が同一マシン（loopback 接続）のときだけ表示されます。別マシンなら「resume コマンドをコピー」で `cd "<cwd>" && claude --resume <id>` をコピーして Bridge のマシンで実行します。Bridge は起動したターミナルの状態を追跡しません。

## Message Context の選択ルール

- 返信メッセージでは、親方向の root から Source Message の子孫までを自動選択します。祖先の兄弟分岐は含めません。非 reply は Source Message 1 件のみです。
- 送信前に message 単位の ON/OFF、前後 5 件の追加ができ、20 件以上は warning を表示します。候補はまず DOM、次に page world から見つかった Discord の message cache を使います。
- 仮想化された未表示メッセージの取得は行いません。取得できない範囲があっても送信できます。
- Claude Code CLI の `stream-json` 出力を delta / tool / result に正規化します。未知の JSON イベントや JSON ではない stdout の診断行は回答へ混ぜず無視します。

## 対象外

- Discord Bot、Discord への投稿、Bridge 認証、OS 通知、自動リトライ
- セッションの手動 archive / delete（Claude Code の保存期間に従う）
- Discord の変化の自動取り込み（更新は常に「Discordコンテキストを更新」の明示操作）
- Chrome 以外のブラウザ、Discord デスクトップアプリ
- Discord の内部 cache は現在の Webpack から最小限に探索するため、Discord の更新で利用できなくなる可能性があります
