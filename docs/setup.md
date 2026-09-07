# 社内向け導入ガイド

Discord Webで選んだ会話を、自分のPCのClaude Codeへ送るツールです。Chrome拡張とBridgeの両方を、利用者ごとのPCに設置します。まずは少人数で試用してください。Windowsの実機確認は [配布担当者向け手順](distribution.md) の確認表に沿って行います。

## Claude Codeにセットアップを任せる

普段使っているClaude Codeで、展開したフォルダを開き、次を依頼してください。

```text
このフォルダの docs/ai-setup.md を読み、Discord Claude Bridgeをセットアップしてください。
既存のClaude Codeの認証・設定とMac/Windows環境を利用してください。
既存のBridge設定があれば保持し、必要な設定と起動確認を進めてください。
自動起動の希望は未指定です。Chromeなど私の操作が必要な部分は具体的に案内し、
確認できた項目と残っている操作を最後に報告してください。
```

自動起動も希望する場合は、その旨を追記できます。AI向けの実行順序・判断条件・完了基準は [Claude Code向け手順](ai-setup.md) にまとめています。以下は手動で導入する場合や、AIから案内された操作を確認するための手順です。

## 用意するもの

- Google ChromeとDiscord Webへのログイン。Discordデスクトップアプリは対象外です。
- Node.js 22以上（導入時は会社で承認されたLTS版）。[Node.js公式配布](https://nodejs.org/en/download)から導入します。
- ネイティブ版Claude Code CLIと、会社で利用が認められたアカウント。Claude Desktopだけでは動きません。
- WindowsではWindows PowerShell 5.1を利用します。WSLとWindows側のClaude環境を混在させないでください。

Claude Codeは [公式セットアップ](https://code.claude.com/docs/en/installation) に従ってインストールしてください。Windowsでは`claude.exe`を使用します。npm版の`claude.cmd`はこのBridgeの対象外です。Git for WindowsはBashを使う作業向けに推奨します。各自のPCで`claude --version`と`claude`を実行し、ログインを済ませます。

## 1. ZIPを展開する

ZIP内の`discord-claude-extension-0.2.0`フォルダを、今後も使い続ける場所へ置きます。Windowsでは「すべて展開」を選んでください。ZIP内や一時フォルダから直接実行しないでください。

フォルダ内には`extension`、`bridge`、`scripts`、`docs`があります。フォルダを移動すると、自動起動とChrome拡張の再登録が必要です。

## 2. Bridgeを準備する

展開フォルダをターミナルで開き、次を実行します。Windowsではエクスプローラーのアドレスバーに`powershell`と入力すると、その場所で開けます。

```sh
node scripts/setup.mjs
node scripts/doctor.mjs
```

初回は`bridge/config.json`と、ホームフォルダ内の`claude-discord-workspace`を作ります。既存設定は上書きしません。追加のnpmパッケージのインストールは不要です。

`bridge/config.json`はメモ帳などで編集できます。Windowsのパスは、JSONでは次のように`/`を使うと記述しやすくなります。設定はUTF-8で保存してください。

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

例の`your-name`を自分のユーザー名へ置き換えてください。Macでは`~/claude-discord-workspace`のようなパスを使えます。`projectRoots`は必要な人だけ設定します。

配布設定の`permissionMode`は`default`です。非対話実行では許可を尋ねられないので、使いたいツールはGeneral Workspaceや対象Projectで対話版Claudeを開き、会社のルールに従って設定してください。`auto`の利用可否はClaude Codeのアカウント・モデル・管理設定に依存します。詳細は [公式の権限設定](https://code.claude.com/docs/en/permissions) を参照してください。

```sh
node bridge/src/index.js
```

`Claude Bridge listening on http://127.0.0.1:3456`が表示されたら起動完了です。このターミナルを開いたまま次へ進みます。停止は`Ctrl+C`です。

## 3. Chrome拡張を読み込む

1. Chromeで`chrome://extensions`を開き、デベロッパーモードを有効にします。
2. 「パッケージ化されていない拡張機能を読み込む」で、展開したフォルダ内の`extension`を選びます。
3. 拡張の設定でBridge URLを`http://127.0.0.1:3456`にして保存します。
4. Discord Webを再読み込みし、メッセージにマウスを置いてClaudeボタンを押します。
5. 最初は短いメッセージの「要約」を試してください。

会社のChromeポリシーでデベロッパーモードや拡張の読み込みが禁止されている場合は、管理者に配布方式を相談してください。このZIPはChrome Web Store版や管理配布用の署名済みインストーラーではありません。

操作の詳細は [使い方](usage.md) を参照してください。

## 4. ログイン時に自動起動する（任意）

手動起動したBridgeを`Ctrl+C`で止めてから、展開フォルダで実行します。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

MacはLaunchAgent、Windowsは現在のユーザーのタスクスケジューラ（`DiscordClaudeBridge`）へ登録します。Windowsはログイン中のみ動作し、失敗時は1分間隔で最大3回再起動します。登録直後に診断コマンドで接続を確認してください。Windowsのタスク状態がRunningでもBridgeの起動成功を保証しません。

設定変更後は、実行中の依頼が完了してから`install`をもう一度実行します。Node.jsを別の場所へ入れ直した場合も再登録してください。

| OS | ログ |
| --- | --- |
| Windows | `%LOCALAPPDATA%\DiscordClaudeBridge\bridge.log` |
| macOS | `~/Library/Logs/claude-bridge.log` |

Windowsの実行ポリシーやタスク登録権限で拒否された場合は、上記のNodeによる手動起動を利用し、社内管理者へ相談してください。スクリプトは実行ポリシーを変更しません。

## よくある問題

| 症状 | 確認すること |
| --- | --- |
| `node`が見つからない | Node導入後にターミナルを開き直す |
| `claude`の起動失敗 / `ENOENT` | 診断を実行し、`claudeCommand`にネイティブCLIの絶対パスを指定する |
| PowerShellで`npm.ps1`が拒否される | このガイドの`node ...`を使う。npmが必要な場合は`npm.cmd`を使う |
| Bridgeに接続できない | Bridge起動、設定URL、ログを確認する |
| `EADDRINUSE` | 手動起動と自動起動が重複していないか確認する |
| 回答にツール権限エラー | 対象workspaceでClaudeを対話起動し、ログイン・ツール設定を確認する |
| 再開セッションが見つからない | workspaceの移動、ドライブ文字の大文字小文字、Claude設定ルートの変更を確認する |
| ターミナル引き継ぎが失敗する | コマンドをコピーして実行する。Windowsのコピー先はPowerShell |

## 更新・削除

更新時は実行中の依頼を完了し、旧フォルダで`node scripts/service.mjs uninstall`を実行します。新ZIPを別フォルダへ展開し、旧`bridge/config.json`を新フォルダへコピーしてから診断・自動起動登録を行います。Chromeでは旧拡張を削除せず、フォルダ移動が不要なら同じ場所の`extension`を更新して「再読み込み」すると索引を維持できます。移動先から読み込み直す場合、拡張IDが変わりセッション一覧を引き継げないことがあります。

削除時は自動起動を解除し、Chromeから拡張を削除して、展開フォルダを削除します。Claudeの履歴、General Workspace、ダウンロード済み添付、ログは自動では削除しません。

## 社内で扱うデータ

選んだ会話・関連メッセージ・添付はClaude Codeへ渡ります。送信前に対象を確認してください。認証やMCP設定は各利用者自身のものを使います。

Bridgeに認証はありません。社内配布では`host: "127.0.0.1"`を維持し、各自のPCで使用します。`projectRoots`は選択肢を絞る設定であり、Claudeのファイルアクセスを隔離する仕組みではありません。添付はOSの一時フォルダに保存し、Bridge起動時と1時間ごとの清掃で24時間を過ぎたものを削除します。
