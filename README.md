# Discord Claude Extension

Discord Web のメッセージを Source Message として選び、ローカルの Bridge から Claude Code の General Session に送る Chrome 拡張です。v1 は Google Chrome と Discord Web を対象にし、Discord Bot や Bridge 認証は使用しません。

## 構成

```text
Discord Web (content script)
  -> Chrome extension service worker (HTTP + SSE)
  -> Claude Bridge (Node HTTP)
  -> claude CLI (stream-json + partial messages)
  -> Chrome Side Panel
```

かんたんな使い方は [docs/usage.md](docs/usage.md) を参照してください。

## セットアップ

### 1. Bridge

Node.js 20 以上と、ログイン済みの Claude Code CLI が必要です。

```sh
cp bridge/config.example.json bridge/config.json
# config.json の workspace と必要な projectRoots を編集
node bridge/src/index.js --config bridge/config.json
```

`config.json` は JSON 形式です。LAN 上の別 PC から接続する場合は `host` を `0.0.0.0` にし、ファイアウォールで `port`（既定 3456）への接続を許可してください。Bridge は設定された `workspace` を cwd として `claude -p ... --output-format stream-json --verbose --include-partial-messages` を起動し、Claude Code の既存の permission 設定をそのまま利用します。

設定例:

```json
{
  "host": "127.0.0.1",
  "port": 3456,
  "workspace": "/Users/me/claude-discord-workspace",
  "projectRoots": [{ "path": "/Users/me/src", "depth": 2 }],
  "projectDepth": 2,
  "actions": [
    {
      "id": "research",
      "label": "調査",
      "prompt": "この内容について必要な調査を行ってください。"
    }
  ]
}
```

`workspace` は General Workspace で、Project を選ばない General Session の cwd になります。`projectRoots` の各 `path` を `depth`（省略時は `projectDepth`、既定 2）階層まで走査し、`.git` を含むディレクトリを Project として拡張へ公開します。root 自体が Git リポジトリならその root が Project になります。

`actions` を省略すると Bridge 既定の Action Preset（`jira` Jiraに起票、`github-issue` GitHub Issue化、`summarize` 要約、`research` 調査、`critique` 批評、`freeform` 自由入力）を使います。「自由入力」も Bridge から配信される preset で、拡張側に固定の preset はありません。`bridge/config.example.json` に同じ一覧があります。

`claudeCommand` を設定すると、CLI の場所やテスト用のラッパーを変更できます。`claudeModel`（既定 `opus`）と `claudeEffort`（既定 `high`）は CLI の `--model` / `--effort` にそのまま渡ります。`""` を設定すると該当フラグを付けず、Claude Code 側の既定設定に従います。

### Bridge をバックグラウンドで常駐させる（macOS）

Chrome 拡張は Node を起動できないため、Bridge は macOS の launchd（LaunchAgent）でログイン時に自動起動させます。

```sh
npm run bridge:install    # ~/Library/LaunchAgents に登録して即起動（config.json が無ければ example から作成）
npm run bridge:status     # 状態確認
npm run bridge:uninstall  # 登録解除
```

ログは `~/Library/Logs/claude-bridge.log` に出ます。`bridge/config.json` を変更したら `npm run bridge:install` を再実行すると再起動します。Bridge は落ちても launchd が再起動します。

`terminalCommand` は Side Panel の「ターミナルで開く」が実行するシェルコマンドで、`{command}` プレースホルダーが `cd "<cwd>" && claude --resume <session-id>` に置き換わります。macOS の既定値は `osascript -e 'tell application "Terminal" to do script "{command}"' -e 'tell application "Terminal" to activate'`（Terminal.app を起動）で、他の OS では空文字列のため起動は無効です。`""` を設定すると macOS でも起動を無効にでき、その場合はコマンドのコピーのみ利用できます。

