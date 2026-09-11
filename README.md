# Discord Claude Extension

Discord Webのメッセージにマウスを乗せると出る「Claude」ボタンから、その会話を自分のPCのClaude Codeへ渡すChrome拡張です。返事はChromeの右側（Side Panel）に流れてきて、そのまま続けて指示も出せます。

```text
Discord Webのメッセージ → Chrome拡張 → Bridge（自分のPCで動く小さなサーバー） → Claude Code → Side Panelに返事
```

Discord Botではありません。Discordサーバー側の設定は不要で、Discordへ投稿もしません。

## できること

- Discordの会話を選んで**要約・調査・批評**してもらう
- 会話から**JiraチケットやGitHub Issue**を起票してもらう（各自のClaude CodeにJira MCPや`gh`の設定がある場合）
- 返信チェーンや前後のメッセージ、添付ファイル（画像・PDF・テキストなど）もまとめて渡せる
- 返事を読んだあと、**同じセッションに追加指示**を出す
- 調査結果を引き継いで、**Gitリポジトリでの実装作業**に切り替える（Handoff）
- 同じセッションを**ターミナルのClaude Code**で続ける

操作の詳細は[使い方ガイド](docs/usage.md)にあります。

## 必要なもの

| 必要なもの | 補足 |
| --- | --- |
| Google ChromeとDiscord Webへのログイン | Discordデスクトップアプリは対象外です |
| Claude Code（ログイン済み） | Claude DesktopアプリのCodeタブ、またはターミナルの`claude`を使います。Bridgeが使う`claude`コマンドが未導入なら、セットアップを任せたClaudeが[公式インストーラー](https://code.claude.com/docs/en/setup)での導入を案内します |
| Node.js 22以上 | [nodejs.org](https://nodejs.org/en/download)のインストーラーで導入します。会社の指定があればそれに従ってください |

対応環境はmacOS、Windows、WSL2です。Claude CodeやNodeの導入は、セットアップを任せるClaudeに相談できます（後述）。

## ダウンロード

Gitは不要です。ブラウザで[Releases](https://github.com/s-yu-yu-yu/discord-claude-extension/releases/latest)を開き、Assetsの`discord-claude-extension-<バージョン>.zip`をダウンロードして展開します。Windowsでは、ZIPを右クリックして「すべて展開」を選びます。

展開したフォルダは、今後も使い続ける場所（例: ホームフォルダ内の`apps`）に置いてください。ダウンロードフォルダや一時フォルダから直接使うと、あとで自動起動やChrome拡張の再登録が必要になります。

## セットアップ

### A. Claudeに任せる（おすすめ）

Bridgeの設定・起動確認・ツール許可の設定は、Claude Codeに任せられます。展開したフォルダをClaude Codeで開き、下のプロンプトを貼り付けてください。

Claude Codeを開く方法はどちらでも構いません。

- **Claude Desktopアプリ**: 上部の**Code**タブを開き、環境で「ローカル」（WSL2の人は「WSL」）を選び、「フォルダを選択」で展開したフォルダを開く
- **ターミナル**: 展開したフォルダで`claude`を実行する

**Claude Coworkでは実行できません**。Coworkは隔離された仮想環境で動くため、あなたのPC上でBridgeを起動・常駐させられません。必ずCodeタブかターミナルのClaude Codeを使ってください。

```text
このフォルダの docs/ai-setup.md を読み、Discord Claude Bridge をセットアップしてください。
- 既存の Claude Code の認証・設定を使い、Mac / Windows / WSL2 を判別してください
- 既存の Bridge 設定があれば保持してください
- 使いたいツールは「Web検索・GitHub Issue・Jira」のうち（ここに書く）です。
  その許可設定も docs/ai-setup.md の手順どおりに作ってください
- ログイン時の自動起動は（希望する / しない）
- Chrome など私の操作が必要な部分は、手順を1つずつ具体的に案内してください
- 最後に、確認できた項目と残っている操作を報告してください
```

括弧の部分は自分の希望に書き換えてください。Claudeは環境確認、`bridge/config.json`の作成、Bridgeの起動確認、`.claude/settings.json`へのツール許可の追加までを進めます。途中で「Chromeにログインしてください」「ターミナルで`claude`を実行してログインしてください」のように、あなたの操作が必要な場面を案内します。

Chrome拡張の読み込みだけはChromeの画面操作が必要なので、Claudeの案内に沿って自分で行います。

1. Chromeで`chrome://extensions`を開き、右上の「デベロッパーモード」をオンにする
2. 「パッケージ化されていない拡張機能を読み込む」を押し、展開したフォルダの中の`extension`フォルダを選ぶ（WSL2の人はClaudeが表示するWindows側のパス）
3. 拡張の「詳細」→「拡張機能のオプション」で、Bridge URLが`http://127.0.0.1:3456`になっていることを確認して保存し、「接続テスト」を押す
4. Discord Webを再読み込みし、メッセージにマウスを乗せてClaudeボタンを押す
5. 最初は短いメッセージの「要約」を試す

### B. 自分で進める

手動で進める場合や、Claudeの案内内容を確認したい場合は、[導入ガイド](docs/setup.md)を参照してください。WSL2の人は[WSL2手順](docs/setup-wsl2.md)も読んでください。

## 困ったとき

| 症状 | まず見るところ |
| --- | --- |
| 「Claude Bridgeに接続できません」 | Bridgeが起動しているか確認します。展開フォルダで`node scripts/doctor.mjs`を実行してください |
| Claudeボタンが出ない | Discord Webを再読み込みします。拡張を再読み込みしたあとも、Discordの再読み込みが必要です |
| 「〇〇の実行権限が許可されていない」と返る | ツール許可が未設定です。セットアップ用プロンプトをもう一度Claudeに渡し、必要なツールを伝えてください |
| その他 | [導入ガイドのよくある問題](docs/setup.md#よくある問題)、[使い方ガイドのうまくいかないとき](docs/usage.md#7-うまくいかないとき) |

## データの扱いと注意

- 選んだ会話・関連メッセージ・添付は、あなたのClaude Codeに渡ります。送信前に対象を確認してください。
- Bridgeに認証はありません。設定の`host`は`127.0.0.1`のまま、自分のPCだけで使ってください。
- Claudeの権限（ファイル編集、git、MCPなど）は、いつも使っているClaude Codeの設定がそのまま使われます。詳細は[導入ガイドの「社内で扱うデータ」](docs/setup.md#社内で扱うデータ)を参照してください。

## 開発者向け

このリポジトリをcloneして開発する場合のコマンドです。利用者はZIPを使うので、これらの実行は不要です。

```sh
npm test          # Bridge の HTTP/SSE と prompt の代表テスト
npm run lint      # JavaScript の構文、manifest、必須ファイルの検査
npm run build     # dist/extension に読み込み可能な拡張を生成
npm run package   # 配布 ZIP を dist/ に生成
```

`bridge/config.example.json`をコピーして`bridge/config.json`を作り、`node bridge/src/index.js`でBridgeを起動します。Chromeには`extension/`を直接読み込めます。

| ドキュメント | 内容 |
| --- | --- |
| [docs/reference.md](docs/reference.md) | `config.json`の全キー、ツール許可、添付・セッション再開の内部動作、対象外の機能 |
| [docs/distribution.md](docs/distribution.md) | リリース（ZIP公開）の手順と実機確認表 |
| [docs/requirements.md](https://github.com/s-yu-yu-yu/discord-claude-extension/blob/main/docs/requirements.md) | 要件定義 |
| [CONTEXT.md](https://github.com/s-yu-yu-yu/discord-claude-extension/blob/main/CONTEXT.md) | 用語集（Source Message、Claude Session、Handoffなど） |

Windows / WSL2での実Claude・Chrome連携は、実機確認が未完了です。確認項目は[docs/distribution.md](docs/distribution.md)にあります。
