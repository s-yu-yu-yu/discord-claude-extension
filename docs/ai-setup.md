# Claude Code向けセットアップ手順

この文書は、利用者からセットアップを依頼されたClaude Codeが実行するための手順書です。対象はmacOS・Windowsネイティブ・WSL2の3環境で、配布ZIPから展開した場合もリポジトリの場合も手順は同じです。既存のClaude Code・認証・Macの構成はそのまま利用し、そこへDiscord Claude Bridgeを同じPCに追加します。

## 進め方

この文書の親の親のフォルダを配布ルートとし、以降の相対パスで書かれたコマンドは必ずそのルートで実行してください。最初に`package.json`、`bridge/config.example.json`、`scripts/setup.mjs`、`scripts/doctor.mjs`を読み、実際に同梱されている版とこの手順を照合します。`npm install`、拡張のビルド、Claude Codeの再インストールは通常不要です。

環境確認と通常の設定作成は、そのまま進めてください。初回で希望が分からない項目は、General Workspaceは既定、Project一覧は空、自動起動は未登録のままにして、手動起動を検証します。利用者に確認するのは、環境からは決められない希望と、利用者自身の操作が必要な部分だけです。

既存の`bridge/config.json`があればまず読み、更新が必要なキーだけを編集します。編集する前に、同じ場所へ日時付きのバックアップを作成してください。既存のworkspace、Project、権限モード、ターミナル設定、Claude設定ルートは、初期値へ戻さないでください。Claudeの認証ファイルは、表示やコピーをしたり、共有ZIPへ入れたりしません。

## 1. 実行環境を確かめる

```sh
node -p "JSON.stringify({platform:process.platform,release:require('node:os').release(),distro:process.env.WSL_DISTRO_NAME,arch:process.arch,node:process.version,home:require('node:os').homedir(),cwd:process.cwd()})"
```

- `darwin`: Mac手順を使います。launchdとTerminal.appは既存のものを利用します。
- `win32`: Windows手順を使います。Bridge・Node・ClaudeはすべてWindows側で動かします。
- `linux`で、カーネルが標準WSL2かつ`WSL_DISTRO_NAME`がある: **[WSL2手順](setup-wsl2.md)を読んでから**進めます。Windowsの`wsl.exe --list --verbose`で対象がVERSION 2であることを確認し、同じLinux版のNode・Claude・認証を利用します。Windows版へは移行しません。
- 通常のLinux、WSL1、またはWSL2かどうか判別できない環境: 自動登録には進まず、環境を確認します。カーネル名だけを根拠にWSL1から変換するような操作はしません。
- Nodeがない、または22未満: 会社指定のNode導入方法を利用者に確認します。[導入ガイド](setup.md)を案内し、導入後に再開します。

展開先がZIPの中や一時フォルダなら、継続して使う設置先を利用者に確認します。すでに拡張や自動起動を登録しているフォルダは、勝手に移動しません。

## 2. 既存のClaudeを見つける

まず`claude`コマンドの実体を確認します。MacとWSL2のシェルでは`command -v claude`、Windows PowerShellでは`Get-Command claude -All | Select-Object CommandType,Source`を使います。使用するのはWindowsネイティブでは`claude.exe`、WSL2ではLinux版の`claude`で、既定の`~/.local/bin/claude.exe`も候補です。`claude.cmd`しか見つからない場合は、ネイティブ版が必要であることを利用者に伝えます。その際、既存のnpm版は削除しません。