Message Context に含まれる Discord の添付ファイルは、ファイル名・URL・MIME type・サイズを prompt に記載します。画像、PDF、テキスト、ソースコード、JSON、CSV、ログなどの小さなファイルは Bridge が `attachmentsDir`（既定は OS の一時ディレクトリ配下の `claude-bridge-attachments`）の Claude Session ごとのサブディレクトリへダウンロードし、`--add-dir` で Claude Code から読めるようにします。`attachmentMaxBytes`（既定 20971520 = 20 MB）を超えるファイル、動画・音声、種類を判別できないファイルはダウンロードせず metadata と URL のみを渡します。ダウンロードの失敗は Side Panel に tool 行として表示され、残りの Message Context はそのまま送信されます。ダウンロード済みファイルは Bridge が起動時と1時間ごとに確認し、24時間を過ぎたものを削除します。

通常は Claude Code の既存設定をそのまま使うため claudeConfigDir を設定しません。この場合、CLIは現在の CLAUDE_CONFIG_DIR 環境変数（未設定なら ~/.claude）を使用します。独自のClaude設定ルートを使う場合だけ、設定へ "claudeConfigDir": "/path/to/claude-config" を追加してください。指定値はCLIの CLAUDE_CONFIG_DIR とセッションJSONLの参照先へ同時に適用されます。

### 2. Chrome 拡張

1. Chrome で `chrome://extensions` を開く
2. デベロッパーモードを有効にする
3. 「パッケージ化されていない拡張機能を読み込む」から、このリポジトリの `extension` ディレクトリを選ぶ
4. 拡張の設定画面で Bridge URL（既定 `http://127.0.0.1:3456`）を保存する
5. Discord Web を再読み込みする

Discord のメッセージをホバーすると Claude ボタンが表示されます。押すと Source Message の確認、Bridge から取得した Action Preset の選択、追加指示の入力を行えます。作業先は既定で 一般 (General Workspace) です。「Projectを選択」を押すと Bridge が見つけた Project の一覧が表示され、選ぶとその Git リポジトリを cwd とする Project Session を開始します。送信後は Side Panel が開き、Current Session の Claude 出力を SSE で受け取って Markdown 表示し、最終回答をコピーできます。完了後は同じ Claude Session へ追加指示を送り、実行中の turn を停止できます。

完了した General Session では Side Panel の「Projectで続行 (Handoff)」から Project を選び、任意の追加指示を付けて新しい Project Session を開始できます。Bridge は元セッションを `claude --resume <id> --fork-session` で fork し、調査結果・決定事項・Source Link・関連リンク（Jira / GitHub）・現在判明している問題・次に実行すべき作業を見出しにした Handoff を生成します。元の General Session は変更されず、そのまま再開できます。Handoff は新しい Project Session の初期コンテキストとして最初の「指示」turn に表示され、Side Panel は元セッションへのリンクを表示します。セッション一覧は従来どおりフラットです。

Current Session を開いたまま Discord の別メッセージで Claude ボタンを押すと、送信 UI の先頭に「新しいセッションを開始」「現在のセッションに追加: <タイトル>」の選択が表示されます。既定は新しいセッションで、「現在のセッションに追加」を選ぶと同じ Message Context のルールと調整 UI（返信チェーン、前後5件、message 単位の ON/OFF）で選んだメッセージが Source Link 付きで同じ Claude Session に追加されます。すでに送信済みのメッセージは候補から除かれます。

Side Panel の「Discordコンテキストを更新」は、Current Session の Source Message があるチャンネルを開いている Discord Web のタブで送信 UI を開き直し、そのセッションへまだ送っていないメッセージだけを差分として表示します。差分は message 単位で ON/OFF してから追加します。別のチャンネルを表示している場合は Source Message のチャンネルへ移動するので、読み込み後にもう一度押してください。Bridge や拡張が Discord の変化を自動で取り込むことはなく、更新は常にこの明示的な操作で行います。

Side Panel の Claude Session はターミナルへ引き継げます。「ターミナルで開く」は Bridge と Chrome が同一マシン（loopback 接続）で動作しているときだけ表示され、Bridge が `terminalCommand`（既定は macOS の Terminal.app を osascript で起動）を使って `cd "<cwd>" && claude --resume <session-id>` を実行します。Bridge が LAN 上の別マシンにある場合は代わりに「resumeコマンドをコピー」で同じコマンドをコピーし、Bridge のマシンで実行してください。どちらも同じ Claude Session の履歴を再開し、セッションは Side Panel の一覧に残ります。General Session・Project Session のどちらでも使えますが、turn の実行中は起動できません。

