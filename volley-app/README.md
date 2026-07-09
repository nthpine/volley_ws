# バレーボール参加管理（Vercel）

参加カレンダーと一括登録をまとめた静的アプリです。

| 画面 | パス |
|------|------|
| 参加カレンダー | `/` |
| 一括登録 | `/bulk` |

## データの流れ

```text
閲覧・一括登録 UI → docs.google.com (gviz CSV) → スプレッドシート（読取）
個別・一括保存     → GAS Web アプリ doPost     → スプレッドシート（書込）
```

- 読取: `CONFIG.SPREADSHEET_ID` の公開スプレッドシート
- 書込: `CONFIG.GAS_API_URL`（`saveParticipation` / `saveParticipationBulk` / `registerMember`）

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
