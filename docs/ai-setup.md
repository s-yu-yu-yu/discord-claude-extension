# Claude Code向けセットアップ手順

この文書は、利用者からセットアップを依頼されたClaude Codeが実行するための手順です。対象はmacOS・Windowsネイティブ・WSL2。既存のClaude Code・認証・Macの構成を利用し、Discord Claude Bridgeを同じPCに追加します。配布ZIPでもリポジトリでも同じ手順です。

## 進め方

この文書の親の親を配布ルートとし、以降の相対コマンドは必ずそのルートで実行してください。まず`package.json`、`bridge/config.example.json`、`scripts/setup.mjs`、`scripts/doctor.mjs`を読み、実際の同梱版と手順を照合します。`npm install`、拡張のビルド、Claude Codeの再インストールは通常不要です。

環境確認と通常の設定作成は進めてください。初回の希望が不明なら、General Workspaceは既定、Project一覧は空、自動起動は未登録のまま手動起動を検証します。利用者に確認するのは、環境から決められない希望やユーザー操作が必要な部分だけです。

既存の`bridge/config.json`があればまず読み、更新が必要なキーだけ編集します。編集前に同じ場所へ日時付きバックアップを作成します。既存のworkspace、Project、権限モード、ターミナル設定、Claude設定ルートを初期値へ戻さないでください。Claudeの認証ファイルを表示・コピーしたり、共有ZIPへ入れたりしません。

## 1. 実行環境を確かめる

```sh
node -p "JSON.stringify({platform:process.platform,release:require('node:os').release(),distro:process.env.WSL_DISTRO_NAME,arch:process.arch,node:process.version,home:require('node:os').homedir(),cwd:process.cwd()})"
```

- `darwin`: Mac手順を使います。既存のlaunchd・Terminal.appを利用します。
- `win32`: Windows手順を使います。BridgeもNodeもClaudeもWindows側で動かします。
- `linux`かつカーネルが標準WSL2で`WSL_DISTRO_NAME`がある: **[WSL2手順](setup-wsl2.md)を読んでから**進めます。Windowsの`wsl.exe --list --verbose`で対象がVERSION 2と確認し、同じLinux版Node・Claude・認証を利用します。Windows版への移行はしません。
- 通常のLinux、WSL1、またはWSL2か判別できない環境: 自動登録を進めず環境を確認します。カーネル名だけでWSL1から変換するなどの操作はしません。
- Nodeがない、または22未満: 利用者へ会社指定のNode導入方法を確認します。[導入ガイド](setup.md)を案内し、導入後に再開します。

展開先がZIP内・一時フォルダなら、継続利用する設置先を利用者に確認します。既に登録された拡張や自動起動があるフォルダは勝手に移動しません。

## 2. 既存のClaudeを見つける

Mac/WSL2のシェルでは`command -v claude`、Windows PowerShellでは`Get-Command claude -All | Select-Object CommandType,Source`で実体を確認します。Windowsネイティブでは`claude.exe`、WSL2ではLinux版`claude`を使用します。既定の`~/.local/bin/claude.exe`も候補です。`claude.cmd`しかなければ、既存のnpm版を削除せず、ネイティブ版が必要であることを利用者に伝えます。

