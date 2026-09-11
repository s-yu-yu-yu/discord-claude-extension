# Discord Claude Extension

Discord Webのメッセージを起点にClaude Codeへ作業を依頼し、その作業を継続・発展させるためのChrome拡張とローカル実行環境。

## Language

**Source Message**:
Claudeへの依頼の起点としてユーザーが選択したDiscordメッセージ。
_Avoid_: Target Message, Original Message

**Message Context**:
Claudeへ渡すために選択された、Source Messageとその関連Discordメッセージの集合。
_Avoid_: Chat Log, History

**Reply Chain**:
Source Messageと同じ返信系統からなるMessage Context。親方向の祖先と、Source Messageから派生する子孫を含み、兄弟分岐は含まない。
_Avoid_: Thread

**Context Expansion**:
周辺メッセージや、Discord上で新たに増えた差分を、Message Contextへ明示的に追加する操作。
_Avoid_: Sync, Auto Sync

**Source Link**:
Message Context内の各Discordメッセージへ直接戻るためのDiscord permalink。
_Avoid_: Reference URL

**Claude Session**:
Source Messageから始まり、追加指示を続けられる、再開可能なClaude Code上の作業単位。
_Avoid_: Job, Task, Thread

**Current Session**:
Side Panelで現在開かれており、新しいSource Messageや追加指示を受け取れるClaude Session。
_Avoid_: Active Job

**General Workspace**:
特定のProjectを指定しないClaude Sessionが利用する、既定の作業コンテキスト。
_Avoid_: Default Project

**Project**:
コード変更を伴う作業の対象としてユーザーが選択するGitリポジトリ。
_Avoid_: Workspace, Repo Workspace

**General Session**:
General Workspaceで開始され、特定のProjectに属さないClaude Session。
_Avoid_: Default Session

**Project Session**:
特定のProjectを対象として開始され、そのProjectでのコード作業を担うClaude Session。
_Avoid_: Repo Session

**Handoff**:
General Sessionで得た調査結果・決定事項・Source Link・次の作業を、新しいProject Sessionへ引き継ぐための構造化された情報。
_Avoid_: Migration, Session Move

**Action Preset**:
DiscordからClaudeへ依頼するときに選択できる、Bridge側で管理された再利用可能な指示テンプレート。
_Avoid_: Command, Shortcut

**Bridge**:
Chrome拡張からの依頼を受け取り、Claude Codeの実行とClaude Sessionへの接続を担うローカルネットワーク上のサービス。
_Avoid_: Backend, Bot
