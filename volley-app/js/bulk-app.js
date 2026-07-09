/**
 * 一括登録画面（1人選択 → 全日程テーブル → 一括保存）
 */
(function () {
  'use strict';

  var DEFAULT_TIME_SLOT = '19:15-21:45';
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var STATE = {
    members: [],
    schedules: [],
    participantsByGroup: {},
    range: null,
    bulkViewMode: 'confirmed',
    bulkRows: [],
    generatedAt: null,
  };

  function bootBulk() {
    var calendarLink = document.getElementById('calendarLink');
    if (calendarLink) {
      calendarLink.href = (CONFIG && CONFIG.CALENDAR_PAGE_PATH) || '/';
    }
    document.getElementById('bulkTabConfirmed').addEventListener('click', function () {
      setBulkViewMode('confirmed');
    });
    document.getElementById('bulkTabAll').addEventListener('click', function () {
      setBulkViewMode('all');
    });
    document.getElementById('memberRegisterBtn').addEventListener('click', onMemberRegister);
    document.getElementById('memberRegisterInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onMemberRegister();
      }
    });
    document.getElementById('bulkMemberSelect').addEventListener('change', onMemberChange);
    document.getElementById('bulkSubmitBtn').addEventListener('click', onBulkSubmit);
    document.getElementById('refreshBulkBtn').addEventListener('click', function () {
      loadBundle({ skipCache: true });
    });
    document.getElementById('bulkTableBody').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('bulk-remark-input')) {
        e.preventDefault();
      }
    });
    loadBundle({ skipCache: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBulk);
  } else {
    bootBulk();
  }

  function setLoading(show) {
    document.getElementById('loadingArea').style.display = show ? 'flex' : 'none';
    document.getElementById('bulkArea').style.display = show ? 'none' : 'block';
  }

  function setRefreshBusy(busy) {
    var btn = document.getElementById('refreshBulkBtn');
    var spinner = document.getElementById('refreshSpinner');
    if (btn) btn.disabled = !!busy;
    if (spinner) spinner.style.display = busy ? 'block' : 'none';
  }

  function showError(msg) {
    var area = document.getElementById('errorArea');
    if (!msg) {
      area.innerHTML = '';
      return;
    }
    area.innerHTML = '<div class="error-banner">' + escapeHtml(msg) + '</div>';
  }

  function showBulkMessage(msg, isError) {
    var el = document.getElementById('bulkFormMessage');
    el.textContent = msg || '';
    el.className = 'form-message' + (msg ? (isError ? ' err' : ' ok') : '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadBundle(opts) {
    opts = opts || {};
    var initial = document.getElementById('bulkArea').style.display === 'none';
    if (initial) {
      setLoading(true);
    } else {
      setRefreshBusy(true);
    }
    showError('');
    showBulkMessage('', false);

    loadVolleyCalendarBundle({ skipCache: !!opts.skipCache })
      .then(function (data) {
        STATE.members = (data && data.members) || [];
        STATE.schedules = (data && data.schedules) || [];
        STATE.participantsByGroup = (data && data.participantsByGroup) || {};
        STATE.range = (data && data.range) || null;
        STATE.generatedAt = (data && data.generatedAt) || null;
        fillMemberSelect(document.getElementById('bulkMemberSelect').value);
        setLoading(false);
        setRefreshBusy(false);
        rebuildTable();
      })
      .catch(function (err) {
        setLoading(false);
        setRefreshBusy(false);
        showError(err.message || String(err));
      });
  }

  function fillMemberSelect(currentValue) {
    var sel = document.getElementById('bulkMemberSelect');
    sel.innerHTML = '<option value="">選択してください</option>';
    (STATE.members || []).forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });
    if (currentValue && (STATE.members || []).indexOf(currentValue) >= 0) {
      sel.value = currentValue;
    }
  }

  function setBulkViewMode(mode) {
    mode = mode === 'all' ? 'all' : 'confirmed';
    if (STATE.bulkViewMode === mode) return;
    STATE.bulkViewMode = mode;
    document.querySelectorAll('.bulk-view-tab').forEach(function (btn) {
      var active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var hint = document.getElementById('bulkViewHint');
    if (hint) {
      hint.textContent =
        mode === 'all'
          ? '当月・来月の全日程を表示します。体育館未定の日は「未定」です。'
          : '体育館の予約が確定している日程のみ表示します。';
    }
    showBulkMessage('', false);
    rebuildTable();
  }

  function onMemberChange() {
    showBulkMessage('', false);
    rebuildTable();
  }

  function groupKey(dateLabel, timeSlot) {
    if (typeof volleyScheduleTimeGroupKey === 'function') {
      return volleyScheduleTimeGroupKey(dateLabel, timeSlot);
    }
    return String(dateLabel || '').trim() + '\x1f' + String(timeSlot || '').trim();
  }

  function findMemberParticipation(gKey, memberName) {
    var list = STATE.participantsByGroup[gKey] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === memberName) return list[i];
    }
    return null;
  }

  function uniqueLocations(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (s) {
      var loc = String(s.location || '').trim();
      if (!loc || seen[loc]) return;
      seen[loc] = true;
      out.push(loc);
    });
    return out;
  }

  function formatLocationsHtml(locations, isTentative) {
    if (isTentative) {
      return '<span class="bulk-loc-tentative">未定</span>';
    }
    var locs = locations || [];
    if (!locs.length) {
      return '';
    }
    return locs
      .map(function (loc) {
        return '<span class="bulk-loc-line">' + escapeHtml(loc) + '</span>';
      })
      .join('');
  }

  function buildRowFromGroup(list, memberName) {
    var sorted = (list || []).slice().sort(function (a, b) {
      var la = String(a.location || '');
      var lb = String(b.location || '');
      if (la !== lb) return la.localeCompare(lb, 'ja');
      return String(a.scheduleId || '').localeCompare(String(b.scheduleId || ''), 'ja');
    });
    var first = sorted[0];
    var gKey = groupKey(first.dateLabel, first.timeSlot);
    var participation = memberName ? findMemberParticipation(gKey, memberName) : null;
    var locs = uniqueLocations(sorted);
    return {
      groupKey: gKey,
      primaryScheduleId: first.scheduleId,
      dateLabel: first.dateLabel,
      dateIso: first.dateIso,
      timeSlot: String(first.timeSlot || '').trim(),
      locations: locs,
      locationSummary: locs.length ? locs.join(' / ') : '',
      isTentative: false,
      status: participation ? participation.status : null,
      remark: participation ? participation.remark || '' : '',
      hasRegistration: !!participation,
    };
  }

  function formatDateLabelFromDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var w = WEEKDAYS[d.getDay()];
    return y + '/' + m + '/' + day + '(' + w + ')';
  }

  /** 一括テーブル表示用: 年なしの短い日付 */
  function formatBulkDateLabel(dateLabel, dateIso) {
    if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      var parts = dateIso.split('-');
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return Number(parts[1]) + '/' + Number(parts[2]) + '(' + WEEKDAYS[d.getDay()] + ')';
    }
    var s = String(dateLabel || '').trim();
    var m = s.match(/(\d{1,2})\/(\d{1,2})\s*\(([^)]+)\)/);
    if (m) return Number(m[1]) + '/' + Number(m[2]) + '(' + m[3] + ')';
    return s.replace(/^\d{4}\//, '');
  }

  /** 一括テーブル表示用: 時間帯を改行しやすい形に */
  function formatBulkTimeSlot(timeSlot) {
    return String(timeSlot || '')
      .trim()
      .replace(/\s*[-–—～〜~]\s*/g, '-');
  }

  function formatDateIso(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function iterateFutureDaysInRange(range) {
    if (!range) return [];
    var start = new Date(range.startYear, range.startMonth - 1, 1);
    var end = new Date(range.endYear, range.endMonth, 0);
    var today = startOfToday();
    var days = [];
    var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur <= end) {
      if (cur >= today) {
        days.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function buildConfirmedRows(memberName) {
    var groupsMap = {};
    (STATE.schedules || []).forEach(function (s) {
      var gKey = groupKey(s.dateLabel, s.timeSlot);
      if (!groupsMap[gKey]) groupsMap[gKey] = [];
      groupsMap[gKey].push(s);
    });
    var keys = Object.keys(groupsMap);
    keys.sort(function (ka, kb) {
      var a = groupsMap[ka][0];
      var b = groupsMap[kb][0];
      if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
      return String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''), 'ja');
    });
    return keys.map(function (k) {
      return buildRowFromGroup(groupsMap[k], memberName);
    });
  }

  function buildAllRows(memberName) {
    var confirmed = buildConfirmedRows(memberName);
    var byIsoTime = {};
    confirmed.forEach(function (row) {
      byIsoTime[row.dateIso + '\x1f' + row.timeSlot] = row;
    });
    var rows = [];
    var included = {};
    iterateFutureDaysInRange(STATE.range).forEach(function (d) {
      var dateIso = formatDateIso(d);
      var key = dateIso + '\x1f' + DEFAULT_TIME_SLOT;
      if (byIsoTime[key]) {
        rows.push(byIsoTime[key]);
        included[byIsoTime[key].groupKey] = true;
        return;
      }
      // 同日に別時間帯の確定がある場合は未定行を足さない（確定行は後で追加）
      var hasAnyConfirmedSameDay = Object.keys(byIsoTime).some(function (k) {
        return k.indexOf(dateIso + '\x1f') === 0;
      });
      if (hasAnyConfirmedSameDay) return;

      var dateLabel = formatDateLabelFromDate(d);
      var gKey = groupKey(dateLabel, DEFAULT_TIME_SLOT);
      var participation = memberName ? findMemberParticipation(gKey, memberName) : null;
      var row = {
        groupKey: gKey,
        primaryScheduleId: '',
        dateLabel: dateLabel,
        dateIso: dateIso,
        timeSlot: DEFAULT_TIME_SLOT,
        locations: [],
        locationSummary: '未定',
        isTentative: true,
        status: participation ? participation.status : null,
        remark: participation ? participation.remark || '' : '',
        hasRegistration: !!participation,
      };
      rows.push(row);
      included[gKey] = true;
    });

    confirmed.forEach(function (row) {
      if (!included[row.groupKey]) {
        rows.push(row);
        included[row.groupKey] = true;
      }
    });

    rows.sort(function (a, b) {
      if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
      return String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''), 'ja');
    });
    return rows;
  }

  function rebuildTable() {
    var memberName = document.getElementById('bulkMemberSelect').value.trim();
    var hint = document.getElementById('bulkTableHint');
    var empty = document.getElementById('bulkTableEmpty');
    var wrap = document.getElementById('bulkTableWrap');
    var tbody = document.getElementById('bulkTableBody');

    if (!memberName) {
      STATE.bulkRows = [];
      hint.style.display = 'block';
      empty.style.display = 'none';
      wrap.style.display = 'none';
      tbody.innerHTML = '';
      return;
    }

    hint.style.display = 'none';
    STATE.bulkRows =
      STATE.bulkViewMode === 'all' ? buildAllRows(memberName) : buildConfirmedRows(memberName);

    if (!STATE.bulkRows.length) {
      empty.style.display = 'block';
      wrap.style.display = 'none';
      tbody.innerHTML = '';
      return;
    }

    empty.style.display = 'none';
    wrap.style.display = 'block';
    tbody.innerHTML = '';
    STATE.bulkRows.forEach(function (row, index) {
      var tr = document.createElement('tr');
      if (row.isTentative) tr.className = 'row-tentative';
      var statusName = 'bulk-status-' + index;
      var checked1 = row.status === 1 ? ' checked' : '';
      var checked2 = row.status === 2 ? ' checked' : '';
      var checked3 = row.status === 3 ? ' checked' : '';
      var regBadge = row.hasRegistration ? '' : '<span class="bulk-reg-badge">未登録</span>';
      tr.innerHTML =
        '<td class="col-date" data-label="日付">' +
        '<span class="bulk-date-text">' +
        escapeHtml(formatBulkDateLabel(row.dateLabel, row.dateIso)) +
        '</span></td>' +
        '<td class="col-time" data-label="時間帯">' +
        '<span class="bulk-time-text">' +
        escapeHtml(formatBulkTimeSlot(row.timeSlot)) +
        '</span></td>' +
        '<td class="col-loc" data-label="場所">' +
        formatLocationsHtml(row.locations, row.isTentative) +
        '</td>' +
        '<td class="col-status" data-label="ステータス">' +
        regBadge +
        '<div class="bulk-status-group">' +
        '<label class="status-option confirmed"><input type="radio" name="' +
        statusName +
        '" value="1"' +
        checked1 +
        ' /><span title="参加">○</span></label>' +
        '<label class="status-option pending"><input type="radio" name="' +
        statusName +
        '" value="2"' +
        checked2 +
        ' /><span title="調整中">△</span></label>' +
        '<label class="status-option absent"><input type="radio" name="' +
        statusName +
        '" value="3"' +
        checked3 +
        ' /><span title="不参加">✕</span></label>' +
        '</div></td>' +
        '<td class="col-remark" data-label="備考"><input type="text" class="bulk-remark-input" value="' +
        escapeHtml(row.remark || '') +
        '" placeholder="任意" enterkeyhint="done" /></td>';
      tr.dataset.dateLabel = row.dateLabel || '';
      tr.dataset.timeSlot = row.timeSlot || '';
      tbody.appendChild(tr);
    });
  }

  function collectBulkUpdates() {
    var tbody = document.getElementById('bulkTableBody');
    var trs = tbody.querySelectorAll('tr');
    var updates = [];
    var rows = STATE.bulkRows || [];
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var checked = tr.querySelector('input[type="radio"]:checked');
      if (!checked) continue;
      var remarkInput = tr.querySelector('.bulk-remark-input');
      var newStatus = Number(checked.value);
      var newRemark = remarkInput ? remarkInput.value.trim() : '';
      var original = rows[i];
      if (
        original &&
        original.hasRegistration &&
        original.status === newStatus &&
        String(original.remark || '') === newRemark
      ) {
        continue;
      }
      updates.push({
        dateLabel: tr.dataset.dateLabel || '',
        timeSlot: tr.dataset.timeSlot || '',
        status: newStatus,
        remark: newRemark,
      });
    }
    return updates;
  }

  function onBulkSubmit() {
    var memberName = document.getElementById('bulkMemberSelect').value.trim();
    if (!memberName) {
      showBulkMessage('名前を選択してください。', true);
      return;
    }
    var updates = collectBulkUpdates();
    if (!updates.length) {
      showBulkMessage(
        '保存する行がありません。未登録の日程を含め、○△✕のいずれかを選んだ行を送信してください。',
        true
      );
      return;
    }

    var btn = document.getElementById('bulkSubmitBtn');
    btn.disabled = true;
    btn.classList.add('is-loading');
    showBulkMessage('保存中…', false);

    saveParticipationBulkRemote(memberName, updates)
      .then(function (data) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        var n = (data && data.updated) || updates.length;
        showBulkMessage(n + ' 件保存しました。', false);
        return loadVolleyCalendarBundle({ skipCache: true }).then(function (bundle) {
          STATE.members = (bundle && bundle.members) || STATE.members;
          STATE.schedules = (bundle && bundle.schedules) || STATE.schedules;
          STATE.participantsByGroup =
            (bundle && bundle.participantsByGroup) || STATE.participantsByGroup;
          STATE.range = (bundle && bundle.range) || STATE.range;
          fillMemberSelect(memberName);
          rebuildTable();
        });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        showBulkMessage(err.message || String(err), true);
      });
  }

  function onMemberRegister() {
    var input = document.getElementById('memberRegisterInput');
    var name = input.value.trim();
    if (!name) {
      showBulkMessage('参加者名を入力してください。', true);
      return;
    }
    var btn = document.getElementById('memberRegisterBtn');
    btn.disabled = true;
    registerMemberRemote(name)
      .then(function (data) {
        btn.disabled = false;
        if (data.members && data.members.length) {
          STATE.members = data.members;
        } else if (STATE.members.indexOf(name) === -1) {
          STATE.members = STATE.members.concat([name]).sort(function (a, b) {
            return a.localeCompare(b, 'ja');
          });
        }
        fillMemberSelect(name);
        input.value = '';
        showBulkMessage(data.message || '登録しました。', false);
        rebuildTable();
      })
      .catch(function (err) {
        btn.disabled = false;
        showBulkMessage(err.message || String(err), true);
      });
  }
})();
