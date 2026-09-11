# Discord → Claude Code 連携 Chrome拡張 要件定義

## 1. 概要

Discord Web上のメッセージを起点として、Chrome拡張からローカル/LAN内のClaude Codeへ処理を依頼する。

Discord Botとしてサーバーに参加させるのではなく、ユーザーが閲覧しているDiscord WebのUIへ「Claudeに送る」アクションを追加し、選択したメッセージと必要な会話コンテキストをClaude Codeへ渡す。

主な用途は次のとおり。

- Discord上の議論を調査・要約・批評する
- Discord上の会話をJiraチケットやGitHub Issueへ変換する
- 調査結果をもとに追加指示を出す
- 調査から実装作業へ移行し、PR作成までClaude Codeへ依頼する
- 必要に応じて同じClaude Codeセッションをターミナルで再開し、本格的な作業へ移行する

---

## 2. 基本方針

### 2.1 対応環境

- v1は**Google Chromeのみ**
- 対象は**Discord Web**
- Claude Codeはローカルまたは同一LAN内の別PCで実行する
- Chrome拡張とClaude Codeの間に専用の**Bridgeサーバー**を置く

### 2.2 システム構成

```text
Discord Web
  ↓
Chrome Extension
  ↓ HTTP
Claude Bridge
  ↓
Claude Code
  ↓
MCP / GitHub / Jira / Web / Local Files
```

Bridgeの接続先は、Chrome拡張の設定画面でIPアドレスやURLを手入力する。

v1では、LAN内Bridgeへの認証は設けない。

---

## 3. Discord UI連携

### 3.1 Claudeアクション

Discordメッセージへホバーしたときに表示される既存のアクション群に、独自の**Claudeボタン**を追加する。

想定位置:

```text
リアクション / 返信 / その他 / Claude
```

Claudeボタンを押すと、そのメッセージを起点とした送信UIを表示する。

### 3.2 送信UI

送信UIには次の要素を含む。

- 対象Discordメッセージのプレビュー
- 定型アクション
- 自由入力欄
- コンテキスト概要
- コンテキスト確認・調整
- プロジェクト選択
- 実行ボタン

通常操作ではコンテキスト全文を表示せず、必要な場合のみ展開する。

---

## 4. 定型アクション

定型アクションと自由入力を併用する。

初期想定:

- Jiraに起票
- GitHub Issue化
- 要約
- 調査
- 批評
- 自由入力

定型アクションはChrome拡張へハードコードせず、**Bridge側の設定ファイル**で管理する。各アクションは、表示名とClaudeへ渡すプロンプトテンプレートを持つ。

---

## 5. Discordコンテキスト取得

### 5.1 デフォルト取得範囲

#### 通常メッセージ

対象メッセージ**1件のみ**を取得する。

#### 返信メッセージ

次のメッセージを自動取得する。

1. 対象メッセージ
2. 対象から親方向へ、返信元をルートまで再帰的に取得
3. 対象メッセージへの返信を子方向へ再帰的に取得

兄弟分岐は含めない。

例:

```text
A
└ B
   ├ C ← 対象
   │  └ E
   └ D
```

対象がCの場合:

```text
A → B → C → E
```

Dは含めない。

### 5.2 周辺メッセージ追加

デフォルトでは前後メッセージを取得しない。ユーザーが必要と判断した場合のみ、次の操作ができる。

- 前5件を追加
- 後5件を追加

その後も、5件単位で追加取得できるものとする。

### 5.3 コンテキスト調整

取得したメッセージは送信前に確認・調整できる。メッセージ単位で次の操作ができる。

- ON/OFF
- 前後メッセージの追加取得

返信チェーンは、自動選択された状態で表示する。

### 5.4 長い返信チェーン

返信チェーンは原則すべて取得する。ただし、**20件以上**の場合は警告を表示する。

例:

```text
返信チェーンに24件のメッセージが含まれています。
[そのまま使用] [コンテキストを調整]
```

送信自体は禁止しない。

### 5.5 Discordコンテキストの追加取得方式

基本的にはDiscord Web上のDOMから取得する。DOMだけでは必要なメッセージを取得できない場合は、ブラウザ側で利用できるDiscordのクライアントデータ/APIを使って追加取得を試みる。

取得に失敗した場合:

- 取得できた範囲は利用可能
- 不足していることをUI上で明示
- Claudeへの送信は禁止しない

---

