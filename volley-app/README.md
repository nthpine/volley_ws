# バレーボール参加管理（Vercel）

参加カレンダーと一括登録をまとめた静的アプリです。

| 画面 | パス |
|------|------|
| 参加カレンダー | `/` |
| 一括登録 | `/bulk` |

## データの流れ

```text
日程・名前マスタ   → docs.google.com (gviz CSV) → スプレッドシート（読取）
参加状況（正本）   → Supabase PostgREST          → volley_participations
個別・一括保存     → Supabase upsert（完了で返す）→ GAS へ非同期バックアップ
名前登録           → GAS Web アプリ doPost         → スプレッドシート（members）
```

- 日程・名前: `CONFIG.SPREADSHEET_ID` の公開スプレッドシート（`schedules` / `members` / `config`）
- 参加状況: `CONFIG.SUPABASE_URL` + `CONFIG.SUPABASE_ANON_KEY`（`volley_participations` テーブル）
- バックアップ: `CONFIG.GAS_API_URL`（`saveParticipation` / `saveParticipationBulk` は保存後に非同期送信）
- 名前登録: `CONFIG.GAS_API_URL`（`registerMember` は GAS 完了を待つ）
- 予約行の過去削除: バレー SS 側 GAS [`volley_gas`](../volley_gas/) の `deleteSchedulesOnOrBeforeYesterday`（毎日 0 時・`installDeletePastSchedulesTrigger`）
- **予約申込・取消（バレー）**: [`volley_gas`](../volley_gas/) の `harp_email_sync.js` が Gmail から **schedules を直接**更新（正本）。マスター [`config_gas`](../config_gas/) の e-harp 同期は任意のフォローアップ（ラベル `harp-schedules-done` はバレー側 `harp-volley-done` と別）

## ローカル確認

```bash
npx --yes serve volley-app
```

- カレンダー: http://localhost:3000/
- 一括登録: http://localhost:3000/bulk.html（本番では `/bulk`）

## デプロイ

Root Directory を `volley-app` にした Vercel プロジェクトとしてデプロイします。

```bash
cd volley-app
vercel --prod
```

## 旧サイト

[`volley_participants/`](../volley_participants/) は GitHub Pages 互換として残しています。本番は本 Vercel アプリを利用してください。