Side Panel のセッション一覧は Chrome の `storage.local` に保存した索引を起動時に Bridge と照合します。Bridge は Claude Code 2.1.251 が使う設定ルート（通常 `~/.claude`、`CLAUDE_CONFIG_DIR` または `claudeConfigDir` 指定時はそのルート）配下の `projects/<cwd-with-separators-replaced-by->/<session-id>.jsonl` を実在性の根拠にします。初回 turn では Claude に `[DCE_SESSION_TITLE]短いタイトル[/DCE_SESSION_TITLE]` マーカーを回答冒頭へ出すよう依頼し、Bridge がマーカーを除去してタイトルとして一覧へ保存します。

## 開発コマンド

```sh
npm test       # Bridge の HTTP/SSE と prompt の代表テスト
npm run lint   # JavaScript の構文、manifest、必須ファイルの検査
npm run build  # dist/extension に読み込み可能な拡張を生成
npm run typecheck # JS-only 構成のため構文検査を実行
```

`build` は `dist/extension` を毎回生成します。Bridge は実行時に設定ファイルを読み込むため、Bridge 自体のバンドルは不要です。

## v1 の境界

- Issue #1 の Source Message に加えて、Issue #3 では返信時に親方向の root から Source Message の子孫までを Message Context として自動選択します。祖先の兄弟分岐は含めません。非 reply は Source Message 1件のみです。
- 送信前に message 単位の ON/OFF を変更でき、前後5件の追加、取得不足の表示、20件以上の warning を提供します。候補はまず DOM、次に page world から見つかった Discord の現在の message cache を使います。
- 大量に仮想化された未表示メッセージの取得は行いません。取得できない範囲があっても Source Message を送信できます。
- Issue #4 では Message Context の添付ファイルを Bridge がダウンロードして Claude Code へ渡します。動画・音声・`attachmentMaxBytes` 超過・種類不明のファイルは metadata と URL のみで、実体は取得しません。DOM から得た添付は MIME type とサイズが空になり、page world の message cache が見つかった場合にそれらで補完します。
- Claude Code CLI の `stream-json` 出力（`stream_event` 内の partial delta と後続の assistant 全文を含む）を delta / tool / result に正規化します。未知の JSON イベントや JSON ではない stdout の診断行は回答へ混ぜず無視します。
- Issue #2 では Side Panel のセッション一覧、同じ Claude Session への追加指示、実行中 turn の停止、完了後の未読 badge と閲覧時の既読化を提供します。Bridge 再起動後も Claude JSONL が残っているセッションを再表示できます。
- Issue #5 では Bridge の設定ファイルで General Workspace・Project root（走査深さ付き）・Action Preset を管理し、送信 UI は既定で General Workspace、必要なときだけ Project を選んで Project Session を開始します。Project の自動検出は `.git` を含むディレクトリのみで、Handoff は対象外です。
- Issue #6 では完了した General Session から Project を選び、`--fork-session` で元セッションを変更せずに Handoff を生成して新しい Project Session の初期コンテキストにします。元セッションは別の Claude Session として残り、Project Session は元セッションへのリンクを保持します。Handoff の内容は Claude の要約であり、Bridge は検証しません。
- Issue #7 では既存の Claude Session へ Discord コンテキストを追加します。Side Panel の「Discordコンテキストを更新」は開いている Discord タブのチャンネルを再読み込みし、送信済み ID との差分だけを確認対象にします。Discord の別メッセージから「現在のセッションに追加」も選べますが、既定は新しいセッションの開始です。追加分は `--resume` した同じ Claude Session に 1 turn として送られ、Source Link を保持します。自動同期は行いません。
- Issue #8 では再開可能な Claude Session をターミナルへ引き継ぎます。Bridge と Chrome が同一マシンなら「ターミナルで開く」で `terminalCommand`（既定は macOS Terminal.app）を起動し、別マシンなら `cd "<cwd>" && claude --resume <id>` をコピーして実行します。引き継いでもセッションは Side Panel から消えず、Bridge は起動したターミナルの状態を追跡しません。
- 手動 archive/delete、OS 通知、Bridge 認証、Discord への投稿、自動リトライは対象外です。Discord の内部 cache は現在の Webpack から最小限に探索するため、Discord の更新で利用できなくなる可能性があります。