`claude`が見つからない場合は、[公式インストール手順](https://code.claude.com/docs/en/setup)のネイティブインストーラーを利用者に案内し、承認を得てから実行します。コマンドは、macOS/WSL2では`curl -fsSL https://claude.ai/install.sh | bash`、Windows PowerShellでは`irm https://claude.ai/install.ps1 | iex`です。Claude Desktopアプリだけでは`claude`コマンドは入りません。導入後のログインは、利用者自身が同じ環境で行います。

見つけた実行ファイルで`--version`を実行します。`claudeCommand`に設定するのは実行ファイルのパスだけで、フラグ、シェルのalias、`cd ... && claude`のような形は入れないでください。既存設定に独自のラッパーがある場合はそのまま保持し、診断で動作を確かめます。

Claude Codeで作業できているからといって、別プロセスからの認証成功を断定しないでください。必要なら実行ファイルの`auth status`で状態を確認し、秘密情報を含む出力は報告へ転記しないでください。未ログインなら、利用者に同じ環境でのログインを依頼します。認証方式やアカウントは切り替えません。

## 3. 設定を作成・確認する

```sh
node scripts/setup.mjs
```

このコマンドは、設定ファイルがないときだけexampleをコピーし、workspaceを作ります。既存の設定は上書きしません。

| キー | 新規導入時の判断 |
| --- | --- |
| `host` | `127.0.0.1`。ネットワーク公開やファイアウォール開放は不要 |
| `port` | 既定は3456。使用中なら既存プロセスを確認し、勝手に終了しない |
| `workspace` | 希望がなければ`~/claude-discord-workspace`。既存設定は維持 |
| `claudeCommand` | 手順2で確認した実行ファイルのパス。空白を含むパスもJSON文字列としてそのまま記録 |
| `projectRoots` | 希望がなければ空。利用者が指定したリポジトリ群だけ追加 |
| `permissionMode` | exampleの`default`を維持。動作させるために`auto`や権限の迂回へ変更しない |
| `terminalCommand` | 新規導入では省略し、OS別の`auto`に任せる。既存のカスタム値や無効化の設定は維持 |
| `claudeConfigDir` | 通常は追加しない。既存の環境・指定値をそのまま利用 |

JSONはUTF-8で書き、プレースホルダーを実際のパスへ置き換えます。Windowsのパスは`C:/Users/...`か、JSONとしてエスケープした`C:\\Users\\...`のどちらでも書けます。`projectRoots`には実在する場所を指定し、深さは希望がなければ2にします。

```sh
node scripts/doctor.mjs
```

`FAIL`が出たら解消します。ただし、診断の終了コードが0でも導入完了を意味しません。この診断はBridgeの未起動を`INFO`として扱い、ログイン・ツール権限・Chrome連携は検証しません。WSL2では、Windows側からのhealthも別途確認します。

### ツール許可を設定する

Bridgeは`claude -p`（非対話）でClaudeを動かすため、許可ダイアログを出せません。`permissionMode: "default"`では未許可のツールが自動的に拒否されるので、General Workspace（`workspace`）の`.claude/settings.json`に許可ルールを置きます。利用者にJira起票・GitHub Issue化・Web検索のどれを使うかを確認し、使うものだけを追加してください。希望が分からなければ`WebSearch`と`WebFetch`だけを追加し、残りは報告で案内します。

```json
{
  "permissions": {
    "allow": ["WebSearch", "WebFetch", "Bash(gh issue create:*)", "Bash(gh issue view:*)", "mcp__claude_ai_Atlassian"]
  }
}
```

- 既存の`settings.json`があれば、日時付きのバックアップを作ってから`permissions.allow`に不足分だけを追記します。他のキーや既存のルールは削除も変更もしません。
- `mcp__<server名>`には、利用者のClaude Codeに実際に接続済みのMCPサーバー名を使います。`claude mcp list`で確認し、存在しないサーバー名は追加しません。許可ルールを書いてもMCPサーバーの接続そのものは追加されないので、Jiraなどを使う場合は、対話版Claude Codeでの接続を利用者に依頼します。
- `gh`を使う場合は、`gh auth status`でログイン済みかを確認します。未ログインなら利用者にログインを依頼し、代わりに認証を進めることはしません。
- `Bash(*)`のような広い許可や、`permissionMode: "auto"`への変更で回避しないでください。Project Sessionで使う場合は、各リポジトリの`.claude/settings.json`にも同様のルールが必要です。この点は報告に書きます。

## 4. Bridgeの起動を検証する

まず、設定した接続先の`/health`を確認します。すでに応答がある場合は、`/config`が返すworkspaceを設定と比較し、実行中のプロセスか自動起動登録のパスも調べて、今回の設置先と同じかを確認します。`/health`の応答だけでは版や設置先は分かりません。不明なプロセスは止めないでください。

未起動なら、バックグラウンド実行か、作業後も継続できるターミナルでBridgeを起動します。

```sh
node bridge/src/index.js
```

起動したプロセスIDとターミナルを記録してください。AIの実行環境が終了時に子プロセスを停止する場合、この起動は一時的な確認にとどまります。継続して使うには、利用者のターミナルで起動するか、希望に応じて自動起動を登録します。

設定したポートにHTTP GETを送り、ステータス200で`{"ok":true,"service":"claude-bridge"}`が返ることを確認します。既定ポートなら次のコマンドを使えます。ポートを変更した場合はURLも変更してください。

```sh
node -e "fetch('http://127.0.0.1:3456/health').then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true||b.service!=='claude-bridge')process.exitCode=1;console.log(b)}).catch(e=>{console.error(e.message);process.exitCode=1})"
```

自動起動の希望がある場合は、自分が手動で起動したBridgeを止めてから次のコマンドを実行し、もう一度HTTP応答を確認します。既存の自動起動を再登録すると現在のBridgeが再起動されるため、実行中の依頼がないことを先に確認してください。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

MacはLaunchAgent、Windowsはタスクスケジューラに登録します。登録が成功したことやRunning表示だけで完了とはしません。登録を拒否されたら、エラー内容と手動起動の方法を伝え、管理者への相談を案内します。OSの実行ポリシーは変更しません。

WSL2の自動起動は、Windowsのタスクから対象ディストリビューションとユーザーを明示してBridgeを実行します。systemdは不要です。WSLの既定設定や、Mac用・Windowsネイティブ用のサービスは変更しません。Windows側からのHTTP応答とworkspaceの一致も確認し、ポートの競合を避けます。

## 5. Chromeと実Claudeで確認する

WSL2では、先に`node scripts/service.mjs export-extension`で拡張をWindows側へコピーし、表示されたWindowsの絶対パスを読み込み先にします。拡張を更新したときも再exportが必要です。

Chromeを操作するツールが使えなければ、次の操作をまとめて利用者に依頼します。実際の操作結果を受け取るまでは、未確認として記録してください。

1. `chrome://extensions`でデベロッパーモードを有効にする。
2. 「パッケージ化されていない拡張機能を読み込む」で、今回の**extensionの絶対パス**を選ぶ。すでに同じ場所を読み込んでいる場合は「再読み込み」を押す。
3. 拡張の設定に今回のBridge URLを保存し、「接続テスト」を実行する。
4. Discord Webを再読み込みし、共有しても問題ない短いメッセージを「要約」で送る。
5. 回答が完了すること、同じセッションに追加指示できること、「ターミナルで開く」で再開できることを確認する。

セットアップを担当しているClaude Codeから直接別の`claude -p`を起動すると、ネストしたセッションとして拒否されることがあります。このエラーを認証の不良と決めつけず、利用者の独立したターミナルか、自動起動したBridgeを通じて確認します。

ツール権限で処理が止まった場合は、対象のworkspaceと拒否されたツールを特定して利用者に伝えます。要約が成功しただけでMCPやGitHubへの書き込みまで検証済みとは扱わず、必要なツールは利用者の既存ルールに従って個別に設定します。

## 6. 結果を報告する

次の項目を短く報告します。未実施の項目を成功として扱わず、次に必要な操作を具体的に示してください。

- 環境: OS、NodeとClaudeのバージョン、設置先。WSL2ではディストリビューションとLinuxユーザーも記載する
- 設定: workspace、Bridge URL、extensionの絶対パス、追加したツール許可、設定バックアップの場所（作成した場合）
- 実行方法: 手動起動か自動起動か、現在の稼働状況、停止コマンドとログの場所
- 検証: 診断、HTTP、Chrome接続、要約、追加指示、ターミナル再開それぞれの結果
- 残り: 利用者の操作待ち、ポリシーによる制限、未確認の事項

HTTP応答まで確認できた段階では「Bridgeの準備完了、Chrome確認待ち」、Chrome経由で要約・追加指示・再開まで確かめた場合に「基本セットアップ完了」としてください。自動起動を登録しても、再ログイン後に起動することは実際に確認するまで未確認のままです。
