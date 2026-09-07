# 配布担当者向け手順

配布物はmacOS・Windowsネイティブ・WSL2共通のZIPです。Node.jsとClaude Codeは同梱せず、利用者が用意します。初回配布は少人数の試用版として扱い、下記の実機確認を終えてから対象を広げてください。

## 作成

リポジトリのルートで実行します。Windows PowerShellでは`npm`の代わりに`npm.cmd`も利用できます。

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run package
```

`dist/discord-claude-extension-0.3.0.zip`と`.zip.sha256`が生成されます。生成はmacOS/Linuxでは`zip`、WindowsではPowerShellの`Compress-Archive`を使います。展開可能な同名フォルダも`dist`に残ります。

必要ファイルだけをコピーするため、`bridge/config.json`、Claudeの設定・認証情報、履歴、ダウンロード添付、`.git`は入りません。コードの未コミット変更は配布物に含まれるため、配布前に差分をレビューしてください。`package.json`とChrome manifestのバージョンを揃えて更新します。

ZIP内の`SHA256SUMS.txt`は同梱ファイルのハッシュ一覧です。ZIP自体のハッシュは、Windowsでは`Get-FileHash <ZIPのパス> -Algorithm SHA256`、macOSでは`shasum -a 256 <ZIPのパス>`で確認できます。

## 配布物の内容

| 場所 | 内容 |
| --- | --- |
| `extension/` | Chromeに読み込む拡張 |
| `bridge/src/` | Bridge本体 |
| `bridge/config.example.json` | 個人情報を含まない初期設定 |
| `scripts/` | 初期化・診断・自動起動 |
| `docs/setup-wsl2.md` | WSL2の配置・Windows接続・自動起動・更新手順 |
| `docs/ai-setup.md` | Claude Codeが実行する環境確認・設定・検証手順 |
| `docs/setup.md` | 利用者向けの導入・更新・削除手順 |
| `docs/usage.md` | 日常の使い方 |

## 検証状況と実機確認

開発時のmacOS自動テストではHTTP/SSE、入力、添付、再開、パス変換、Windows向け起動コマンド生成を確認します。CIではWindows/macOS/LinuxとNode 22/24の組み合わせを検査します。Linux CIはWSL2そのものではなく、Linux上のBridgeとWSL用コマンド生成の検証です。CI設定を追加しただけの段階では、CI通過とは扱いません。

Windows/WSL2のタスクスケジューラ、端末の起動、Chromeと実Claude Codeの連携は実機確認が必要です。現在、この変更でのWindows/WSL2の実機連携確認は未実施です。確認したOS・Node・Chrome・Claude Codeのバージョンと結果を配布記録に残してください。

- [ ] ZIPを空白・日本語を含むローカルパスへ展開し、初期化と診断が成功する
- [ ] 短い要約と長い日本語会話が送信でき、回答が逐次表示される
- [ ] 添付を含む会話を送信できる
- [ ] General / Projectで追加指示、停止、Handoffができる
- [ ] Bridge再起動後もセッションが再表示・再開できる
- [ ] 「ターミナルで開く」とコピーしたコマンドで同じセッションを再開できる
- [ ] 自動起動登録、再ログイン、設定変更後の再登録、解除が動く
- [ ] 自動起動解除後にBridgeが停止し、同じポートで手動起動できる
- [ ] WSL2ではWindows側healthのworkspaceが対象Linux環境と一致する
- [ ] WSL2の拡張export後、Windows Chromeで読み込める
- [ ] WSL2の既定ディストリビューションが別でも、元のLinuxユーザー・セッションへ再開できる
- [ ] WSL2用タスクがWindowsログイン時に対象ディストリビューションを起動し、解除後はBridgeが停止する
- [ ] 旧版からの更新後、設定・Chromeのセッション索引が維持される

Claudeのセッションディレクトリ名は非英数字を`-`へ変換して参照します。これはCLIの内部保存形式への依存です。CLI更新、非常に長いパス、ドライブ文字の表記変更で再開できなくなった場合は、実際の`~/.claude/projects`と照合してから配布してください。

社内連携の設定や認証情報は共有ZIPへ追加せず、各利用者または社内管理の仕組みで配ります。現在の配布方式は手動読み込みです。Chromeの組織ポリシーに基づく一斉配布は別途準備が必要です。
