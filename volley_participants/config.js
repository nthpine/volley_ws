/**
 * GitHub Pages 閲覧サイトの設定
 * LIVE_EXPORT_URL / BULK_REGISTER_URL は GAS Web アプリの exec URL に合わせて更新してください。
 */
var CONFIG = {
  /** リポジトリ内の正本 JSON（GitHub Actions が更新） */
  DATA_URL: './data/calendar.json',
  /**
   * GAS ?action=export（設定時は「更新」ボタンで Actions 待ちなしに最新取得）
   * 例: https://script.google.com/macros/s/xxxx/exec?action=export
   */
  LIVE_EXPORT_URL:
    'https://script.google.com/macros/s/AKfycbx9rT2wowTFLXWxLLM_X30s_b1uWE2ukl9S6e-8XFzSdBYhXykzfTluKp5fgERrq99a/exec?action=export',
  /** 一括登録 UI（GAS Web アプリの exec URL、クエリなし） */
  BULK_REGISTER_URL:
    'https://script.google.com/macros/s/AKfycbx9rT2wowTFLXWxLLM_X30s_b1uWE2ukl9S6e-8XFzSdBYhXykzfTluKp5fgERrq99a/exec',
};