## 6. Discordメッセージ情報

Claudeへ渡す各Discordメッセージには、可能な限り次の情報を含める。

- 投稿本文
- 投稿者
- 投稿日時
- チャンネル情報
- Discord permalink
- Embed / リンク
- 添付ファイル情報

**取得したすべてのメッセージにDiscord permalinkを付与する。**

特に対象投稿のURLは必須とする。これにより、ClaudeがJiraやGitHub Issueを作成するときに、元のDiscord投稿への参照を記載できるようにする。

---

## 7. 添付ファイル

### 7.1 Claudeへ実体を渡すもの

次のファイルはBridge側へ一時取得し、Claude Codeから参照できるようにする。

- 画像
- PDF
- テキスト
- ソースコード
- JSON / CSV / ログ等のテキスト系ファイル
- その他、小容量でClaude Codeから扱う価値のあるファイル

### 7.2 実体を取得しないもの

次のような大容量メディアは自動取得しない。

- 動画
- 音声
- その他、大容量メディアファイル

これらについては、次の情報だけをClaudeへ渡す。

- ファイル名
- URL
- MIME Type
- サイズ等の取得可能なメタ情報

### 7.3 一時ファイル保持

取得した添付ファイルはBridge側の一時ディレクトリへ保存し、**24時間後に自動削除**する。

---

## 8. Claude Codeセッション

### 8.1 初回実行

Discordから初めて送信した時点で新しいClaude Codeセッションを開始し、初回依頼ごとに独立したセッションとする。

### 8.2 セッション継続

Claudeから結果が返った後、Side Panelから同じセッションへ追加指示を送信できる。

例:

```text
Discord:
「この不具合について調査して」
    ↓
Claude:
調査結果
    ↓
ユーザー:
「この内容でJiraに起票して」
    ↓
Claude:
Jira作成
    ↓
ユーザー:
「このRepoで修正してPRにして」
```

この一連のやり取りでは、同じ作業コンテキストを維持する。

### 8.3 Discord最新コンテキストの追加

Claudeセッションの継続中にDiscord側の会話が進んでも、自動では取り込まない。取り込むときは、Side Panelから明示的に「**Discordの最新コンテキストを追加**」を実行する。

追加時は次の順で処理する。

1. 元Discord投稿周辺を再取得
2. 前回送信済みコンテキストとの差分を抽出
3. 差分一覧を表示
4. ユーザーがメッセージ単位でON/OFF
5. 選択内容を既存Claudeセッションへ投入

### 8.4 別Discord投稿の追加

Side PanelでClaudeセッションを開いている場合は、別のDiscordメッセージのClaudeボタンから「**現在のセッションに追加**」を選択できるようにする。通常は新規セッションを開始する。

---

## 9. セッション一覧・保存期間

### 9.1 Side Panel

Claudeセッション一覧は、Chrome Side Panelを中心となるUIとする。

表示例:

```text
ログイン不具合の原因調査
実行中

新企画について調査
2時間前

APIエラー調査
昨日
```

### 9.2 タイトル

セッションタイトルは、初回の内容をもとにClaudeが短く自動生成する。手動編集機能はv1では不要とする。

### 9.3 セッション保存期間

Chrome拡張独自のアーカイブ期間は設けず、Claude Code側のセッション保存期間に追従する。現在の利用環境では7日間だが、拡張側に7日という固定値は持たせない。

Side Panelを開いたときにClaude Code側にセッションが存在するかを確認し、すでに存在しないセッションは一覧から自動的に除去する。

- Archived状態は作らない
- 手動削除UIは作らない

拡張側では、Claude Codeセッションを参照するための索引情報だけを保持する。

---

## 10. Side Panel

### 10.1 初回送信

DiscordからClaudeへ送信した直後にSide Panelを自動で開き、そのセッションを表示する。ユーザーは実行中でもDiscordの別チャンネルへ移動できる。

### 10.2 ストリーミング

Claude Codeの出力は、リアルタイムにSide Panelへストリーミングする。BridgeはClaude Codeのstreaming出力をChrome拡張へ転送する。

### 10.3 ツール実行表示

Claude Codeの詳細ログを常時全面表示するのではなく、ツール実行を簡略化して表示する。

例:

```text
● Webを検索
● Jiraを確認
● src/auth.tsを編集
```

必要に応じて詳細を展開できるようにする。

### 10.4 最終回答

Claudeの回答はMarkdownとしてレンダリングする。

