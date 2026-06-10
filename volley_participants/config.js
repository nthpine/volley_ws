/**
 * バレーボール参加管理（閲覧サイト）設定
 * データは Google スプレッドシートを gviz CSV で直接取得（spreadsheet-viewer 方式）
 */
var CONFIG = {
  /** 参加管理スプレッドシート ID */
  SPREADSHEET_ID: '13bYkVraCvuwbf2cCCGhXfAmfVtZ3znbv7fdq-anxovU',
  SHEET_NAMES: {
    schedules: 'schedules',
    participants: 'participants',
    members: 'members',
    config: 'config',
  },
  /** IndexedDB キャッシュ有効期限（ミリ秒） */
  CACHE_TTL_MS: 10 * 60 * 1000,
  /** 一括登録 UI・参加状況 API（GAS Web アプリ exec URL） */
  BULK_REGISTER_URL:
    'https://script.google.com/macros/s/AKfycbx9rT2wowTFLXWxLLM_X30s_b1uWE2ukl9S6e-8XFzSdBYhXykzfTluKp5fgERrq99a/exec',
  /** 任意: GAS Script Properties の PARTICIPATION_API_SECRET と同じ値 */
  PARTICIPATION_API_TOKEN: '',
};
