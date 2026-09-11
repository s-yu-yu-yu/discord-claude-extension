# 設定リファレンス

`bridge/config.json`の全キーと、Bridgeと拡張の内部動作をまとめた技術資料です。導入手順は[導入ガイド](setup.md)、日常の操作は[使い方](usage.md)を参照してください。

## 構成

```text
Discord Web (content script)
  -> Chrome extension service worker (HTTP + SSE)
  -> Claude Bridge (Node HTTP)
  -> claude CLI (stream-json + partial messages)
  -> Chrome Side Panel
```

Bridgeは、設定された`workspace`をcwdとして`claude -p --output-format stream-json --verbose --include-partial-messages`を起動します。promptは標準入力で渡し、permission設定はClaude Codeの既存のものをそのまま利用します。Bridgeに認証はありません。社内配布では`host: "127.0.0.1"`を維持し、各自のPCで起動してください。

## config.jsonのキー

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
| `host` / `port` | `127.0.0.1` / `3456` | Bridgeの待ち受け先。拡張のBridge URLと合わせる |
| `workspace` | `~/claude-discord-workspace` | General Workspace。Projectを選ばないGeneral Sessionのcwd |
| `projectRoots` | `[]` | `{ path, depth }`の配列。各`path`を`depth`階層まで走査し、`.git`を含むディレクトリをProjectとして拡張へ公開する。root自体がGitリポジトリなら、そのrootがProject |
| `projectDepth` | `2` | `projectRoots[].depth`を省略したときの走査深さ |
| `actions` | Bridge既定 | Action Presetの配列`{ id, label, prompt }`。省略時は`jira`（Jiraに起票）、`github-issue`（GitHub Issue化）、`summarize`（要約）、`research`（調査）、`critique`（批評）、`freeform`（自由入力）。「自由入力」もBridgeから配信されるpresetの1つで、拡張側に固定のpresetはない |
| `claudeCommand` | `claude` | CLIの実行ファイル。Windowsネイティブは`claude.exe`の絶対パス、WSL2はLinux版のパス |
| `claudeModel` / `claudeEffort` | `opus` / `high` | CLIの`--model` / `--effort`にそのまま渡す。`""`にするとフラグを付けず、CLIの既定に従う |
| `permissionMode` | exampleは`default`、省略時は`auto` | CLIの`--permission-mode`。`""`にするとフラグを付けない。詳細は次節 |
| `terminalCommand` | `auto` | 「ターミナルで開く」に使う端末。`auto`では、macOSはTerminal.app、WindowsはWindows PowerShellを開き、WSL2はWindowsの端末から同じディストリビューション・Linuxユーザーで再開する。`""`にすると端末の起動を無効化し、コピーのみになる。カスタム文字列を指定すると`{command}`が再開コマンドに置換され、macOSはsh、WindowsはPowerShellで実行される |
| `attachmentsDir` | OS一時ディレクトリ配下の`claude-bridge-attachments` | Discord添付のダウンロード先。Claude Sessionごとにサブディレクトリを作り、`--add-dir`でClaude Codeへ渡す |
| `attachmentMaxBytes` | `20971520`（20 MB） | これを超える添付はダウンロードせず、metadataとURLのみ渡す |
| `claudeConfigDir` | 未設定 | 独自のClaude設定ルートを使う場合だけ指定する。指定すると、CLIに渡す`CLAUDE_CONFIG_DIR`と、セッションJSONLの参照先の両方に適用される。通常は未設定のままにし、現在の`CLAUDE_CONFIG_DIR`（未設定なら`~/.claude`）を使う |

## 非対話モードのツール許可（MCP / gh など）

Bridgeは`claude -p`（非対話）でClaudeを起動するため、許可ダイアログを出せません。`permissionMode`が`default`や`""`の場合、事前に許可されていないツールは自動で拒否され、回答に「権限が許可されていない」と出ます。許可ルールはGeneral Workspaceの`.claude/settings.json`に置いてください。

```json
{
  "permissions": {
    "allow": ["mcp__claude_ai_Atlassian", "Bash(gh issue create:*)", "WebSearch", "WebFetch"]
  }
}
```

