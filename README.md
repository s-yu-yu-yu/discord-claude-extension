# Discord Claude Extension

Discord Web のメッセージにマウスを乗せると出る「Claude」ボタンから、その会話を自分の PC の Claude Code に渡す Chrome 拡張です。返事は Chrome の右側（Side Panel）に流れてきて、続けて指示も出せます。

```text
Discord Web のメッセージ → Chrome 拡張 → Bridge（自分の PC で動く小さなサーバー） → Claude Code → Side Panel に返事
```

Discord Bot ではありません。Discord サーバー側の設定は不要で、Discord へ投稿もしません。

## できること

- Discord の会話を選んで **要約・調査・批評** してもらう
- 会話から **Jira チケット / GitHub Issue** を起票してもらう（各自の Claude Code に Jira MCP や `gh` の設定がある場合）
- 返信チェーンや前後のメッセージ、添付ファイル（画像・PDF・テキストなど）もまとめて渡せる
- 返事を読んだあと、**同じセッションに追加指示**を出す
- 調査結果を引き継いで、**Git リポジトリでの実装作業**に切り替える（Handoff）
- 同じセッションを **ターミナルの Claude Code で続ける**

操作の詳細は [使い方ガイド](docs/usage.md) にあります。

## 必要なもの

| 必要なもの | 補足 |
| --- | --- |
| Google Chrome と Discord Web へのログイン | Discord デスクトップアプリは対象外 |
| Claude Code（ログイン済み） | Claude Desktop アプリの Code タブ、またはターミナルの `claude`。Bridge が使う `claude` コマンドが未導入なら、セットアップを任せた Claude が[公式インストーラー](https://code.claude.com/docs/en/setup)での導入を案内します |
| Node.js 22 以上 | [nodejs.org](https://nodejs.org/en/download) のインストーラーで導入。会社の指定があればそれに従う |

対応環境は macOS、Windows、WSL2 です。Claude Code や Node の導入はセットアップを任せる Claude に相談できます（後述）。

## ダウンロード

Git は不要です。ブラウザで [Releases](https://github.com/s-yu-yu-yu/discord-claude-extension/releases/latest) を開き、Assets の `discord-claude-extension-<バージョン>.zip` をダウンロードして展開します。このリポジトリは社内限定なので、GitHub にログインし、リポジトリへのアクセス権が必要です。

展開したフォルダは、今後も使い続ける場所（例: ホームフォルダ内の `apps`）へ置いてください。ダウンロードフォルダや一時フォルダから直接使うと、後で自動起動や Chrome 拡張の再登録が必要になります。Windows では ZIP を右クリックして「すべて展開」を選びます。

## セットアップ

### A. Claude に任せる（おすすめ）

Bridge の設定・起動確認・ツール許可の設定は、Claude Code に任せられます。展開したフォルダを Claude Code で開いて、下のプロンプトを貼り付けてください。

Claude Code を開く方法はどちらでも構いません。

- **Claude Desktop アプリ**: 上部の **Code** タブ → 環境で「ローカル」（WSL2 の人は「WSL」）を選ぶ → 「フォルダを選択」で展開したフォルダを開く
- **ターミナル**: 展開したフォルダで `claude` を実行する

**Claude Cowork では実行できません。** Cowork は隔離された仮想環境で動くため、あなたの PC 上で Bridge を起動・常駐させることができません。必ず Code タブかターミナルの Claude Code を使ってください。

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

括弧の部分は自分の希望に書き換えてください。Claude が環境確認、`bridge/config.json` の作成、Bridge の起動確認、`.claude/settings.json` へのツール許可の追加までを進めます。途中で「Chrome にログインしてください」「ターミナルで `claude` を実行してログインしてください」のように、あなたの操作が必要な場面を案内します。

Chrome 拡張の読み込みだけは Chrome の画面操作が必要なので、Claude の案内に沿って自分で行います。

1. Chrome で `chrome://extensions` を開き、右上の「デベロッパーモード」をオンにする
2. 「パッケージ化されていない拡張機能を読み込む」を押し、展開したフォルダの中の `extension` フォルダを選ぶ（WSL2 の人は Claude が表示する Windows 側のパス）
3. 拡張の「詳細」→「拡張機能のオプション」で Bridge URL が `http://127.0.0.1:3456` になっていることを確認して保存し、「接続テスト」を押す
4. Discord Web を再読み込みし、メッセージにマウスを乗せて Claude ボタンを押す
5. 最初は短いメッセージの「要約」を試す

### B. 自分で進める

手動で進める場合や、Claude の案内内容を確認したい場合は [導入ガイド](docs/setup.md) を参照してください。WSL2 の人は [WSL2 手順](docs/setup-wsl2.md) も読んでください。

## 困ったとき

| 症状 | まず見るところ |
| --- | --- |
| 「Claude Bridge に接続できません」 | Bridge が起動しているか。展開フォルダで `node scripts/doctor.mjs` を実行 |
| Claude ボタンが出ない | Discord Web を再読み込み。拡張を再読み込みした後も Discord の再読み込みが必要 |
| 「〇〇 の実行権限が許可されていない」と返る | ツール許可が未設定。セットアップ用プロンプトを再度 Claude に渡し、必要なツールを伝える |
| その他 | [導入ガイドのよくある問題](docs/setup.md#よくある問題)、[使い方ガイドのうまくいかないとき](docs/usage.md#7-うまくいかないとき) |

## データの扱いと注意

- 選んだ会話・関連メッセージ・添付は、あなたの Claude Code に渡ります。送信前に対象を確認してください。
- Bridge に認証はありません。設定の `host` は `127.0.0.1` のまま、自分の PC だけで使ってください。
- Claude の権限（ファイル編集、git、MCP など）は、いつも使っている Claude Code の設定がそのまま使われます。詳細は [導入ガイドの「社内で扱うデータ」](docs/setup.md#社内で扱うデータ) を参照してください。

## 開発者向け

このリポジトリを clone して開発する場合のコマンドです。利用者は ZIP を使い、これらの実行は不要です。

```sh
npm test          # Bridge の HTTP/SSE と prompt の代表テスト
npm run lint      # JavaScript の構文、manifest、必須ファイルの検査
npm run build     # dist/extension に読み込み可能な拡張を生成
npm run package   # 配布 ZIP を dist/ に生成
```

`bridge/config.example.json` をコピーして `bridge/config.json` を作り、`node bridge/src/index.js` で Bridge を起動します。Chrome には `extension/` を直接読み込めます。

| ドキュメント | 内容 |
| --- | --- |
| [docs/reference.md](docs/reference.md) | `config.json` の全キー、ツール許可、添付・セッション再開の内部動作、対象外の機能 |
| [docs/distribution.md](docs/distribution.md) | リリース（ZIP 公開）の手順と実機確認表 |
| [docs/requirements.md](https://github.com/s-yu-yu-yu/discord-claude-extension/blob/main/docs/requirements.md) | 要件定義 |
| [CONTEXT.md](https://github.com/s-yu-yu-yu/discord-claude-extension/blob/main/CONTEXT.md) | 用語集（Source Message、Claude Session、Handoff など） |

Windows / WSL2 での実 Claude・Chrome 連携は実機確認が未完了です。確認項目は [docs/distribution.md](docs/distribution.md) にあります。
