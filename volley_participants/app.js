(function () {
  'use strict';

  var STATE = {
    schedules: [],
    schedulesByDay: {},
    members: [],
    range: null,
    participantsByGroup: {},
    orgById: {},
    currentScheduleId: null,
    detailSiblings: [],
    generatedAt: null,
  };

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var HIGH_ATTENDANCE_THRESHOLD = 8;
  var CALENDAR_CACHE_KEY = 'volley_calendar_pages_v1';
  var CALENDAR_CACHE_MAX_BYTES = 4 * 1024 * 1024;
  var TODAY_MS = 0;

  function bindUiEvents() {
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('modalOverlay')) {
        closeModal();
      }
    });
    document.getElementById('refreshCalendarBtn').addEventListener('click', onRefreshCalendarClick);
    document.getElementById('calendarArea').addEventListener('click', onCalendarAreaClick);
    var bulkLink = document.getElementById('bulkRegisterLink');
    if (bulkLink && CONFIG.BULK_REGISTER_URL) {
      bulkLink.href = CONFIG.BULK_REGISTER_URL;
    }
  }

  function bootApp() {
    bindUiEvents();
    initCalendarOnLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
  } else {
    bootApp();
  }

  function onCalendarAreaClick(e) {
    var chip = e.target.closest('.event-chip');
    if (!chip || !chip.dataset.scheduleId) {
      return;
    }
    openDetail(chip.dataset.scheduleId);
  }

  function isCalendarDataEmpty(data) {
    return !(data && data.schedules && data.schedules.length > 0);
  }

  function initCalendarOnLoad() {
    var showedLocalCache = false;
    var raw = null;
    try {
      raw = localStorage.getItem(CALENDAR_CACHE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      var cached = null;
      try {
        cached = JSON.parse(raw);
      } catch (parseErr) {
        cached = null;
      }
      if (cached && cached.data && !isCalendarDataEmpty(cached.data)) {
        showedLocalCache = true;
        showCachedShellUI();
        document.getElementById('lastUpdatedLabel').textContent = '最新データを取得しています…';
        var run =
          window.requestAnimationFrame ||
          function (fn) {
            setTimeout(fn, 0);
          };
        run(function () {
          applyCalendarData(cached.data, {
            savedAt: cached.savedAt,
            fromCache: true,
            quiet: true,
          });
        });
      }
    }
    // F5 などページ再読み込みのたびにスプレッドシートから取得（IndexedDB は使わない）
    loadCalendar({
      showFullLoading: !showedLocalCache,
      skipCache: true,
    });
  }

  function showCachedShellUI() {
    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('calendarArea').style.display = 'grid';
  }

  function dayIndexKey(year, month, day) {
    return year + '\x1f' + month + '\x1f' + day;
  }

  function exportTimeGroupKey(schedule) {
    return (
      String(schedule.dateLabel || '').trim() +
      '\x1f' +
      String(schedule.timeSlot || '').trim()
    );
  }

  function calendarDisplayGroupKey(s) {
    return s.year + '-' + s.month + '-' + s.day + '\x1f' + String(s.timeSlot || '').trim();
  }

  function rebuildScheduleDayIndex() {
    var idx = {};
    (STATE.schedules || []).forEach(function (s) {
      var k = dayIndexKey(s.year, s.month, s.day);
      if (!idx[k]) {
        idx[k] = [];
      }
      idx[k].push(s);
    });
    STATE.schedulesByDay = idx;
  }

  function getSchedulesForDay(year, month, day) {
    return STATE.schedulesByDay[dayIndexKey(year, month, day)] || [];
  }

  function shiftCalendarMonth(year, month, delta) {
    var d = new Date(year, month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function getSchedulesForCardDay(cellYear, cellMonth, day, cardYear, cardMonth) {
    if (cellYear !== cardYear || cellMonth !== cardMonth) {
      return [];
    }
    return getSchedulesForDay(cellYear, cellMonth, day).filter(function (s) {
      return s.year === cardYear && s.month === cardMonth;
    });
  }

  function onRefreshCalendarClick() {
    loadCalendar({ showFullLoading: false, skipCache: true });
  }

  function finishLoadCalendar(data, opts) {
    var savedAt = saveCalendarCache(data);
    applyCalendarData(data, {
      savedAt: savedAt || data.generatedAt,
      fromCache: false,
      quiet: !opts.showFullLoading,
    });
    setRefreshLoading(false);
    if (!opts.showFullLoading) {
      showLoading(false);
    }
  }

  function loadCalendar(opts) {
    opts = opts || {};
    if (opts.showFullLoading) {
      showLoading(true);
    }
    setRefreshLoading(true);

    if (typeof loadVolleyCalendarBundle !== 'function') {
      setRefreshLoading(false);
      onError(new Error('spreadsheet-loader.js が読み込まれていません。'));
      return;
    }

    loadVolleyCalendarBundle({ skipCache: !!opts.skipCache })
      .then(function (data) {
        finishLoadCalendar(data, opts);
      })
      .catch(function (err) {
        setRefreshLoading(false);
        if (opts.showFullLoading) {
          onError(err);
        } else {
          onRefreshError(err);
        }
      });
  }

  function applyCalendarData(data, options) {
    options = options || {};
    data = data || {};
    STATE.schedules = data.schedules || [];
    STATE.members = data.members || [];
    STATE.range = data.range;
    STATE.participantsByGroup = data.participantsByGroup || {};
    STATE.orgById = data.orgById || {};
    STATE.generatedAt = data.generatedAt || null;
    rebuildScheduleDayIndex();

    if (data.range) {
      document.getElementById('periodLabel').textContent =
        formatYearMonth(data.range.startYear, data.range.startMonth) +
        ' 〜 ' +
        formatYearMonth(data.range.endYear, data.range.endMonth);
    } else {
      document.getElementById('periodLabel').textContent = '参加カレンダー';
    }

    updateLastUpdatedLabel(options.savedAt, options.fromCache);

    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('calendarArea').style.display = 'grid';
    renderCalendars();
    refreshModalIfOpen();

    if (!options.quiet) {
      showLoading(false);
    }
  }

  function refreshModalIfOpen() {
    if (!STATE.currentScheduleId) {
      return;
    }
    var local = STATE.schedules.find(function (s) {
      return s.scheduleId === STATE.currentScheduleId;
    });
    if (!local) {
      return;
    }
    STATE.detailSiblings = getSchedulesInSameTimeGroup(local);
    renderDetailFromSnapshot(local);
  }

  function saveCalendarCache(data) {
    var savedAt = data.generatedAt || new Date().toISOString();
    try {
      var payload = JSON.stringify({ savedAt: savedAt, data: data });
      if (payload.length > CALENDAR_CACHE_MAX_BYTES) {
        return savedAt;
      }
      localStorage.setItem(CALENDAR_CACHE_KEY, payload);
      return savedAt;
    } catch (e) {
      return savedAt;
    }
  }

  function updateLastUpdatedLabel(savedAt, fromCache) {
    var el = document.getElementById('lastUpdatedLabel');
    if (!savedAt) {
      el.textContent = fromCache ? 'キャッシュ表示（取得中…）' : '';
      return;
    }
    if (fromCache) {
      el.textContent = '最終取得: ' + formatCacheSavedAt(savedAt) + '（更新中…）';
      return;
    }
    el.textContent = '最終取得: ' + formatCacheSavedAt(savedAt);
  }

  function formatCacheSavedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso);
    }
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    var h = ('0' + d.getHours()).slice(-2);
    var min = ('0' + d.getMinutes()).slice(-2);
    return y + '/' + m + '/' + day + ' ' + h + ':' + min;
  }

  function setRefreshLoading(show) {
    var btn = document.getElementById('refreshCalendarBtn');
    var spinner = document.getElementById('refreshSpinner');
    btn.disabled = !!show;
    spinner.style.display = show ? 'block' : 'none';
  }

  function onRefreshError(err) {
    var el = document.getElementById('lastUpdatedLabel');
    var msg = err && err.message ? err.message : String(err);
    el.textContent = '更新に失敗しました: ' + msg;
  }

  function getSchedulesInSameTimeGroup(scheduleOrId) {
    var base =
      typeof scheduleOrId === 'object'
        ? scheduleOrId
        : STATE.schedules.find(function (s) {
            return s.scheduleId === scheduleOrId;
          });
    if (!base) {
      return [];
    }
    var key = calendarDisplayGroupKey(base);
    return STATE.schedules.filter(function (s) {
      return calendarDisplayGroupKey(s) === key;
    });
  }

  function formatOrgUsageLine(schedule) {
    var id = String(schedule.orgId || '').trim();
    if (!id) {
      return '';
    }
    var name = String(schedule.orgName || '').trim();
    return name ? id + '（' + name + '）' : id;
  }

  function buildGroupedScheduleDisplayHtml(schedules) {
    var list = (schedules || []).slice();
    if (!list.length) {
      return '';
    }
    var cols = list.length;
    var rowDefs = [
      {
        label: '場所：',
        values: list.map(function (s) {
          return String(s.location || '').trim() || '—';
        }),
      },
      {
        label: '面：',
        values: list.map(function (s) {
          return String(s.court || '').trim() || '全面';
        }),
      },
      {
        label: '利用情報：',
        values: list.map(function (s) {
          return formatOrgUsageLine(s) || '—';
        }),
      },
    ];
    var html =
      '<div class="schedule-group-grid schedule-group-grid--meta" style="--sg-cols:' +
      cols +
      '">';
    rowDefs.forEach(function (row) {
      html += '<div class="schedule-group-row">';
      html += '<span class="sg-label">' + escapeHtml(row.label) + '</span>';
      row.values.forEach(function (val) {
        html += '<span class="sg-cell">' + escapeHtml(val) + '</span>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function groupSchedulesForDisplay(schedules) {
    var map = {};
    (schedules || []).forEach(function (s) {
      var key = calendarDisplayGroupKey(s);
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(s);
    });
    return Object.keys(map).map(function (key) {
      return map[key];
    });
  }

  function aggregateGroupCounts(schedules) {
    var s = schedules && schedules.length ? schedules[0] : null;
    var confirmed = s ? s.confirmed || 0 : 0;
    var pending = s ? s.pending || 0 : 0;
    var absent = s ? s.absent || 0 : 0;
    var total = confirmed + pending;
    var parts = [];
    if (total > 0) {
      parts.push(pending > 0 ? total + '人(△' + pending + '人)' : total + '人');
    } else if (absent === 0) {
      parts.push('0人');
    }
    if (absent > 0) {
      parts.push('✕' + absent + '人');
    }
    return {
      confirmed: confirmed,
      pending: pending,
      absent: absent,
      total: total,
      countLabel: parts.join(' '),
    };
  }

  function formatChipCountHtml(agg) {
    var html = [];
    var active = (agg.confirmed || 0) + (agg.pending || 0);
    if (active > 0) {
      var text =
        agg.pending > 0 ? active + '人(△' + agg.pending + ')' : active + '人';
      html.push('<span class="count-active">' + escapeHtml(text) + '</span>');
    } else if (!(agg.absent > 0)) {
      html.push('<span class="count-active">' + escapeHtml('0人') + '</span>');
    }
    if (agg.absent > 0) {
      html.push(
        '<span class="count-absent">' + escapeHtml('✕' + agg.absent + '人') + '</span>'
      );
    }
    return html.join('');
  }

  function formatBulkTimeSlotHtml(timeSlot) {
    var t = String(timeSlot || '')
      .trim()
      .replace(/～/g, '-')
      .replace(/—/g, '-')
      .replace(/－/g, '-');
    var dash = t.indexOf('-');
    if (dash > 0) {
      return escapeHtml(t.slice(0, dash)) + '<br>' + escapeHtml(t.slice(dash));
    }
    return escapeHtml(t);
  }

  function renderCalendars() {
    var area = document.getElementById('calendarArea');
    area.innerHTML = '';
    area.style.display = 'grid';

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    TODAY_MS = today.getTime();

    var now = new Date();
    var m1 = { year: now.getFullYear(), month: now.getMonth() + 1 };
    var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var m2 = { year: next.getFullYear(), month: next.getMonth() + 1 };

    var frag = document.createDocumentFragment();
    frag.appendChild(buildMonthCalendar(m1.year, m1.month));
    frag.appendChild(buildMonthCalendar(m2.year, m2.month));
    area.appendChild(frag);
  }

  function buildMonthCalendar(year, month) {
    var card = document.createElement('section');
    card.className = 'month-card';

    var title = document.createElement('div');
    title.className = 'month-title';
    title.textContent = year + '年' + month + '月';
    card.appendChild(title);

    var weekdays = document.createElement('div');
    weekdays.className = 'weekdays';
    WEEKDAYS.forEach(function (wd, i) {
      var span = document.createElement('span');
      span.textContent = wd;
      if (i === 0) span.className = 'sun';
      if (i === 6) span.className = 'sat';
      weekdays.appendChild(span);
    });
    card.appendChild(weekdays);

    var daysGrid = document.createElement('div');
    daysGrid.className = 'days';

    var first = new Date(year, month - 1, 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(year, month, 0).getDate();

    var prevMonth = shiftCalendarMonth(year, month, -1);
    var prevMonthDays = new Date(year, month - 1, 0).getDate();
    for (var p = startPad - 1; p >= 0; p--) {
      daysGrid.appendChild(
        createDayCell(prevMonth.year, prevMonth.month, prevMonthDays - p, true, year, month)
      );
    }

    for (var d = 1; d <= daysInMonth; d++) {
      daysGrid.appendChild(createDayCell(year, month, d, false, year, month));
    }

    card.appendChild(daysGrid);
    return card;
  }

  function getDateKind(year, month, day) {
    var cellMs = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
    if (cellMs < TODAY_MS) {
      return 'past';
    }
    if (cellMs === TODAY_MS) {
      return 'today';
    }
    return 'future';
  }

  function createDayCell(year, month, day, isOther, cardYear, cardMonth) {
    var cell = document.createElement('div');
    var classes = ['day-cell'];
    if (isOther) {
      classes.push('other-month');
    }
    var kind = getDateKind(year, month, day);
    if (kind === 'past') {
      classes.push('past');
    } else if (kind === 'today') {
      classes.push('today');
    }
    cell.className = classes.join(' ');

    var dateObj = new Date(year, month - 1, day);
    var dow = dateObj.getDay();

    var num = document.createElement('div');
    num.className = 'day-num';
    if (dow === 0) num.classList.add('sun');
    if (dow === 6) num.classList.add('sat');
    num.textContent = day;
    cell.appendChild(num);

    if (!isOther && year === cardYear && month === cardMonth) {
      var events = getSchedulesForCardDay(year, month, day, cardYear, cardMonth);
      if (events.length) {
        groupSchedulesForDisplay(events).forEach(function (group) {
          cell.appendChild(createTimeGroupChip(group));
        });
      }
    }

    return cell;
  }

  function isHighAttendance(ev) {
    if (ev.highAttendance === true) {
      return true;
    }
    var total =
      typeof ev.totalCount === 'number'
        ? ev.totalCount
        : (ev.confirmed || 0) + (ev.pending || 0);
    return total >= HIGH_ATTENDANCE_THRESHOLD;
  }

  function formatCalendarLocationHtml(schedules) {
    var seen = {};
    var locs = [];
    (schedules || []).forEach(function (s) {
      var loc = String(s.location || '').trim();
      if (loc && !seen[loc]) {
        seen[loc] = true;
        locs.push(loc);
      }
    });
    locs.sort(function (a, b) {
      return a.localeCompare(b, 'ja');
    });
    if (!locs.length) {
      return escapeHtml('（場所未設定）');
    }
    return locs
      .map(function (loc) {
        return '@' + escapeHtml(loc);
      })
      .join('<br>');
  }

  function createTimeGroupChip(schedules) {
    var sorted = (schedules || []).slice().sort(function (a, b) {
      var la = String(a.location || '');
      var lb = String(b.location || '');
      if (la !== lb) {
        return la.localeCompare(lb, 'ja');
      }
      return String(a.scheduleId || '').localeCompare(String(b.scheduleId || ''), 'ja');
    });
    var primary = sorted[0];
    var agg = aggregateGroupCounts(sorted);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event-chip';
    if (agg.total >= HIGH_ATTENDANCE_THRESHOLD) {
      btn.classList.add('high-attendance');
    }
    var timeSlot = primary ? String(primary.timeSlot || '').trim() : '';
    btn.dataset.scheduleId = primary ? String(primary.scheduleId || '') : '';
    btn.innerHTML =
      '<span class="chip-location">' + formatCalendarLocationHtml(sorted) + '</span>' +
      '<span class="chip-footer">' +
      '<span class="chip-time">' + formatBulkTimeSlotHtml(timeSlot) + '</span>' +
      '<span class="chip-counts">' + formatChipCountHtml(agg) + '</span>' +
      '</span>';
    return btn;
  }

  function openDetail(scheduleId) {
    STATE.currentScheduleId = scheduleId;
    STATE.detailSiblings = getSchedulesInSameTimeGroup(scheduleId);
    hideOrgDetailPanel();
    document.getElementById('modalFormMessage').textContent = '';

    var local = STATE.schedules.find(function (s) {
      return s.scheduleId === scheduleId;
    });
    if (!local) {
      return;
    }

    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('modalOverlay').setAttribute('aria-hidden', 'false');
    renderDetailFromSnapshot(local);
  }

  function getDetailTimeSlot(schedules) {
    var list = schedules || [];
    for (var i = 0; i < list.length; i++) {
      var t = String(list[i].timeSlot || '').trim();
      if (t) {
        return t;
      }
    }
    return '';
  }

  function renderDetailFromSnapshot(schedule) {
    var siblings = STATE.detailSiblings.length
      ? STATE.detailSiblings
      : getSchedulesInSameTimeGroup(schedule);

    document.getElementById('modalTitle').textContent =
      schedule && schedule.dateLabel ? schedule.dateLabel : '詳細';
    document.getElementById('modalTimeSlot').textContent = getDetailTimeSlot(siblings);
    document.getElementById('modalMeta').innerHTML = buildGroupedScheduleDisplayHtml(siblings);

    var remarks = siblings
      .map(function (s) {
        return String(s.scheduleRemark || '').trim();
      })
      .filter(Boolean);
    var scheduleRemarkEl = document.getElementById('modalScheduleRemark');
    if (remarks.length) {
      scheduleRemarkEl.textContent = remarks.join('\n');
      scheduleRemarkEl.style.display = 'block';
    } else {
      scheduleRemarkEl.textContent = '';
      scheduleRemarkEl.style.display = 'none';
    }

    var agg = aggregateGroupCounts(siblings);
    var active = agg.confirmed + agg.pending;
    var absent = agg.absent;
    var countLines = [];
    if (active > 0) {
      var partText = active + '人';
      if (agg.pending > 0) {
        partText += '(△' + agg.pending + ')';
      }
      countLines.push('参加: ' + partText);
    } else if (absent === 0) {
      countLines.push('参加: 0人');
    }
    if (absent > 0) {
      countLines.push('不参加: ✕' + absent + '人');
    }
    var countText = countLines.join('\n');
    if (active >= HIGH_ATTENDANCE_THRESHOLD) {
      countText += '\n（開催見込み↑）';
    }
    var modalCountEl = document.getElementById('modalCount');
    modalCountEl.textContent = countText;
    modalCountEl.style.whiteSpace = 'pre-line';
    modalCountEl.style.color = active >= HIGH_ATTENDANCE_THRESHOLD ? '#047857' : '';

    var key = exportTimeGroupKey(schedule);
    var participants = (STATE.participantsByGroup && STATE.participantsByGroup[key]) || [];
    renderParticipantList(participants);
  }

  function renderParticipantList(participants) {
    var list = document.getElementById('participantList');
    list.innerHTML = '';

    if (!participants.length) {
      document.getElementById('emptyParticipants').style.display = 'block';
      return;
    }

    document.getElementById('emptyParticipants').style.display = 'none';
    participants.forEach(function (p) {
      var li = document.createElement('li');
      var badgeClass = 'pending';
      if (p.status === 1) badgeClass = 'confirmed';
      else if (p.status === 3) badgeClass = 'absent';

      var remarkHtml = p.remark
        ? '<span class="participant-remark" title="' +
          escapeHtml(p.remark) +
          '">（' +
          escapeHtml(p.remark) +
          '）</span>'
        : '';

      li.innerHTML =
        '<div class="participant-info">' +
        '<span class="participant-name">' +
        escapeHtml(p.name) +
        '</span>' +
        remarkHtml +
        '</div>' +
        '<span class="badge ' +
        badgeClass +
        '">' +
        escapeHtml(p.statusLabel || '') +
        '</span>';
      list.appendChild(li);
    });
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('modalOverlay').setAttribute('aria-hidden', 'true');
    STATE.currentScheduleId = null;
    hideOrgDetailPanel();
  }

  function hideOrgDetailPanel() {
    var panel = document.getElementById('orgDetailPanel');
    panel.classList.remove('open');
    panel.innerHTML = '';
  }

  function showLoading(show) {
    var loading = document.getElementById('loadingArea');
    var calendar = document.getElementById('calendarArea');
    loading.style.display = show ? 'flex' : 'none';
    if (show) {
      calendar.style.display = 'none';
    }
  }

  function onError(err) {
    showLoading(false);
    setRefreshLoading(false);
    var area = document.getElementById('errorArea');
    area.className = 'error-banner';
    area.textContent = err.message || String(err);
  }

  function formatYearMonth(y, m) {
    return y + '年' + m + '月';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