`mcp__<server名>`でそのサーバーの全ツールを、`mcp__<server名>__<tool名>`で個別のツールを許可できます。Project Sessionで使う場合は、各リポジトリの`.claude/settings.json`にも同様のルールが必要です。許可ルールを書いてもMCPサーバーの接続そのものは追加されないので、JiraなどのMCPを使う場合は対話版Claude Codeで先に接続してください。`auto`を使う場合は、CLI・モデル・組織の管理設定が対応している必要があります。[公式の権限設定](https://code.claude.com/docs/en/permissions)も参照してください。

## 添付ファイル

Message Contextに含まれるDiscordの添付は、ファイル名・URL・MIME type・サイズをpromptに記載します。そのうえで、画像、PDF、テキスト、ソースコード、JSON、CSV、ログなどはBridgeが`attachmentsDir`へダウンロードし、`--add-dir`でClaude Codeから読めるようにします。`attachmentMaxBytes`を超えるファイル、動画・音声、種類を判別できないファイルは、metadataとURLだけを渡します。

ダウンロードに失敗した添付はSide Panelにtool行として表示され、残りのMessage Contextはそのまま送信されます。ダウンロード済みのファイルは、Bridgeが起動時と1時間ごとに確認し、24時間を過ぎたものを削除します。DOMから取得した添付はMIME typeとサイズが空になり、page worldのmessage cacheが見つかった場合はそれらで補完します。

## セッションの保存と再開

Side Panelのセッション一覧は、Chromeの`storage.local`に保存した索引を、起動時にBridgeと照合して表示します。Bridgeは、Claude Codeの設定ルート配下にある`projects/<cwdの非英数字をハイフンに置換>/<session-id>.jsonl`の有無を、セッションが実在する根拠にします。設定ルートは通常`~/.claude`で、`CLAUDE_CONFIG_DIR`または`claudeConfigDir`を指定している場合はそのルートです。この照合はCLIの内部保存形式に依存しています。

初回のturnでは、Claudeに`[DCE_SESSION_TITLE]短いタイトル[/DCE_SESSION_TITLE]`というマーカーを回答の冒頭へ出すよう依頼します。Bridgeはこのマーカーを除去し、その中身をタイトルとして一覧へ保存します。

Handoffは、元セッションを`claude --resume <id> --fork-session`でforkし、調査結果・決定事項・Source Link・関連リンク（Jira / GitHub）・現在判明している問題・次に実行すべき作業を見出しにした引き継ぎを生成します。元のGeneral Sessionは変更されません。Handoffの内容はClaudeによる要約で、Bridgeは検証しません。

「ターミナルで開く」は、BridgeとChromeが同一マシン（loopback接続）にあるときだけ表示されます。別マシンの場合は「resumeコマンドをコピー」で`cd "<cwd>" && claude --resume <id>`をコピーし、Bridgeのマシンで実行します。Bridgeは、起動したターミナルの状態を追跡しません。

## Message Contextの選択ルール

- 返信メッセージでは、親方向のrootからSource Messageの子孫までを自動選択します。祖先の兄弟分岐は含めません。返信ではないメッセージはSource Message 1件のみです。
- 送信前にmessage単位のON/OFFと前後5件の追加ができ、20件以上になるとwarningを表示します。候補はまずDOMから、次にpage worldで見つかったDiscordのmessage cacheから取得します。
- 仮想化されて未表示のメッセージは取得しません。取得できない範囲があっても送信できます。
- Claude Code CLIの`stream-json`出力はdelta / tool / resultに正規化します。未知のJSONイベントや、JSONではないstdoutの診断行は回答に混ぜず無視します。

## 対象外

- Discord Bot、Discordへの投稿、Bridge認証、OS通知、自動リトライ
- セッションの手動archive / delete（Claude Codeの保存期間に従う）
- Discordの変化の自動取り込み（更新は常に「Discordコンテキストを更新」の明示的な操作で行う）
- Chrome以外のブラウザ、Discordデスクトップアプリ
- Discordの内部cacheは現在のWebpackから最小限に探索しているため、Discordの更新で利用できなくなる可能性があります
