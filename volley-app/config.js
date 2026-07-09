/**
 * バレーボール参加管理（Vercel 統合アプリ）設定
 * 読取: Google スプレッドシート gviz CSV / 書込: GAS Web アプリ
 */
var CONFIG = {
  SPREADSHEET_ID: '13bYkVraCvuwbf2cCCGhXfAmfVtZ3znbv7fdq-anxovU',
  SHEET_NAMES: {
    schedules: 'schedules',
    participants: 'participants',
    members: 'members',
    config: 'config',
  },
  CACHE_TTL_MS: 10 * 60 * 1000,
  /** 参加状況 API（GAS Web アプリ exec URL） */
  GAS_API_URL:
    'https://script.google.com/macros/s/AKfycbx9rT2wowTFLXWxLLM_X30s_b1uWE2ukl9S6e-8XFzSdBYhXykzfTluKp5fgERrq99a/exec',
  /** 互換: 旧 config 名 */
  BULK_REGISTER_URL:
    'https://script.google.com/macros/s/AKfycbx9rT2wowTFLXWxLLM_X30s_b1uWE2ukl9S6e-8XFzSdBYhXykzfTluKp5fgERrq99a/exec',
  /** 任意: GAS Script Properties の PARTICIPATION_API_SECRET と同じ値 */
  PARTICIPATION_API_TOKEN: '',
  BULK_PAGE_PATH: '/bulk',
  CALENDAR_PAGE_PATH: '/',
};
