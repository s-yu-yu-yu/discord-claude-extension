# WSL2での導入

普段使っているClaude CodeがWSL2内にある人向けの手順です。**Bridge・Node・Claude・workspaceはWSL2内に、Chrome拡張はWindows側に**置きます。Mac用やWindowsネイティブ用の設定・認証を移す必要はありません。

## 1. 対象環境を確認する

Windows PowerShellで`wsl.exe --list --verbose`を実行し、使用するディストリビューションのVERSIONが`2`であることを確認します。WSL1からの変換は、このセットアップでは扱いません。

以降、Windowsと書かれていないコマンドは、普段Claudeを使っているWSL2のユーザーで実行してください。

```sh
printf '%s\n' "$WSL_DISTRO_NAME"
uname -r
whoami
node --version
command -v claude
claude --version
```

Nodeは22以上、ClaudeはLinux版を使います。`node -p "process.platform"`が`win32`を返す場合や、Claudeの実体が`claude.exe`の場合は、Windows版を呼んでいます。その場合はWSL内の実行ファイルに切り替えてください。

自動起動の登録、Windowsへの拡張の配置、ターミナルでの再開には、WSLから`powershell.exe`と`wslpath`を実行できることが必要です。Windowsとの相互運用が組織のポリシーで無効になっている場合は、ポリシーを変更せず、手動起動・手動コピー・WSLターミナルへのコマンド貼り付けで代用します。

## 2. Linux側に展開して設定する

配布フォルダを、たとえば`~/apps/discord-claude-extension`へ展開し、そのフォルダを開きます。版番号に依存しない固定の場所を使うと更新しやすくなります。自動起動を登録したあとは、フォルダを移動しないでください。

```sh
node scripts/setup.mjs
```

`bridge/config.json`では次の内容を確認します。以下は例なので、ユーザー名とCLIのパスは実際の値へ置き換えてください。既存の設定がある場合は、全体を置き換えないでください。

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

`workspace`とProjectにはLinuxのパスを使い、`C:/...`は設定しないでください。Claudeの設定ルートは通常WSL内の`~/.claude`です。独自の`CLAUDE_CONFIG_DIR`や`claudeConfigDir`を設定している場合は、それをそのまま使います。

```sh
node scripts/doctor.mjs
node bridge/src/index.js
```

診断が`Environment: wsl2`と対象のディストリビューションを表示することを確認します。この自動判別は、標準のWSL2カーネルと`WSL_DISTRO_NAME`を手がかりにしています。独自カーネルなどで`linux`と表示される場合は、自動機能は対象外として扱い、手動で動作を確認してください。

## 3. Windowsから接続を確認する

Bridgeを起動したまま、**Windows PowerShell**で次のコマンドを実行します。ポートを変更した場合は、URLのポートも合わせてください。

```powershell
Invoke-RestMethod http://127.0.0.1:3456/health
Invoke-RestMethod http://127.0.0.1:3456/config
```

healthの応答に`ok: true`と`service: claude-bridge`が含まれ、configのworkspaceが今回設定したLinux側のパスであることを確認します。Windows側から確認する理由は、Linux内でHTTPが成功しただけでは、Windowsから接続できるかどうか分からないためです。