対応対象:

- 見出し
- リスト
- リンク
- コードブロック
- 引用
- テーブル等

結果には**クリップボードへコピーするボタン**を設ける。Discordへの自動投稿機能はv1では持たない。

---

## 11. 複数セッション

Claude Codeセッションは複数を同時に実行できるものとし、Bridge側では並列実行数を制限しない。各セッションは完全に独立したClaude Codeプロセスとして扱う。

拡張アイコンには、完了したがまだ確認していないセッションの数をバッジ表示する。OSデスクトップ通知は使用しない。

---

## 12. 実行停止

実行中のClaude CodeセッションはSide Panelから停止できる。停止で中断するのは現在実行中の処理だけであり、セッション自体は維持する。停止後も、同じセッションへ追加指示を送信できるものとする。

---

## 13. Claude Code権限

ファイル編集、Git操作、MCP操作等のClaude Code権限は、**ユーザーが現在Claude Codeで利用しているpermission設定をそのまま使用する。**

Chrome拡張独自の権限モデルは作らない。

---

## 14. Workspace / Project

### 14.1 一般Workspace

Repoを指定しない通常の処理では、専用WorkspaceでClaude Codeを起動する。

例:

```text
~/claude-discord-workspace/
```

用途:

- Web調査
- Jira操作
- 要約
- 批評
- 一般的な作業

このWorkspaceには、必要に応じて次のものを配置できる。

- CLAUDE.md
- MCP設定
- Claude Code設定
- その他、このツール専用のコンテキスト

### 14.2 Project指定

送信UIでは通常「**一般**」を選択状態にし、必要な場合のみプロジェクトSelectorを開いて対象Repoを指定する。

### 14.3 Project一覧

プロジェクト一覧はBridge側で生成する。設定されたProject Root配下を探索し、`.git`が存在するディレクトリだけをProjectとして認識する。探索深度は設定できる。

デフォルト:

```text
depth: 2
```

会社プロジェクトなど、複数Repoを同一ディレクトリ配下で管理している環境を想定する。

---

## 15. 一般調査からRepo実装への移行

一般Workspaceで開始したClaudeセッションから、途中で特定Repoの実装へ移る場合は、同じセッションへRepoを追加するのではなく、**対象Repoをcwdとした新規Claude Codeセッションを作成する。**

### 15.1 Handoff

元Claudeセッションに、実装セッション向けの構造化handoffを生成させる。

最低限含める情報:

- 調査結果
- 決定事項
- 元Discord投稿URL
- 関連Discord投稿URL
- Jira / GitHub等の関連リンク
- 現在判明している問題
- 次に実行すべき作業

新しいRepoセッションには、このhandoffを初期コンテキストとして渡す。

### 15.2 セッション関係

調査セッションと実装セッションは両方保持する。Side Panel上では通常の一覧として表示し、実装セッションには**元セッションへのリンク**を表示する。ツリーUIは不要とする。

---

## 16. ターミナルへの引き継ぎ

Claude Codeセッションは、Side Panelからターミナル作業へ移行できるようにする。

### 同一PCの場合

BridgeからローカルTerminalを起動し、対象セッションをresumeする。

### 別PCの場合

次に相当するresumeコマンドをコピーできるようにする。

```bash
claude --resume <session-id>
```

これにより、次のフローが可能になる。

```text
Discordから軽く依頼
↓
Side Panelで調査・追加指示
↓
作業が大きくなる
↓
ターミナルClaude Codeへ引き継ぎ
```

---

## 17. エラー処理

### 17.1 Bridge未接続

Bridgeへ接続できない場合は、次のように表示する。

```text
Claude Bridgeに接続できません
[接続設定を開く]
```

### 17.2 Discordコンテキスト不足

追加コンテキスト取得に失敗した場合:

- 取得できなかった範囲を明示
- 取得済みコンテキストは利用可能
- 送信可能

### 17.3 Claude Code実行エラー

Claude CodeまたはMCP等で処理が失敗した場合:

- エラー内容を表示
- その実行は終了

v1では次の機能を用意しない。

- 自動リトライ
- 再実行ボタン
- 新規セッションでの再実行ボタン

ユーザーは必要に応じて、通常の追加指示を送る。

---

## 18. Bridge設定

Bridgeの設定はWeb UIではなく**設定ファイル**で管理する。

想定例:

