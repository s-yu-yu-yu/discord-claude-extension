# 社内向け導入ガイド

Discord Webで選んだ会話を、自分のPCのClaude Codeへ送るツールです。利用者ごとのPCにChrome拡張とBridgeを設置して使います。対象はmacOS・Windowsネイティブ・WSL2の3環境で、まずは少人数で試用してください。Windowsの実機確認は、[配布担当者向け手順](distribution.md)の確認表に沿って進めます。

## 環境を選ぶ

| Claude Codeを使っている環境 | BridgeとNode | Chrome拡張 | 導入手順 |
| --- | --- | --- | --- |
| macOS | Mac内 | MacのChrome | このページ |
| Windowsネイティブ | Windows内 | WindowsのChrome | このページ |
| WSL2 | 同じWSLディストリビューション内 | WindowsのChrome | [WSL2手順](setup-wsl2.md) |

WSL2の場合は、ネイティブ版へ移さなくても、既存のLinux版Claudeをそのまま使えます。

## Claude Codeにセットアップを任せる

Bridgeの設定、起動確認、ツール許可の設定はClaude Codeに任せられます。展開したフォルダをClaude Code（Claude Desktopの**Code**タブ、またはターミナルの`claude`）で開き、[README「A. Claudeに任せる」](../README.md#a-claudeに任せるおすすめ)のプロンプトを貼り付けてください。Claude Coworkは隔離された仮想環境で動くため、PC上でBridgeを起動できません。

AI向けの実行順序・判断条件・完了基準は、[Claude Code向け手順](ai-setup.md)にまとめています。以下は、手動で導入する場合や、AIから案内された操作を確認したい場合の手順です。

## 用意するもの

- Google Chromeと、Discord Webへのログイン。Discordデスクトップアプリは対象外です。
- Node.js 22以上。[Node.js公式配布](https://nodejs.org/en/download)から、会社で承認されたLTS版を導入します。
- ネイティブ版Claude Code CLIと、会社で利用が認められたアカウント。Claude Desktopだけでは動きません。
- WindowsではWindows PowerShell 5.1。WSL2を使っている場合は、上記のWSL2手順へ進んでください。

Claude Codeは[公式セットアップ](https://code.claude.com/docs/en/installation)に従ってインストールしてください。Windowsで使うのは`claude.exe`で、npm版の`claude.cmd`はこのBridgeの対象外です。Bashを使う作業向けには、Git for Windowsを推奨します。インストール後は各自のPCで`claude --version`と`claude`を実行し、ログインを済ませてください。

## 1. ZIPをダウンロードして展開する

ブラウザで[Releases](https://github.com/s-yu-yu-yu/discord-claude-extension/releases/latest)を開き、Assetsの`discord-claude-extension-<バージョン>.zip`をダウンロードします。Gitは不要ですが、リポジトリへのアクセス権のあるGitHubアカウントでログインしてください。

ZIP内の`discord-claude-extension-<バージョン>`フォルダは、今後も使い続ける場所へ置きます。Windowsでは「すべて展開」を選んでください。ZIP内や一時フォルダから直接実行しないでください。

フォルダ内には`extension`、`bridge`、`scripts`、`docs`があります。設置後にフォルダを移動すると、自動起動とChrome拡張の再登録が必要になります。

## 2. Bridgeを準備する

展開フォルダをターミナルで開き、次のコマンドを実行します。Windowsでは、エクスプローラーのアドレスバーに`powershell`と入力すると、その場所でPowerShellを開けます。

```sh
node scripts/setup.mjs
node scripts/doctor.mjs
```

初回の実行では、`bridge/config.json`と、ホームフォルダ内の`claude-discord-workspace`を作ります。既存の設定があれば上書きしません。追加のnpmパッケージをインストールする必要もありません。

`bridge/config.json`はメモ帳などで編集できます。Windowsのパスは、JSONでは次のように`/`で区切ると書きやすくなります。設定ファイルはUTF-8で保存してください。

```json
{
  "host": "127.0.0.1",
  "port": 3456,
  "workspace": "C:/Users/your-name/claude-discord-workspace",
  "claudeCommand": "C:/Users/your-name/.local/bin/claude.exe",
  "projectRoots": [{ "path": "C:/Users/your-name/Documents/GitHub", "depth": 2 }],
  "permissionMode": "default"
}
```

例の`your-name`は自分のユーザー名へ置き換えてください。Macでは`~/claude-discord-workspace`のようなパスを使えます。`projectRoots`は、必要な人だけ設定してください。

配布設定の`permissionMode`は`default`です。Bridgeは非対話でClaudeを実行するため、ツールの許可をその場で尋ねられません。そのため、使いたいツール（Web検索、`gh`、Jira MCPなど）は、`workspace`フォルダの`.claude/settings.json`へ事前に許可を書いておきます。書き方は[設定リファレンス](reference.md#非対話モードのツール許可mcp--gh-など)を参照してください。Claudeにセットアップを任せる場合は、プロンプトで使いたいツールを伝えれば、この設定もあわせて済ませます。なお、`auto`を使えるかどうかはClaude Codeのアカウント・モデル・管理設定に依存します。詳細は[公式の権限設定](https://code.claude.com/docs/en/permissions)を参照してください。

```sh
node bridge/src/index.js
```

`Claude Bridge listening on http://127.0.0.1:3456`が表示されたら起動完了です。このターミナルは開いたまま次へ進んでください。Bridgeを止めるときは`Ctrl+C`を押します。

## 3. Chrome拡張を読み込む

1. Chromeで`chrome://extensions`を開き、デベロッパーモードを有効にします。
2. 「パッケージ化されていない拡張機能を読み込む」を押し、展開したフォルダ内の`extension`を選びます。
3. 拡張の設定でBridge URLを`http://127.0.0.1:3456`にして保存します。
4. Discord Webを再読み込みし、メッセージにマウスを乗せてClaudeボタンを押します。
5. 最初は短いメッセージの「要約」を試してください。

会社のChromeポリシーでデベロッパーモードや拡張の読み込みが禁止されている場合は、管理者に配布方式を相談してください。このZIPは、Chrome Web Store版でも、管理配布用の署名済みインストーラーでもありません。

操作の詳細は[使い方](usage.md)を参照してください。

## 4. ログイン時に自動起動する（任意）

手動で起動したBridgeを`Ctrl+C`で止めてから、展開フォルダで次のコマンドを実行します。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

登録先は、MacではLaunchAgent、Windowsでは現在のユーザーのタスクスケジューラ（`DiscordClaudeBridge`）です。Windowsのタスクはログイン中のみ動作し、失敗したときは1分間隔で最大3回再起動します。ただし、タスクの状態がRunningでもBridgeが起動できたとは限らないため、登録直後に診断コマンドで接続を確認してください。

設定を変更したときは、実行中の依頼が完了してから`install`をもう一度実行します。Node.jsを別の場所へ入れ直した場合も再登録が必要です。

| OS | ログ |
| --- | --- |
| Windows | `%LOCALAPPDATA%\DiscordClaudeBridge\bridge.log` |
| macOS | `~/Library/Logs/claude-bridge.log` |

Windowsの実行ポリシーやタスク登録の権限で拒否された場合は、前述のNodeによる手動起動を使い、社内管理者へ相談してください。スクリプト自体は実行ポリシーを変更しません。

## よくある問題

| 症状 | 確認すること |
| --- | --- |
| `node`が見つからない | Nodeを導入したあと、ターミナルを開き直す |
| `claude`の起動失敗 / `ENOENT` | 診断を実行し、`claudeCommand`にネイティブCLIの絶対パスを指定する |
| PowerShellで`npm.ps1`が拒否される | このガイドどおり`node ...`で実行する。npmが必要なら`npm.cmd`を使う |
| Bridgeに接続できない | Bridgeが起動しているか、設定したURL、ログを確認する |
| `EADDRINUSE` | 手動起動と自動起動が重複していないか確認する |
| 回答にツール権限エラー | 対象のworkspaceでClaudeを対話モードで起動し、ログインとツール設定を確認する |
| 再開セッションが見つからない | workspaceを移動していないか、ドライブ文字の大文字小文字、Claude設定ルートの変更を確認する |
| ターミナル引き継ぎが失敗する | コマンドをコピーして自分で実行する。Windowsでの貼り付け先はPowerShell |

## 更新・削除

更新するときは、まず実行中の依頼を完了させ、旧フォルダで`node scripts/service.mjs uninstall`を実行します。次に新しいZIPを別フォルダへ展開し、旧フォルダの`bridge/config.json`を新フォルダへコピーしてから、診断と自動起動の登録をやり直します。

Chrome側では旧拡張を削除しないでください。フォルダを移動する必要がなければ、同じ場所の`extension`を更新して「再読み込み」すると、セッション一覧の索引を維持できます。移動先から読み込み直すと拡張IDが変わり、セッション一覧を引き継げないことがあります。

削除するときは、自動起動を解除し、Chromeから拡張を削除して、展開フォルダを削除します。Claudeの履歴、General Workspace、ダウンロード済みの添付、ログは自動では削除されません。

## 社内で扱うデータ

選んだ会話、関連メッセージ、添付はClaude Codeへ渡るため、送信前に対象を確認してください。認証やMCP設定は、各利用者自身のものを使います。

Bridgeに認証はありません。社内配布では`host: "127.0.0.1"`を維持し、各自のPCで使用してください。`projectRoots`はProjectの選択肢を絞る設定で、Claudeのファイルアクセスを隔離する仕組みではありません。添付はOSの一時フォルダに保存され、Bridgeの起動時と1時間ごとの清掃で、24時間を過ぎたものが削除されます。