`claude`が見つからない場合は、[公式インストール手順](https://code.claude.com/docs/en/setup)のネイティブインストーラー（macOS/WSL2は`curl -fsSL https://claude.ai/install.sh | bash`、Windows PowerShellは`irm https://claude.ai/install.ps1 | iex`）を利用者に案内し、承認を得てから実行します。Claude Desktopアプリだけでは`claude`コマンドは入りません。導入後のログインは利用者自身が同じ環境で行います。

見つけた実行ファイルで`--version`を実行します。`claudeCommand`へ設定するのは実行ファイルのパスだけです。フラグ・シェルのalias・`cd ... && claude`などを入れないでください。既存設定に独自のラッパーがある場合は保持し、診断で動作を確かめます。

Claude Codeで作業できていることだけで、別プロセスからの認証成功を断定しません。必要なら実行ファイルの`auth status`で状態を確認し、秘密情報を含む出力を報告へ転記しないでください。未ログインなら利用者に同じ環境でログインを依頼します。認証方式やアカウントは切り替えません。

## 3. 設定を作成・確認する

```sh
node scripts/setup.mjs
```

このコマンドは設定がないときだけexampleをコピーし、workspaceを作ります。既存設定は上書きしません。

| キー | 新規導入時の判断 |
| --- | --- |
| `host` | `127.0.0.1`。ネットワーク公開やファイアウォール開放は不要 |
| `port` | 既定3456。使用中なら既存プロセスを確認し、勝手に終了しない |
| `workspace` | 希望がなければ`~/claude-discord-workspace`。既存設定は維持 |
| `claudeCommand` | 手順2で確認した実行ファイル。空白を含むパスもJSON文字列として記録 |
| `projectRoots` | 希望がなければ空。利用者が指定したリポジトリ群だけ追加 |
| `permissionMode` | 新規exampleの`default`を維持。動かすために`auto`や権限迂回へ変更しない |
| `terminalCommand` | 新規は省略してOS別の`auto`を利用。既存のカスタム値や無効化は維持 |
| `claudeConfigDir` | 通常は追加しない。既存の環境・指定値を利用 |

JSONはUTF-8で書き、プレースホルダーを実パスへ置き換えます。Windowsでは`C:/Users/...`、またはJSONとしてエスケープした`C:\\Users\\...`が使えます。`projectRoots`には実在する場所を使い、深さは希望がなければ2です。

```sh
node scripts/doctor.mjs
```

`FAIL`を解消します。ただし診断の終了コード0は導入完了を意味しません。WSL2はWindows側からのhealthも別途確認します。この診断はBridge未起動を`INFO`として扱い、ログイン・ツール権限・Chrome連携は検証しません。

### ツール許可を設定する

Bridgeは`claude -p`（非対話）で動くため、許可ダイアログを出せません。`permissionMode: "default"`では未許可のツールが自動で拒否されるので、General Workspace（`workspace`）の`.claude/settings.json`へ許可ルールを置きます。利用者に「Jira起票・GitHub Issue化・Web検索のどれを使うか」を確認し、使うものだけ追加します。希望が不明なら`WebSearch`と`WebFetch`だけ追加し、残りは報告で案内します。

```json
{
  "permissions": {
    "allow": ["WebSearch", "WebFetch", "Bash(gh issue create:*)", "Bash(gh issue view:*)", "mcp__claude_ai_Atlassian"]
  }
}
```

- 既存の`settings.json`があれば日時付きバックアップを作り、`permissions.allow`へ不足分だけ追記します。他のキーや既存のルールは削除・変更しません。
- `mcp__<server名>`は、利用者のClaude Codeに実際に接続済みのMCPサーバー名を使います。`claude mcp list`で確認し、無いサーバー名は追加しません。許可ルールはMCPサーバーの接続そのものを追加しないので、Jiraなどを使う場合は利用者に対話版Claude Codeでの接続を依頼します。
- `gh`を使う場合は`gh auth status`でログイン済みか確認します。未ログインなら利用者に依頼し、代わりに認証を進めません。
- `Bash(*)`のような広い許可や`permissionMode: "auto"`への変更で回避しないでください。Project Sessionで使う場合は各リポジトリの`.claude/settings.json`にも同様のルールが必要なことを報告に書きます。

## 4. Bridgeの起動を検証する

まず設定先の`/health`を確認します。既に応答する場合は`/config`のworkspaceを設定と比較し、実行プロセスまたは自動起動登録のパスも調べて、今回の設置先と同じか確認します。`/health`だけで版や設置先は分かりません。不明なプロセスは止めないでください。

未起動なら、バックグラウンド実行または継続可能なターミナルで実行します。

```sh
node bridge/src/index.js
```

起動したプロセスID・ターミナルを記録してください。AIの実行環境が終了時に子プロセスを停止する場合は、一時的な起動確認に留まります。継続利用には利用者のターミナルで起動するか、希望に応じて自動起動を登録します。

設定したポートへHTTP GETを送り、ステータス200かつ`{"ok":true,"service":"claude-bridge"}`を確認します。既定ポートなら次のコマンドを使用できます（ポートを変更した場合はURLも変更）。

```sh
node -e "fetch('http://127.0.0.1:3456/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true||b.service!=='claude-bridge')process.exitCode=1;console.log(b)}).catch(e=>{console.error(e.message);process.exitCode=1})"
```

希望がある場合は、自分が手動起動したBridgeを止めてから次を実行し、もう一度HTTP応答を確認します。既存の自動起動を再登録すると現在のBridgeを再起動するため、実行中の依頼がないことを確認してください。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

MacはLaunchAgent、Windowsはタスクスケジューラを使います。登録成功やRunningだけで完了にしません。拒否されたらエラーと手動起動方法を伝え、管理者へ相談します。OSの実行ポリシーは変更しません。

WSL2の自動起動は、Windowsタスクから対象ディストリビューションとユーザーを明示して実行します。systemdは不要です。WSLの既定設定やMac用・Windowsネイティブ用のサービスは変更しません。Windows側からのHTTP応答とworkspaceの一致も確認し、ポート競合を避けます。

## 5. Chromeと実Claudeで確認する

WSL2では先に`node scripts/service.mjs export-extension`でWindows側へ拡張をコピーし、表示されたWindows絶対パスを読み込み先として使います。更新時も再exportが必要です。

Chrome操作ツールが利用できなければ、次の操作を利用者へまとめて依頼します。実際の操作結果を受け取るまで未確認と記録してください。

1. `chrome://extensions`でデベロッパーモードを有効にする。
2. 「パッケージ化されていない拡張機能を読み込む」で、今回の**extensionの絶対パス**を選ぶ。既に同じ場所を読み込んでいる場合は「再読み込み」。
3. 拡張設定に今回のBridge URLを保存し、「接続テスト」を行う。
4. Discord Webを再読み込みし、共有して問題ない短いメッセージを「要約」で送る。
5. 回答完了、同じセッションへの追加指示、「ターミナルで開く」による再開を確認する。

セットアップを担当するClaude Codeから直接別の`claude -p`を起動すると、ネストしたセッションとして拒否される場合があります。そのエラーを認証不良と決めつけず、利用者の独立したターミナル、または自動起動したBridgeを通じて確認します。

ツール権限で止まった場合は、対象workspaceと拒否されたツールを特定して利用者へ伝えます。単なる要約の成功からMCPやGitHubへの書き込みまで検証済みと扱わず、必要なツールは利用者の既存ルールに従って個別に設定します。

## 6. 結果を報告する

次の項目を短く報告します。未実施の項目を成功扱いにせず、次に必要な操作を具体的に示してください。

- 環境: OS、Node・Claudeのバージョン、設置先。WSL2はディストリビューション・Linuxユーザーも記載
- 設定: workspace、Bridge URL、extensionの絶対パス、追加したツール許可、設定バックアップの場所（作成した場合）
- 実行方法: 手動または自動起動、現在の稼働状況、停止コマンドとログの場所
- 検証: 診断、HTTP、Chrome接続、要約、追加指示、ターミナル再開それぞれの結果
- 残り: ユーザー操作待ち・ポリシー制限・未確認事項

HTTPまでなら「Bridgeの準備完了、Chrome確認待ち」、Chrome経由の要約・追加指示・再開まで確かめた場合に「基本セットアップ完了」としてください。自動起動を登録しても、再ログイン後の起動は実際に確認するまで未確認です。
