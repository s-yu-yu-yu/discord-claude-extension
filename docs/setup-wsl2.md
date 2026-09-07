# WSL2での導入

普段のClaude CodeがWSL2内にある人向けの手順です。**Bridge・Node・Claude・workspaceはWSL2内、Chrome拡張はWindows側**に置きます。Mac用やWindowsネイティブ用の設定・認証を移す必要はありません。

## 1. 対象環境を確認する

Windows PowerShellで`wsl.exe --list --verbose`を実行し、使用するディストリビューションのVERSIONが`2`であることを確認します。WSL1からの変換はこのセットアップでは行いません。

以降、Windowsと書かれていないコマンドは、普段Claudeを使っているWSL2のユーザーで実行します。

```sh
printf '%s\n' "$WSL_DISTRO_NAME"
uname -r
whoami
node --version
command -v claude
claude --version
```

Nodeは22以上、ClaudeはLinux版を使用します。Nodeが`win32`を返す場合や、Claudeが`claude.exe`の場合はWindows版を呼んでいるため、WSL内の実行ファイルに切り替えます。判別コマンドは`node -p "process.platform"`です。

自動起動登録・Windowsへの拡張配置・ターミナル再開には、WSLから`powershell.exe`、`wslpath`を実行できることが必要です。Windowsとの相互運用が組織ポリシーで無効なら、ポリシーは変更せず、手動起動・手動コピー・WSLターミナルへのコマンド貼り付けを使います。

## 2. Linux側に展開して設定する

配布フォルダを例として`~/apps/discord-claude-extension`へ展開し、そのフォルダを開きます。版番号に依存しない固定の場所を使うと更新しやすくなります。自動起動登録後はフォルダを勝手に移動しません。

```sh
node scripts/setup.mjs
```

`bridge/config.json`では次を確認します。以下は例なので、ユーザー名とCLIパスを実際の値へ置き換えてください。既存設定がある場合は全体を置き換えません。

```json
{
  "host": "127.0.0.1",
  "port": 3456,
  "workspace": "/home/your-name/claude-discord-workspace",
  "claudeCommand": "/home/your-name/.local/bin/claude",
  "projectRoots": [{ "path": "/home/your-name/src", "depth": 2 }],
  "permissionMode": "default"
}
```

`workspace`とProjectはLinuxパスを使います。`C:/...`を設定しないでください。Claude設定ルートは通常WSL内の`~/.claude`で、独自の`CLAUDE_CONFIG_DIR`や`claudeConfigDir`があればそのまま利用します。

```sh
node scripts/doctor.mjs
node bridge/src/index.js
```

診断が`Environment: wsl2`と対象ディストリビューションを表示することを確認します。自動判別は標準WSL2カーネルと`WSL_DISTRO_NAME`を使います。独自カーネルなどで`linux`になる場合は自動機能を対象外として扱い、手動で動作確認してください。

## 3. Windowsから接続を確認する

Bridgeを起動したまま、**Windows PowerShell**で実行します。ポートを変更した場合はURLも変更します。

```powershell
Invoke-RestMethod http://127.0.0.1:3456/health
Invoke-RestMethod http://127.0.0.1:3456/config
```

healthの`ok: true`、`service: claude-bridge`と、configのworkspaceが今回のLinux側の設定であることを確認します。Linux内でのHTTP成功だけでは、Windows側からの接続成功を確認したことになりません。

