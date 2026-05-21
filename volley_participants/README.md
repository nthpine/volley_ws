# volley_participants

バレーボール参加管理の **閲覧専用** サイト（GitHub Pages）です。カレンダーと参加者一覧を表示し、登録・変更は GAS の一括登録ページで行います。

| 用途 | URL |
|------|-----|
| 閲覧（このリポジトリ） | https://nthpine.github.io/volley_participants/ |
| 一括登録・変更（GAS） | `config.js` の `BULK_REGISTER_URL`（Web アプリ exec URL） |

データの正本はリポジトリ内の [`data/calendar.json`](data/calendar.json) です。GAS の `?action=export` と GitHub Actions で更新します。

---

## 初回セットアップ

### 1. GitHub リポジトリ

```bash
cd volley_participants
git init
git remote add origin https://github.com/nthpine/volley_participants.git
git add .
git commit -m "feat: GitHub Pages 閲覧サイトを追加"
git push -u origin main
```

### 2. GitHub Pages

1. リポジトリ **Settings → Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` / **Folder**: `/ (root)`
4. 保存後、数分で https://nthpine.github.io/volley_participants/ が公開されます

### 3. Actions 用シークレット

1. **Settings → Secrets and variables → Actions → New repository secret**
2. 名前: `VOLLEY_EXPORT_URL`
3. 値: GAS Web アプリの exec URL に `?action=export` を付けたもの

例:

```text
https://script.google.com/macros/s/xxxxxxxx/exec?action=export
```

`config.js` の `LIVE_EXPORT_URL` と同じ URL にしてください。

### 4. 初回 JSON の投入

次のいずれかで `data/calendar.json` を埋めます。

**A. GitHub Actions（推奨）**

1. 上記シークレットを設定したあと
2. **Actions → Sync calendar → Run workflow**

**B. 手動**

1. GAS エディタで `exportCalendarJsonForPages` を実行するか、ブラウザで export URL を開く
2. 出力 JSON を `data/calendar.json` に保存して commit & push

**C. clasp（ローカル）**

```bash
cd ../volley_gas
clasp run exportCalendarJsonForPages
# 出力を data/calendar.json にコピーして commit
```

---

## GAS 側（volley_gas）のデプロイ

`doGet` のルーティング変更を反映するため、**新バージョン**で Web アプリを再デプロイしてください。

```bash
cd ../volley_gas
clasp push
```

Apps Script コンソール:

1. **デプロイ → デプロイを管理**
2. 既存の Web アプリ → **編集** → バージョン **新規** → **デプロイ**

| `?action=` | 内容 |
|------------|------|
| `export` | Pages 用 JSON |
| （省略） | 一括登録 UI（`BulkIndex.html`） |

再デプロイ後、`config.js` の URL が変わった場合は `LIVE_EXPORT_URL` / `BULK_REGISTER_URL` とシークレット `VOLLEY_EXPORT_URL` を更新してください。

---

## 運用

| 操作 | 説明 |
|------|------|
| 閲覧サイトの「更新」 | `LIVE_EXPORT_URL` から最新 JSON を取得し、端末の localStorage を更新（Actions 待ち不要） |
| Actions「Sync calendar」 | リポジトリの `calendar.json` を更新（全員に反映） |
| cron | 1 時間ごとに自動同期（`sync-calendar.yml`） |

**注意**: Pages の `calendar.json` は Actions が走るまで古い場合があります。すぐ最新が必要なときは閲覧サイトの「更新」を使うか、Actions の頻度を上げてください。一括登録直後は Actions を手動実行するか、「更新」でライブ取得してください。

---

## ローカル確認

静的ファイルのみのため、簡易サーバーで確認できます。

```bash
npx --yes serve .
# http://localhost:3000 を開く
```

`data/calendar.json` が空のときはカレンダーが空です。export URL または Actions で JSON を用意してください。

---

## ファイル構成

```text
index.html          閲覧 UI
app.js              カレンダー描画・モーダル（JSON の participantsByGroup を使用）
styles.css          スタイル
config.js           DATA_URL / LIVE_EXPORT_URL / BULK_REGISTER_URL
data/calendar.json  正本データ
.github/workflows/sync-calendar.yml
```