```yaml
host: 0.0.0.0
port: 3456

workspace: /path/to/claude-discord-workspace

projectRoots:
  - path: /path/to/company-projects
    depth: 2

actions:
  - id: jira
    label: Jiraに起票
    prompt: |
      Discordの会話をもとにJiraチケットを作成してください。
      元Discord投稿のURLをチケットへ記載してください。

  - id: research
    label: 調査
    prompt: |
      この内容について必要な調査を行ってください。
```

設定形式そのもの（YAML / TOML / JSON等）は実装時に決定する。

---

## 19. v1 非対象

次の項目はv1では実装しない。

- Discord Bot
- Discordへの自動返信・自動投稿
- Chrome以外のブラウザ正式対応
- クラウド上のClaude Bridge
- インターネット越しのBridge利用
- Bridge認証
- Bridge自動検出
- OSデスクトップ通知
- Claudeセッションの手動削除
- 独自アーカイブ機能
- 大容量動画・音声ファイルのClaudeへの自動転送
- 複雑なJira専用フォーム
- Claude Codeとは別のpermissionシステム

---

## 20. v1主要ユーザーフロー

### Flow A: Discord投稿を調査

```text
Discordメッセージへホバー
↓
Claudeボタン
↓
「調査」を選択
↓
必要なら追加指示
↓
送信
↓
Side Panelが開く
↓
Claudeの調査状況をストリーミング
↓
結果表示
```

### Flow B: 返信議論をJira化

```text
返信メッセージへホバー
↓
Claudeボタン
↓
親方向 + 子方向の返信チェーンを自動取得
↓
20件以上なら警告
↓
必要ならコンテキスト調整
↓
「Jiraに起票」
↓
Claude Code
↓
Jira作成
↓
結果 + Jira URLをSide Panelへ表示
```

### Flow C: 調査から実装へ

```text
Discord
↓
「調査」
↓
Claude調査セッション
↓
追加指示:
「これ修正したい」
↓
対象Projectを指定
↓
構造化handoffを生成
↓
Repoをcwdとした新規Claudeセッション
↓
実装
↓
テスト
↓
PR作成
```

### Flow D: ターミナルへ移行

```text
Side Panelで作業
↓
作業が複雑化
↓
「ターミナルで開く」
↓
claude --resume <session-id>
↓
通常のClaude Code CLIで作業継続
```

### Flow E: 別Discord投稿を既存調査へ追加

```text
Side Panelで調査セッションを開いている
↓
Discordの別投稿へ移動
↓
Claudeボタン
↓
「現在のセッションに追加」
↓
コンテキスト確認
↓
既存Claudeセッションへ追加
```

---

## 21. 実装時判断として残す項目

次の項目は、要件を変えない範囲で実装時に決定する。

- Chrome拡張のUI実装方式
- Discord Action Bar検出の具体的なDOMセレクタ
- Shadow DOM利用範囲
- Bridgeの実装言語・ランタイム
- Bridgeとのストリーミング通信方式
  - SSE
  - WebSocket
  - その他
- Bridge設定ファイル形式
- Terminalアプリの起動方法
- Claude出力streamの具体的な変換処理
- Discordクライアント側から追加メッセージを取得する具体的方法
- コンテキストサイズ警告に将来トークン量を併用するか
- Side Panelの詳細なビジュアルデザイン

---

## 22. v1完了条件

最低限、次の項目が一連の流れとして動作すること。

1. Discord WebのメッセージにClaudeボタンが表示される
2. 通常投稿を単体でClaudeへ送信できる
3. 返信投稿では指定ルールの返信チェーンを取得できる
4. コンテキストをメッセージ単位で調整できる
5. 前後5件を追加取得できる
6. Discord permalinkがClaudeへ渡る
7. 画像・PDF等の添付をClaude Codeから参照できる
8. Bridge経由でClaude Codeの新規セッションを開始できる
9. Claude出力をSide Panelへストリーミングできる
10. 同じセッションへ追加指示できる
11. 複数セッションを同時実行できる
12. Claude実行を途中停止し、その後同一セッションを継続できる
13. Side Panelから結果をコピーできる
14. 一般Workspaceと指定Repoを切り替えられる
15. 一般セッションからRepoセッションへhandoffできる
16. Claude Codeセッションをターミナルへ引き継げる
17. Claude Code側で消えたセッションがSide Panelから自動除去される
18. Bridge未接続時に設定画面へ誘導できる