WindowsからWSL内のアプリへはlocalhost経由で接続できます。[Microsoftのネットワーク説明](https://learn.microsoft.com/en-us/windows/wsl/networking)を参照してください。NAT構成で失敗する場合は`.wslconfig`の`localhostForwarding`、VPN、Windows側の同一ポート使用状況を確認します。mirrored構成でもWindows側から実際に確認してください。Bridgeのhostを`0.0.0.0`へ変更したり、LANへポート転送したりする手順ではありません。

Windowsネイティブ版Bridgeや別ディストリビューションのBridgeを併用する場合、同じlocalhostポートを使わないでください。それぞれ別のポートに設定し、拡張設定の接続先も合わせます。

## 4. Chrome拡張をWindowsへ配置する

WSLの配布ルートで実行します。

```sh
node scripts/service.mjs export-extension
```

Windowsの`%LOCALAPPDATA%\DiscordClaudeBridge-WSL-<識別子>\extension`に拡張だけをコピーし、読み込み先のWindows絶対パスを表示します。識別子はディストリビューションとLinuxユーザーごとに固定です。Bridge設定・Claude認証・履歴はコピーしません。

Windows Chromeで`chrome://extensions`を開き、その表示されたフォルダを読み込んでください。拡張の接続先は`http://127.0.0.1:3456`です。次にDiscord Webで短い要約、追加指示、ターミナル再開を確認します。

相互運用が使えない場合は、エクスプローラーでLinux側の`extension`をWindowsの固定フォルダへ手動コピーして読み込めます。Linux側のフォルダを直接読み込むことは、この配布手順では前提にしていません。

## 5. 自動起動を登録する（任意）

手動起動したBridgeを止めてから、WSLの配布ルートで実行します。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

Windowsの現在のログインユーザーにタスクを登録し、`wsl.exe`から同じディストリビューション・Linuxユーザー・Node絶対パスでBridgeを起動します。Windowsネイティブ版の`DiscordClaudeBridge`とは別のタスクです。systemdや`.bashrc`、`/etc/wsl.conf`は変更しません。

タスク登録に使うランチャーはWindows側に置くので、Windowsへ次回ログインした際にも対象WSLを起動できます。タスクはBridgeをフォアグラウンドで実行する`wsl.exe`を待ちます。Linux側では起動したBridgeのPID・開始時刻・コマンドを専用ファイルに記録し、再登録や解除時は一致するプロセスだけを停止します。手動起動や他のWSLプロセスは停止しません。登録後と再ログイン後の両方で、Windows側のhealthを確認してください。

登録時のPATHと、設定済みなら`CLAUDE_CONFIG_DIR`を記録します。Nodeを移動したりPATHを変更したりした場合は再登録が必要です。シェルだけに設定したAPIキーやプロキシなど、その他の環境変数はランチャーに保存しません。それらに依存する場合は既存のClaude設定方式を確認するか、環境変数が有効なWSLターミナルから手動起動してください。

ログはstatusで表示するWindows側フォルダの`bridge.log`（標準出力）と`bridge.error.log`（標準エラー）です。WSL版では起動ごとにこれらのログを作り直し、大きな標準出力ログは`.previous`へ退避します。Windows側のタスクは失敗時に1分間隔で最大3回再起動します。

`wsl --shutdown`やディストリビューション終了でBridgeも止まります。登録タスクが再起動を試みることがあるため、WSLを停止したままにしたい場合は先にこのタスクを解除してください。他のWSL作業を巻き込む`wsl --shutdown`をBridgeだけの停止に使わないでください。

## ターミナルへの引き継ぎ

既定の`terminalCommand: "auto"`ではWindows側にPowerShellウィンドウを開き、その中で対象ディストリビューションとLinuxユーザーを指定してClaudeを再開します。パスはLinux形式のままです。Windows Terminalが既定の端末なら、その設定に従って表示されます。

「resumeコマンドをコピー」はLinuxシェル向けです。**同じディストリビューション・同じLinuxユーザーのWSLターミナル**へ貼り付けます。Windows PowerShellへそのまま貼り付けないでください。

## 更新と削除

更新時は依頼の完了を待ち、`node scripts/service.mjs uninstall`で今回のWSL用タスクを解除します。Linux側の固定フォルダへ新しい本体を置き、既存`bridge/config.json`を保持して、診断・拡張のexport・必要なら自動起動登録を行います。Windows Chromeでは同じ配置先の拡張を「再読み込み」します。

削除時はタスク解除とChrome拡張の削除を行います。タスク解除はWindows側のランチャー設定だけを削除し、拡張コピー、ログ、Linux側のworkspace・設定・Claude履歴を残します。不要な配置フォルダは利用者が確認して削除してください。

Windowsログイン、WSLの既定ディストリビューション、Linuxユーザーの関係は [MicrosoftのWSLコマンド説明](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) も参照してください。
