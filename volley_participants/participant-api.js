/**
 * 参加状況: Supabase（正本）+ GAS（非同期バックアップ）
 */
(function (global) {
  'use strict';

  var STATUS_LABEL = { 1: '○', 2: '△', 3: '✕' };

  function getParticipationApiUrl() {
    var cfg = global.CONFIG || {};
    return String(cfg.BULK_REGISTER_URL || cfg.PARTICIPATION_API_URL || '').trim();
  }

  function getParticipationApiToken() {
    var cfg = global.CONFIG || {};
    return String(cfg.PARTICIPATION_API_TOKEN || '').trim();
  }

  function getSupabaseConfig() {
    var cfg = global.CONFIG || {};
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/$/, '');
    var key = String(cfg.SUPABASE_ANON_KEY || '').trim();
    if (!url || !key) {
      throw new Error('Supabase の URL または anon キーが未設定です（config.js）');
    }
    return { url: url, key: key };
  }

  function supabaseHeaders(key) {
    return {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    };
  }

  function statusLabelFromCode(status) {
    return STATUS_LABEL[status] || String(status);
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

  function postGasActionFireAndForget(payload) {
    postGasAction(payload).catch(function () {
      /* GAS バックアップ失敗は UI に影響しない */
    });
  }

  function upsertParticipations(rows) {
    var sb = getSupabaseConfig();
    var url =
      sb.url +
      '/rest/v1/volley_participations?on_conflict=schedule_id,name';
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(sb.key), {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(rows),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('参加状況の保存に失敗しました（HTTP ' + res.status + '）');
        });
      }
    });
  }

  /**
   * @param {string} scheduleId
   * @param {string} name
   * @param {number} status 1=○ 2=△ 3=✕
   * @param {string} remark
   * @returns {Promise<{ok: boolean, result: Object}>}
   */
  function saveParticipationRemote(scheduleId, name, status, remark) {
    var now = new Date().toISOString();
    var row = {
      schedule_id: scheduleId,
      name: name,
      status: status,
      remark: remark || '',
      updated_at: now,
    };
    return upsertParticipations([row]).then(function () {
      var result = {
        name: name,
        status: status,
        statusLabel: statusLabelFromCode(status),
        remark: remark || '',
        scheduleId: scheduleId,
      };
      postGasActionFireAndForget({
        action: 'saveParticipation',
        scheduleId: scheduleId,
        name: name,
        status: status,
        remark: remark || '',
      });
      return { ok: true, result: result };
    });
  }

  global.saveParticipationRemote = saveParticipationRemote;
})(typeof window !== 'undefined' ? window : this);
