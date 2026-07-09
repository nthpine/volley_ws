/**
 * GAS Web アプリへ参加状況を POST（個別・一括・名前登録）
 */
(function (global) {
  'use strict';

  function getParticipationApiUrl() {
    var cfg = global.CONFIG || {};
    return String(
      cfg.GAS_API_URL || cfg.BULK_REGISTER_URL || cfg.PARTICIPATION_API_URL || ''
    ).trim();
  }

  function getParticipationApiToken() {
    var cfg = global.CONFIG || {};
    return String(cfg.PARTICIPATION_API_TOKEN || '').trim();
  }

  function postGasAction(payload) {
    var url = getParticipationApiUrl();
    if (!url) {
      return Promise.reject(new Error('参加状況 API の URL が未設定です（config.js）'));
    }

    var body = Object.assign({}, payload);
    var token = getParticipationApiToken();
    if (token) {
      body.token = token;
    }

    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
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
      })
      .catch(function (err) {
        if (err && err.message) {
          throw err;
        }
        throw new Error(
          'サーバーへの接続に失敗しました。GAS Web アプリの再デプロイ後、ページを再読み込みしてください。'
        );
      });
  }

  /**
   * @param {string} scheduleId
   * @param {string} name
   * @param {number} status 1=○ 2=△ 3=✕
   * @param {string} remark
   */
  function saveParticipationRemote(scheduleId, name, status, remark) {
    return postGasAction({
      action: 'saveParticipation',
      scheduleId: scheduleId,
      name: name,
      status: status,
      remark: remark || '',
    });
  }

  /**
   * @param {string} memberName
   * @param {Array.<{dateLabel: string, timeSlot: string, status: number, remark?: string}>} updates
   */
  function saveParticipationBulkRemote(memberName, updates) {
    return postGasAction({
      action: 'saveParticipationBulk',
      memberName: memberName,
      updates: updates || [],
    });
  }

  /**
   * @param {string} name
   */
  function registerMemberRemote(name) {
    return postGasAction({
      action: 'registerMember',
      name: name,
    });
  }

  global.saveParticipationRemote = saveParticipationRemote;
  global.saveParticipationBulkRemote = saveParticipationBulkRemote;
  global.registerMemberRemote = registerMemberRemote;
})(typeof window !== 'undefined' ? window : this);
