# volley_participants（閲覧サイト）

バレーボール参加管理の **閲覧専用** サイト（GitHub Pages）です。  
[basket spreadsheet-viewer](../basket_ws/spreadsheet-viewer) と同様、**公開スプレッドシートを gviz CSV で直接読み** カレンダーと参加者一覧を表示します。

| 用途 | URL |
|------|-----|
| 閲覧 | https://nthpine.github.io/volley_ws/volley_participants/ |
| 一括登録・変更 | `config.js` の `BULK_REGISTER_URL`（GAS Web アプリ） |
| 詳細画面からのステータス変更 | 同上 GAS（`doPost` / `action: saveParticipation`） |

**誰かがシート（または GAS 一括登録）で参加状況を更新すると、次にページを開く／「更新」を押したタイミングで最新が表示されます。** GitHub Actions や `calendar.json` の手動同期は不要です。

---

## 前提（必須）

参加管理スプレッドシート（`CONFIG.SPREADSHEET_ID`）を次の設定にしてください。

1. **共有**: 「リンクを知っている全員が**閲覧者**」  
   （バスケの record シートと同じ。編集は GAS のみでも可）
2. シート名: `schedules` / `participants` / `members` / `config`（[`config.js`](config.js) と一致）

### 動作確認（デプロイ前）

ブラウザで次を開き、**CSV らしい文字列**（HTML ログイン画面ではない）が表示されること:

```text
https://docs.google.com/spreadsheets/d/13bYkVraCvuwbf2cCCGhXfAmfVtZ3znbv7fdq-anxovU/gviz/tq?tqx=out:csv&sheet=schedules
https://docs.google.com/spreadsheets/d/13bYkVraCvuwbf2cCCGhXfAmfVtZ3znbv7fdq-anxovU/gviz/tq?tqx=out:csv&sheet=participants
```

失敗する場合は共有設定またはシート名を見直してください。

---

## データの流れ

```text
閲覧サイト → docs.google.com (gviz CSV) → スプレッドシート
一括登録   → GAS Web アプリ → スプレッドシート（書き込み）
```

- 初回表示: スプレッドシートから取得（IndexedDB に最大 10 分キャッシュ）
- 「更新」ボタン: キャッシュを無視して再取得
- 一括登録後: 閲覧サイトで「更新」または再読み込みで反映

---

## GitHub Pages 公開

リポジトリ [`nthpine/volley_ws`](https://github.com/nthpine/volley_ws) のルートから公開します。

1. **Settings → Pages** → Branch: `main` / Folder: `/ (root)`
2. 閲覧 URL: https://nthpine.github.io/volley_ws/volley_participants/

```bash
cd volley_ws
git add volley_participants/
git commit -m "feat: gviz CSV でスプレッドシートから直接読み込み"
git push
```

---

## GAS（一括登録・ステータス変更 API）

[`volley_gas`](../volley_gas/) の `BulkIndex.html` が一括登録 UI です。

詳細画面からのステータス変更は、同じ Web アプリ URL へ POST します（`participant-api.js`）。

1. `volley_gas` を `clasp push`
2. Web アプリを **新バージョン**で再デプロイ（「自分として実行」「全員」）
3. 任意: Script Properties に `PARTICIPATION_API_SECRET` を設定し、`config.js` の `PARTICIPATION_API_TOKEN` に同じ値を入れる

**重要**: `clasp push` だけでは本番 URL は更新されません。必ず `clasp deploy -i <デプロイID>` で既存 Web アプリを再デプロイしてください。

`?action=export`（JSON エクスポート）は閲覧サイトでは **使いません**（予約同期 API 等で残している場合あり）。

---

## ファイル構成

```text
volley_participants/
  index.html
  config.js              SPREADSHEET_ID, シート名, BULK_REGISTER_URL
  spreadsheet-loader.js    gviz 取得 + カレンダー組み立て
  participant-api.js       参加状況の保存 API 呼び出し
  app.js                   UI（カレンダー・モーダル）
  styles.css
```

---

## ローカル確認

```bash
npx --yes serve volley_participants
```

※ スプレッドシートが閲覧可である必要があります。

### モック画面（push 前の確認用）

スプレッドシートなしで UI を確認する場合:

```text
http://localhost:3000/mock.html
```

- `mock.html` / `mock-data.js` は **本番 push 前に削除** してください
- 終了した週の行はカレンダーに表示されません（モックの「過去週」イベントも非表示）
