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
    currentGroupKey: '',
    selectedParticipantName: null,
    lastParticipants: [],
    generatedAt: null,
  };

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var ATTENDANCE_TIER_HIGH = 8;
  var ATTENDANCE_TIER_MID = 5;
  var CALENDAR_CACHE_KEY = 'volley_calendar_pages_v1';
  var CALENDAR_CACHE_MAX_BYTES = 4 * 1024 * 1024;
  var TODAY_MS = 0;
  var MAP_URL_PREFIX = 'https://www.google.com/maps/search/?api=1&query=';
  var MAP_URL_CITY_PREFIX = '札幌市立';

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
    document.getElementById('participantList').addEventListener('click', onParticipantListClick);
    document.getElementById('saveParticipantBtn').addEventListener('click', onSaveParticipantClick);
    document.getElementById('participantMemberSelect').addEventListener('change', onMemberSelectChange);
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

  function normalizeDateLabelForKey(dateLabel) {
    var text = String(dateLabel || '')
      .trim()
      .replace(/\s*[（(][^）)]*[）)]\s*$/, '')
      .trim();
    var m = text.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      return parseInt(m[1], 10) + '/' + parseInt(m[2], 10);
    }
    return text;
  }

  function normalizeTimeSlotForKey(timeSlot) {
    return String(timeSlot || '')
      .trim()
      .replace(/[～—－〜]/g, '-')
      .replace(/\s+/g, '')
      .replace(/-+/g, '-');
  }

  function exportTimeGroupKey(schedule) {
    return (
      normalizeDateLabelForKey(schedule.dateLabel) +
      '\x1f' +
      normalizeTimeSlotForKey(schedule.timeSlot)
    );
  }

  function calendarDisplayGroupKey(s) {
    return (
      s.year +
      '-' +
      s.month +
      '-' +
      s.day +
      '\x1f' +
      normalizeTimeSlotForKey(s.timeSlot)
    );
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
      var startLabel = formatYearMonth(data.range.startYear, data.range.startMonth);
      var endLabel = formatYearMonth(data.range.endYear, data.range.endMonth);
      document.getElementById('periodLabel').textContent =
        startLabel === endLabel ? startLabel : startLabel + ' 〜 ' + endLabel;
    } else {
      document.getElementById('periodLabel').textContent = '参加カレンダー';
    }

    var errorArea = document.getElementById('errorArea');
    if (errorArea && !options.fromCache) {
      errorArea.className = '';
      errorArea.textContent = '';
    }

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

  function setRefreshLoading(show) {
    var btn = document.getElementById('refreshCalendarBtn');
    var spinner = document.getElementById('refreshSpinner');
    btn.disabled = !!show;
    spinner.style.display = show ? 'block' : 'none';
  }

  function onRefreshError(err) {
    var area = document.getElementById('errorArea');
    var msg = err && err.message ? err.message : String(err);
    area.className = 'error-banner';
    area.textContent = '更新に失敗しました: ' + msg;
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

  function normalizePlaceForMapQuery(place) {
    var t = String(place || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/（[^）]*）/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (!t || t === '—') {
      return '';
    }
    return t;
  }

  function buildFallbackMapUrl(place) {
    var normalized = normalizePlaceForMapQuery(place);
    if (!normalized) {
      return '';
    }
    return MAP_URL_PREFIX + encodeURIComponent(MAP_URL_CITY_PREFIX + normalized);
  }

  function formatLocationMapLinkHtml(place) {
    var displayText = String(place || '').trim() || '—';
    var mapUrl = buildFallbackMapUrl(place);
    if (mapUrl) {
      return (
        '<a class="venue-map-link" href="' +
        escapeHtml(mapUrl) +
        '" target="_blank" rel="noopener noreferrer" title="地図を開く" aria-label="' +
        escapeHtml(displayText) +
        'の地図を開く">' +
        escapeHtml(displayText) +
        '</a>'
      );
    }
    return escapeHtml(displayText);
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
        rawHtml: true,
        values: list.map(function (s) {
          return formatLocationMapLinkHtml(s.location);
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
        html += '<span class="sg-cell">' + (row.rawHtml ? val : escapeHtml(val)) + '</span>';
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
    if (!(agg.absent > 0)) {
      return '';
    }
    return (
      '<span class="count-absent">' + escapeHtml('✕' + agg.absent + '人') + '</span>'
    );
  }

  function formatChipBgCountHtml(agg) {
    var active = (agg.confirmed || 0) + (agg.pending || 0);
    return (
      '<span class="chip-bg-count" aria-hidden="true">' +
      escapeHtml(String(active)) +
      '</span>'
    );
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

  function shouldShowNextMonthCalendar() {
    if (typeof shouldIncludeNextMonthInVolleyCalendar === 'function') {
      return shouldIncludeNextMonthInVolleyCalendar();
    }
    return new Date().getDate() >= 23;
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

    var frag = document.createDocumentFragment();
    frag.appendChild(buildMonthCalendar(m1.year, m1.month));
    if (shouldShowNextMonthCalendar()) {
      var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      var m2 = { year: next.getFullYear(), month: next.getMonth() + 1 };
      frag.appendChild(buildMonthCalendar(m2.year, m2.month));
    }
    area.appendChild(frag);
  }

  /** 月を日曜始まりの週行に分割（null はグリッド用パディング） */
  function getMonthWeekRows(year, month) {
    var first = new Date(year, month - 1, 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(year, month, 0).getDate();
    var cells = [];
    var pad;
    var d;
    for (pad = 0; pad < startPad; pad++) {
      cells.push(null);
    }
    for (d = 1; d <= daysInMonth; d++) {
      cells.push(d);
    }
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }
    var weeks = [];
    for (var w = 0; w < cells.length; w += 7) {
      weeks.push(cells.slice(w, w + 7));
    }
    return weeks;
  }

  /** その週の当月日がすべて今日より前なら終了週 */
  function isFinishedWeek(year, month, weekDays) {
    var latestMs = null;
    var i;
    for (i = 0; i < weekDays.length; i++) {
      var day = weekDays[i];
      if (day == null) {
        continue;
      }
      var ms = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
      if (latestMs == null || ms > latestMs) {
        latestMs = ms;
      }
    }
    if (latestMs == null) {
      return true;
    }
    return latestMs < TODAY_MS;
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

    var weekRows = getMonthWeekRows(year, month);
    var w;
    var col;
    for (w = 0; w < weekRows.length; w++) {
      var week = weekRows[w];
      if (isFinishedWeek(year, month, week)) {
        continue;
      }
      for (col = 0; col < week.length; col++) {
        var dayNum = week[col];
        if (dayNum == null) {
          var empty = document.createElement('div');
          empty.className = 'day-cell day-cell--pad';
          empty.setAttribute('aria-hidden', 'true');
          daysGrid.appendChild(empty);
          continue;
        }
        daysGrid.appendChild(createDayCell(year, month, dayNum, false, year, month));
      }
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

  function getAttendanceTierClass(activeCount) {
    if (activeCount >= ATTENDANCE_TIER_HIGH) {
      return 'attendance-high';
    }
    if (activeCount >= ATTENDANCE_TIER_MID) {
      return 'attendance-mid';
    }
    return 'attendance-low';
  }

  function locationPinSvgHtml() {
    return (
      '<svg class="chip-loc-pin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>' +
      '</svg>'
    );
  }

  function formatCalendarLocationHtml(schedules) {
    var list = (schedules || []).slice();
    var seen = {};
    var locs = [];
    list.forEach(function (s) {
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
      return (
        '<span class="chip-loc-line">' +
        locationPinSvgHtml() +
        '<span class="chip-loc-text">' +
        escapeHtml('（場所未設定）') +
        '</span></span>'
      );
    }
    return locs
      .map(function (loc) {
        return (
          '<span class="chip-loc-line">' +
          locationPinSvgHtml() +
          '<span class="chip-loc-text">' +
          escapeHtml(loc) +
          '</span></span>'
        );
      })
      .join('');
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
    var displaySchedules = sorted;
    var primary = displaySchedules[0];
    var agg = aggregateGroupCounts(displaySchedules);
    var btn = document.createElement('button');
    btn.type = 'button';
    var activeCount = (agg.confirmed || 0) + (agg.pending || 0);
    btn.className = 'event-chip ' + getAttendanceTierClass(activeCount);
    var timeSlot = primary ? String(primary.timeSlot || '').trim() : '';
    btn.dataset.scheduleId = primary ? String(primary.scheduleId || '') : '';
    btn.setAttribute('data-bg-count', String(activeCount));
    btn.innerHTML =
      formatChipBgCountHtml(agg) +
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
    STATE.selectedParticipantName = null;
    STATE.lastParticipants = [];
    hideOrgDetailPanel();
    resetParticipantForm();
    setModalFormMessage('', '');

    var local = STATE.schedules.find(function (s) {
      return s.scheduleId === scheduleId;
    });
    if (!local) {
      return;
    }

    STATE.currentGroupKey = exportTimeGroupKey(local);

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
    if (active >= ATTENDANCE_TIER_HIGH) {
      countText += '\n（開催見込み↑）';
    }
    var modalCountEl = document.getElementById('modalCount');
    modalCountEl.textContent = countText;
    modalCountEl.style.whiteSpace = 'pre-line';
    modalCountEl.classList.toggle('modal-count--hot', active >= ATTENDANCE_TIER_HIGH);

    var key = exportTimeGroupKey(schedule);
    STATE.currentGroupKey = key;
    var participants = (STATE.participantsByGroup && STATE.participantsByGroup[key]) || [];
    STATE.lastParticipants = participants.slice();
    renderParticipantList(STATE.lastParticipants);
    populateMemberSelect();
    if (STATE.selectedParticipantName) {
      var select = document.getElementById('participantMemberSelect');
      if (select && STATE.members.indexOf(STATE.selectedParticipantName) >= 0) {
        select.value = STATE.selectedParticipantName;
        prefillParticipantFormFromSelection();
      } else {
        STATE.selectedParticipantName = null;
        resetParticipantFormFields();
      }
    }
  }

  function statusLabelFromCode(status) {
    if (status === 1) return '○';
    if (status === 2) return '△';
    if (status === 3) return '✕';
    return String(status || '');
  }

  function setModalFormMessage(text, kind) {
    var el = document.getElementById('modalFormMessage');
    el.textContent = text || '';
    el.className = 'form-message' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
  }

  function populateMemberSelect() {
    var select = document.getElementById('participantMemberSelect');
    if (!select) {
      return;
    }
    var previous = select.value;
    select.innerHTML = '<option value="">選択してください</option>';
    (STATE.members || []).forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    if (previous && STATE.members.indexOf(previous) >= 0) {
      select.value = previous;
    }
  }

  function resetParticipantFormFields() {
    var select = document.getElementById('participantMemberSelect');
    if (select) {
      select.value = '';
    }
    document.querySelectorAll('input[name="editStatus"]').forEach(function (input) {
      input.checked = false;
    });
    document.getElementById('editRemark').value = '';
  }

  function resetParticipantForm() {
    STATE.selectedParticipantName = null;
    resetParticipantFormFields();
  }

  function prefillParticipantForm(participant) {
    if (!participant) {
      return;
    }
    document.getElementById('editRemark').value = participant.remark || '';
    var statusInput = document.querySelector(
      'input[name="editStatus"][value="' + String(participant.status) + '"]'
    );
    document.querySelectorAll('input[name="editStatus"]').forEach(function (input) {
      input.checked = false;
    });
    if (statusInput) {
      statusInput.checked = true;
    }
  }

  function prefillParticipantFormFromSelection() {
    var name = document.getElementById('participantMemberSelect').value;
    STATE.selectedParticipantName = name || null;
    if (!name) {
      resetParticipantFormFields();
      return;
    }
    var participant = STATE.lastParticipants.find(function (p) {
      return p.name === name;
    });
    if (participant) {
      prefillParticipantForm(participant);
      return;
    }
    document.querySelectorAll('input[name="editStatus"]').forEach(function (input) {
      input.checked = false;
    });
    document.getElementById('editRemark').value = '';
  }

  function onMemberSelectChange() {
    prefillParticipantFormFromSelection();
    renderParticipantList(STATE.lastParticipants);
    setModalFormMessage('', '');
  }

  function onParticipantListClick(e) {
    var li = e.target.closest('#participantList li[data-name]');
    if (!li) {
      return;
    }
    var name = li.getAttribute('data-name');
    var participant = STATE.lastParticipants.find(function (p) {
      return p.name === name;
    });
    if (!participant) {
      return;
    }
    STATE.selectedParticipantName = name;
    var select = document.getElementById('participantMemberSelect');
    if (select) {
      select.value = name;
    }
    prefillParticipantForm(participant);
    renderParticipantList(STATE.lastParticipants);
    setModalFormMessage('', '');
    document.getElementById('participantRegisterSection').scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
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
      li.setAttribute('data-name', p.name);
      var badgeClass = 'pending';
      if (p.status === 1) badgeClass = 'confirmed';
      else if (p.status === 3) badgeClass = 'absent';
      if (STATE.selectedParticipantName === p.name) {
        li.classList.add('selected');
      }

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
        '<span class="edit-hint">変更</span>' +
        '<span class="badge ' +
        badgeClass +
        '">' +
        escapeHtml(p.statusLabel || statusLabelFromCode(p.status)) +
        '</span>';
      list.appendChild(li);
    });
  }

  function applyParticipantSaveToState(detail) {
    if (!detail) {
      return;
    }
    if (detail.participants && STATE.currentGroupKey) {
      STATE.participantsByGroup[STATE.currentGroupKey] = detail.participants;
      STATE.lastParticipants = detail.participants.slice();
    }
    if (detail.schedule) {
      var s = detail.schedule;
      var siblingIds = {};
      STATE.detailSiblings.forEach(function (row) {
        siblingIds[row.scheduleId] = true;
      });
      STATE.schedules = STATE.schedules.map(function (row) {
        if (!siblingIds[row.scheduleId] && row.scheduleId !== s.scheduleId) {
          return row;
        }
        return Object.assign({}, row, {
          confirmed: s.confirmed,
          pending: s.pending,
          absent: s.absent,
          totalCount: s.totalCount,
          highAttendance: s.highAttendance,
          countLabel: s.countLabel,
        });
      });
      rebuildScheduleDayIndex();
      renderCalendars();
    }
  }

  function onSaveParticipantClick() {
    if (!STATE.currentScheduleId) {
      setModalFormMessage('日程が選択されていません。', 'err');
      return;
    }
    var memberName = document.getElementById('participantMemberSelect').value.trim();
    if (!memberName) {
      setModalFormMessage('名前を選択してください。', 'err');
      return;
    }
    var statusEl = document.querySelector('input[name="editStatus"]:checked');
    if (!statusEl) {
      setModalFormMessage('参加状況を選んでください。', 'err');
      return;
    }
    var status = parseInt(statusEl.value, 10);
    var remark = document.getElementById('editRemark').value.trim();
    var btn = document.getElementById('saveParticipantBtn');
    btn.disabled = true;
    setModalFormMessage('保存中…', '');

    var saveFn =
      typeof saveParticipationRemote === 'function' ? saveParticipationRemote : null;
    if (!saveFn) {
      btn.disabled = false;
      setModalFormMessage('保存 API が読み込まれていません。', 'err');
      return;
    }

    saveFn(STATE.currentScheduleId, memberName, status, remark)
      .then(function (data) {
        btn.disabled = false;
        applyParticipantSaveToState(data);
        STATE.selectedParticipantName = memberName;
        var local = STATE.schedules.find(function (s) {
          return s.scheduleId === STATE.currentScheduleId;
        });
        if (local) {
          renderDetailFromSnapshot(local);
          var select = document.getElementById('participantMemberSelect');
          if (select) {
            select.value = memberName;
          }
          prefillParticipantFormFromSelection();
        }
        var result = data.result || {};
        setModalFormMessage(
          (result.name || memberName) +
            ' さんを「' +
            (result.statusLabel || statusLabelFromCode(status)) +
            '」で登録しました。',
          'ok'
        );
      })
      .catch(function (err) {
        btn.disabled = false;
        setModalFormMessage(err.message || String(err), 'err');
      });
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('modalOverlay').setAttribute('aria-hidden', 'true');
    STATE.currentScheduleId = null;
    STATE.selectedParticipantName = null;
    STATE.lastParticipants = [];
    STATE.currentGroupKey = '';
    resetParticipantForm();
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
