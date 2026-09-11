# 配布担当者向け手順

配布物は、macOS・Windowsネイティブ・WSL2で共通のZIPです。Node.jsとClaude Codeは同梱せず、利用者が用意します。初回の配布は少人数の試用版として扱い、後述の実機確認を終えてから対象を広げてください。

## リリースする

配布ZIPはGitHub Actionsが作成し、[Releases](https://github.com/s-yu-yu-yu/discord-claude-extension/releases)に添付します。利用者はブラウザでダウンロードするだけで、Gitは使いません。

1. `package.json`と`extension/manifest.json`の`version`を同じ番号に更新し、mainへマージします。
2. mainで同じ番号のタグを付けてpushします。

```sh
git checkout main && git pull
git tag v0.3.0
git push origin v0.3.0
```

タグをpushすると、`.github/workflows/release.yml`がテスト・lint・`npm run package`を実行し、`discord-claude-extension-<version>.zip`と`.zip.sha256`を添付したReleaseを作成します。タグと`package.json`の版が違う場合は失敗します。Releaseの本文はコミットから自動生成されるので、必要なら利用者向けの変更点を追記してください。

ローカルで確認したい場合は、`npm run package`で`dist/`に同じZIPを作れます。ただし、作業ツリーの未コミットの変更も含まれるため、配布にはCIが作ったものを使ってください。

ZIPには必要なファイルだけをコピーするため、`bridge/config.json`、Claudeの設定・認証情報、履歴、ダウンロードした添付、`.git`は入りません。ZIP内の`SHA256SUMS.txt`は、同梱ファイルのハッシュ一覧です。ZIP自体のハッシュは、Windowsでは`Get-FileHash <ZIPのパス> -Algorithm SHA256`、macOSでは`shasum -a 256 <ZIPのパス>`で確認できます。

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
| `docs/reference.md` | 設定キーと内部動作のリファレンス |
| `README.md` | 入口となる文書。ダウンロード方法と、Claudeに任せるセットアップの案内 |

## 検証状況と実機確認

自動テストで確認できている範囲は次のとおりです。開発時のmacOSでの自動テストでは、HTTP/SSE、入力、添付、再開、パス変換、Windows向け起動コマンドの生成を確認しています。CIではWindows/macOS/LinuxとNode 22/24の組み合わせを検査します。ただし、LinuxのCIはWSL2そのものの検証ではなく、Linux上のBridgeとWSL用コマンド生成の検証です。CIの設定を追加しただけの段階では、CI通過とは扱いません。

一方、Windows/WSL2のタスクスケジューラ、端末の起動、Chromeと実際のClaude Codeの連携は、実機での確認が必要です。現時点では、この変更に対するWindows/WSL2の実機連携確認は未実施です。実機確認の際は、確認したOS・Node・Chrome・Claude Codeのバージョンと結果を配布記録に残してください。

- [ ] ZIPを空白・日本語を含むローカルパスへ展開し、初期化と診断が成功する
- [ ] 短い要約と長い日本語会話が送信でき、回答が逐次表示される
- [ ] 添付を含む会話を送信できる
- [ ] General / Projectで追加指示、停止、Handoffができる
- [ ] Bridgeを再起動した後も、セッションが一覧に再表示され、再開できる
- [ ] 「ターミナルで開く」でも、コピーしたコマンドでも、同じセッションを再開できる
- [ ] 自動起動の登録、再ログイン、設定変更後の再登録、解除が動く
- [ ] 自動起動を解除した後にBridgeが停止し、同じポートで手動起動できる
- [ ] WSL2では、Windows側から確認したhealthのworkspaceが対象のLinux環境と一致する
- [ ] WSL2で拡張をexportした後、Windows側のChromeで読み込める
- [ ] WSL2の既定ディストリビューションが別のものでも、元のLinuxユーザーとセッションで再開できる
- [ ] WSL2用のタスクがWindowsログイン時に対象ディストリビューションを起動し、解除した後はBridgeが停止する
- [ ] Discordを「アプリとしてインストール」したウィンドウから送信すると別ウィンドウで開き、時間を置いた2回目の送信でも同じウィンドウが再利用される（Windows / macOS）
- [ ] 旧版から更新した後も、設定とChromeのセッション索引が維持される

Bridgeは、Claudeのセッションディレクトリ名を、非英数字を`-`へ変換した名前で参照します。これはCLIの内部保存形式に依存した動作です。CLIの更新、非常に長いパス、ドライブ文字の表記変更で再開できなくなった場合は、実際の`~/.claude/projects`と照合してから配布してください。

社内連携の設定や認証情報は共有ZIPに入れず、各利用者自身か、社内管理の仕組みで配ります。現在の配布方式は拡張の手動読み込みです。Chromeの組織ポリシーに基づく一斉配布には、別途準備が必要です。