WindowsからWSL内のアプリへは、localhost経由で接続できます（[Microsoftのネットワーク説明](https://learn.microsoft.com/en-us/windows/wsl/networking)）。NAT構成で失敗する場合は、`.wslconfig`の`localhostForwarding`、VPN、Windows側で同じポートを使っているものがないかを確認します。mirrored構成でも、Windows側から実際に接続を確認してください。なお、この手順はBridgeのhostを`0.0.0.0`へ変更したり、LANへポートを転送したりするものではありません。

Windowsネイティブ版のBridgeや別のディストリビューションのBridgeを併用する場合は、それぞれ別のポートに設定し、拡張設定の接続先もそれに合わせます。同じlocalhostポートを共有しないでください。

## 4. Chrome拡張をWindowsへ配置する

WSLの配布ルートで次のコマンドを実行します。

```sh
node scripts/service.mjs export-extension
```

このコマンドは、拡張だけをWindowsの`%LOCALAPPDATA%\DiscordClaudeBridge-WSL-<識別子>\extension`へコピーし、読み込み先のWindows絶対パスを表示します。識別子はディストリビューションとLinuxユーザーの組み合わせごとに固定です。Bridgeの設定、Claudeの認証、履歴はコピーしません。

Windows側のChromeで`chrome://extensions`を開き、表示されたフォルダを読み込んでください。拡張の接続先は`http://127.0.0.1:3456`です。読み込めたら、Discord Webで短い要約、追加指示、ターミナルでの再開を順に確認します。

相互運用が使えない場合は、エクスプローラーでLinux側の`extension`をWindowsの固定フォルダへ手動でコピーし、そのフォルダを読み込みます。Linux側のフォルダを直接読み込むことは、この配布手順では前提にしていません。

## 5. 自動起動を登録する（任意）

手動で起動したBridgeを止めてから、WSLの配布ルートで次のコマンドを実行します。

```sh
node scripts/service.mjs install
node scripts/service.mjs status
```

このコマンドは、Windowsの現在のログインユーザーにタスクを登録します。タスクは`wsl.exe`を通じて、同じディストリビューション・同じLinuxユーザー・同じNodeの絶対パスでBridgeを起動します。Windowsネイティブ版の`DiscordClaudeBridge`とは別のタスクです。systemdや`.bashrc`、`/etc/wsl.conf`は変更しません。

タスクが使うランチャーはWindows側に置くため、Windowsへ次回ログインしたときにも対象のWSLを起動できます。タスクは、Bridgeをフォアグラウンドで実行する`wsl.exe`を待ち続けます。Linux側では、起動したBridgeのPID・開始時刻・コマンドを専用ファイルに記録し、再登録や解除のときはこの記録と一致するプロセスだけを停止します。手動で起動したBridgeや他のWSLプロセスは停止しません。登録直後と再ログイン後の両方で、Windows側からhealthを確認してください。

ランチャーには、登録時のPATHと、設定済みであれば`CLAUDE_CONFIG_DIR`を記録します。そのため、Nodeを移動したりPATHを変更したりした場合は再登録が必要です。一方、シェルだけに設定したAPIキーやプロキシなど、その他の環境変数はランチャーに保存しません。それらに依存する場合は、既存のClaude設定の方式を確認するか、環境変数が有効なWSLターミナルから手動で起動してください。

ログは、statusが表示するWindows側フォルダの`bridge.log`（標準出力）と`bridge.error.log`（標準エラー）です。WSL版では起動ごとにこれらのログを作り直し、大きな標準出力ログは`.previous`へ退避します。Windows側のタスクは、失敗したときに1分間隔で最大3回再起動します。

`wsl --shutdown`やディストリビューションの終了でBridgeも止まります。ただし、登録したタスクが再起動を試みることがあるため、WSLを停止したままにしたい場合は、先にこのタスクを解除してください。逆に、Bridgeだけを止めたいときに`wsl --shutdown`を使うと他のWSL作業も巻き込むので、避けてください。

## ターミナルへの引き継ぎ

既定の`terminalCommand: "auto"`では、Windows側にPowerShellウィンドウを開き、その中で対象のディストリビューションとLinuxユーザーを指定してClaudeを再開します。パスはLinux形式のままです。Windows Terminalが既定の端末になっていれば、その設定に従って表示されます。

「resumeコマンドをコピー」で得られるコマンドはLinuxシェル向けです。**同じディストリビューション・同じLinuxユーザーのWSLターミナル**へ貼り付けてください。Windows PowerShellへそのまま貼り付けないでください。

## 更新と削除

更新するときは、実行中の依頼が完了するのを待ってから、`node scripts/service.mjs uninstall`で今回のWSL用タスクを解除します。次にLinux側の固定フォルダへ新しい本体を置き、既存の`bridge/config.json`は残したまま、診断、拡張のexport、必要なら自動起動の登録をやり直します。Windows側のChromeでは、同じ配置先の拡張を「再読み込み」します。

削除するときは、タスクを解除し、Chromeから拡張を削除します。タスクの解除で消えるのはWindows側のランチャー設定だけで、拡張のコピー、ログ、Linux側のworkspace・設定・Claude履歴は残ります。不要になった配置フォルダは、内容を確認したうえで利用者自身が削除してください。

Windowsのログイン、WSLの既定ディストリビューション、Linuxユーザーの関係については、[MicrosoftのWSLコマンド説明](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)も参照してください。
