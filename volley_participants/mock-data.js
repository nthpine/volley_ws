/**
 * push 前の画面確認用モックデータ（mock.html のみで使用。本番 push 前に削除可）
 */
(function (global) {
  'use strict';

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var DEFAULT_TIME_SLOT = '19:15-21:45';

  function pad2(n) {
    return ('0' + n).slice(-2);
  }

  function formatDateIso(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function formatDateLabel(d) {
    return d.getMonth() + 1 + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')';
  }

  function addDays(base, delta) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + delta);
    return d;
  }

  function buildSchedule(date, opts) {
    opts = opts || {};
    var timeSlot = opts.timeSlot || DEFAULT_TIME_SLOT;
    var confirmed = opts.confirmed != null ? opts.confirmed : 6;
    var pending = opts.pending != null ? opts.pending : 1;
    var absent = opts.absent != null ? opts.absent : 0;
    var dateLabel = formatDateLabel(date);
    return {
      scheduleId: opts.scheduleId || 'S' + pad2(date.getMonth() + 1) + pad2(date.getDate()) + '01',
      dateIso: formatDateIso(date),
      dateLabel: dateLabel,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      location: opts.location || '中央体育館',
      court: opts.court || '全面',
      timeSlot: timeSlot,
      orgId: opts.orgId || 'ORG001',
      orgName: opts.orgName || 'モック団体',
      scheduleRemark: opts.scheduleRemark || '',
      confirmed: confirmed,
      pending: pending,
      absent: absent,
      totalCount: confirmed + pending,
      highAttendance: confirmed + pending >= 8,
      countLabel: '',
    };
  }

  function buildMockCalendarBundle() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var pastWeek = addDays(today, -10);
    var thisWeek = addDays(today, 2);
    var nextWeek = addDays(today, 9);
    var nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 8);

    var sPast = buildSchedule(pastWeek, {
      scheduleId: 'S0000001',
      location: '過去週（非表示）',
      confirmed: 4,
      pending: 0,
    });
    var sThis = buildSchedule(thisWeek, {
      scheduleId: 'S0000002',
      location: '今週の開催',
      confirmed: 9,
      pending: 1,
    });
    var sNext = buildSchedule(nextWeek, {
      scheduleId: 'S0000003',
      location: '来週の開催',
      confirmed: 3,
      pending: 2,
    });
    var sNextMonth = buildSchedule(nextMonth, {
      scheduleId: 'S0000004',
      location: '翌月の開催',
      confirmed: 12,
      pending: 0,
    });

    var nextMonthRange = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    var confirmedGroupKey = sThis.dateLabel + '\x1f' + sThis.timeSlot;

    return {
      generatedAt: new Date().toISOString(),
      range: {
        startYear: today.getFullYear(),
        startMonth: today.getMonth() + 1,
        endYear: nextMonthRange.getFullYear(),
        endMonth: nextMonthRange.getMonth() + 1,
      },
      schedules: [sPast, sThis, sNext, sNextMonth],
      members: ['山田', '佐藤', '鈴木'],
      participantsByGroup: (function () {
        var o = {};
        o[confirmedGroupKey] = [
          { name: '山田（モック）', status: 1, statusLabel: '○', remark: '' },
          { name: '佐藤（モック）', status: 2, statusLabel: '△', remark: '遅刻' },
        ];
        return o;
      })(),
      orgById: {},
    };
  }

  function finalizeMockBundle(bundle) {
    if (typeof global.getVolleyTwoMonthRange === 'function') {
      var range = global.getVolleyTwoMonthRange();
      bundle.range = {
        startYear: range.start.getFullYear(),
        startMonth: range.start.getMonth() + 1,
        endYear: range.end.getFullYear(),
        endMonth: range.end.getMonth() + 1,
      };
    }
    return bundle;
  }

  global.MOCK_CALENDAR_BUNDLE = finalizeMockBundle(buildMockCalendarBundle());

  global.loadVolleyCalendarBundle = function () {
    return Promise.resolve(finalizeMockBundle(buildMockCalendarBundle()));
  };

  function mockStatusLabel(status) {
    if (status === 1) return '○';
    if (status === 2) return '△';
    if (status === 3) return '✕';
    return String(status);
  }

  global.saveParticipationRemote = function (scheduleId, name, status, remark) {
    var bundle = global.MOCK_CALENDAR_BUNDLE;
    var schedule = (bundle.schedules || []).find(function (s) {
      return s.scheduleId === scheduleId;
    });
    if (!schedule) {
      return Promise.reject(new Error('モック: スケジュールが見つかりません'));
    }
    var groupKey = schedule.dateLabel + '\x1f' + String(schedule.timeSlot || '').trim();
    var list = (bundle.participantsByGroup[groupKey] || []).slice();
    var found = false;
    list = list.map(function (p) {
      if (p.name !== name) {
        return p;
      }
      found = true;
      return {
        name: name,
        status: status,
        statusLabel: mockStatusLabel(status),
        remark: remark || '',
      };
    });
    if (!found) {
      return Promise.reject(new Error('モック: 参加者が見つかりません'));
    }
    bundle.participantsByGroup[groupKey] = list;
    global.MOCK_CALENDAR_BUNDLE = bundle;
    return Promise.resolve({
      ok: true,
      result: { name: name, status: status, statusLabel: mockStatusLabel(status), remark: remark || '' },
      schedule: schedule,
      participants: list,
    });
  };

  try {
    localStorage.removeItem('volley_calendar_pages_v1');
  } catch (e) {
    /* ignore */
  }
})(typeof window !== 'undefined' ? window : this);
