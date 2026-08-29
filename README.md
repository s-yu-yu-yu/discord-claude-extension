# Discord Claude Extension

Discord Web のメッセージを Source Message として選び、ローカルの Bridge から Claude Code の General Session に送る Chrome 拡張です。v1 は Google Chrome と Discord Web を対象にし、Discord Bot や Bridge 認証は使用しません。

## 構成

```text
Discord Web (content script)
  -> Chrome extension service worker (HTTP + SSE)
  -> Claude Bridge (Node HTTP)
  -> claude CLI (stream-json + partial messages)
  -> Chrome Side Panel
```

## セットアップ

### 1. Bridge

Node.js 20 以上と、ログイン済みの Claude Code CLI が必要です。

```sh
cp bridge/config.example.json bridge/config.json
# config.json の workspace と必要な projectRoots を編集
node bridge/src/index.js --config bridge/config.json
```

`config.json` は JSON 形式です。LAN 上の別 PC から接続する場合は `host` を `0.0.0.0` にし、ファイアウォールで `port`（既定 3456）への接続を許可してください。Bridge は設定された `workspace` を cwd として `claude -p ... --output-format stream-json --verbose --include-partial-messages` を起動し、Claude Code の既存の permission 設定をそのまま利用します。

設定例:

```json
{
  "host": "127.0.0.1",
  "port": 3456,
  "workspace": "/Users/me/claude-discord-workspace",
  "projectRoots": [],
  "actions": [
    {
      "id": "research",
      "label": "調査",
      "prompt": "この内容について必要な調査を行ってください。"
    }
  ]
}
```

`claudeCommand` を設定すると、CLI の場所やテスト用のラッパーを変更できます。

### 2. Chrome 拡張

1. Chrome で `chrome://extensions` を開く
2. デベロッパーモードを有効にする
3. 「パッケージ化されていない拡張機能を読み込む」から、このリポジトリの `extension` ディレクトリを選ぶ
4. 拡張の設定画面で Bridge URL（既定 `http://127.0.0.1:3456`）を保存する
5. Discord Web を再読み込みする

Discord のメッセージをホバーすると Claude ボタンが表示されます。押すと Source Message の確認、Action Preset の選択、自由入力の指示を行えます。送信後は Side Panel が開き、Current Session の Claude 出力を SSE で受け取って Markdown 表示し、最終回答をコピーできます。

## 開発コマンド

```sh
npm test       # Bridge の HTTP/SSE と prompt の代表テスト
npm run lint   # JavaScript の構文、manifest、必須ファイルの検査
npm run build  # dist/extension に読み込み可能な拡張を生成
npm run typecheck # JS-only 構成のため構文検査を実行
```

`build` は `dist/extension` を毎回生成します。Bridge は実行時に設定ファイルを読み込むため、Bridge 自体のバンドルは不要です。

## v1 の境界

- Issue #1 では Discord Web の現在ロード済み DOM から Source Message 1件のみを取得します。Reply Chain と Message Context の調整は後続 Issue #3 の対象です。
- 大量に仮想化された未表示メッセージや添付ファイルの実体取得は行いません。
- Claude Code CLI の `stream-json` 出力（`stream_event` 内の partial delta と後続の assistant 全文を含む）を delta / tool / result に正規化します。CLI のバージョン差で未知のイベントが来た場合は既知のテキストフィールドを試します。
- Issue #1 の Side Panel は Current Session のストリーム表示と最終回答コピーに絞っています。セッション一覧、停止、追加指示、再接続は後続 Issue の対象です。
- 自動リトライ、Discord への投稿、Bridge 認証、手動セッション削除は v1 の対象外です。
