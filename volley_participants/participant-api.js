/**
 * GAS Web アプリへ参加状況を POST（閲覧サイトからのステータス変更）
 */
(function (global) {
  'use strict';

  function getParticipationApiUrl() {
    var cfg = global.CONFIG || {};
    return String(cfg.BULK_REGISTER_URL || cfg.PARTICIPATION_API_URL || '').trim();
  }

  function getParticipationApiToken() {
    var cfg = global.CONFIG || {};
    return String(cfg.PARTICIPATION_API_TOKEN || '').trim();
  }

  /**
   * @param {string} scheduleId
   * @param {string} name
   * @param {number} status 1=○ 2=△ 3=✕
   * @param {string} remark
   * @returns {Promise<{ok: boolean, result?: Object, schedule?: Object, participants?: Array, error?: string}>}
   */
  function saveParticipationRemote(scheduleId, name, status, remark) {
    var url = getParticipationApiUrl();
    if (!url) {
      return Promise.reject(new Error('参加状況 API の URL が未設定です（config.js）'));
    }

    var payload = {
      action: 'saveParticipation',
      scheduleId: scheduleId,
      name: name,
      status: status,
      remark: remark || '',
    };
    var token = getParticipationApiToken();
    if (token) {
      payload.token = token;
    }

    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (parseErr) {
            throw new Error('サーバー応答の解析に失敗しました');
          }
          if (!data || !data.ok) {
            throw new Error((data && data.error) || '保存に失敗しました');
          }
          return data;
        });
      });
  }

  global.saveParticipationRemote = saveParticipationRemote;
})(typeof window !== 'undefined' ? window : this);
