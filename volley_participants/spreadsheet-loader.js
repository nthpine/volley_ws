/**
 * 参加管理スプレッドシートを gviz CSV で読み、閲覧用カレンダーデータを組み立てる。
 * basket spreadsheet-viewer と同様（GAS / GitHub JSON は使わない）。
 */
(function (global) {
  'use strict';

  var STATUS = { CONFIRMED: 1, PENDING: 2, ABSENT: 3 };
  var HIGH_ATTENDANCE_THRESHOLD = 8;
  var PARTICIPANT_REMARK_COL = 5;
  var PARTICIPANT_INPUT_AT_COL = 6;
  var BUNDLE_IDB_NAME = 'volley-viewer-gviz';
  var BUNDLE_IDB_STORE = 'bundle';

  function getConfig() {
    var cfg = global.CONFIG || {};
    return {
      spreadsheetId: cfg.SPREADSHEET_ID || '',
      sheets: cfg.SHEET_NAMES || {
        schedules: 'schedules',
        participants: 'participants',
        members: 'members',
        config: 'config',
      },
      cacheTtlMs: cfg.CACHE_TTL_MS || 10 * 60 * 1000,
    };
  }

  function csvUrl(spreadsheetId, sheetName) {
    var q = new URLSearchParams({ tqx: 'out:csv', sheet: sheetName });
    return (
      'https://docs.google.com/spreadsheets/d/' +
      spreadsheetId +
      '/gviz/tq?' +
      q.toString()
    );
  }

  function csvLooksValid(text) {
    var t = String(text || '')
      .replace(/^\uFEFF/, '')
      .trimStart();
    if (!t || t.startsWith('<') || t.startsWith('<!')) return false;
    if (t.length < 2) return false;
    if (t.includes(',') || t.includes('\t')) return true;
    // gviz の1列シート（members など）: "名前"\n"かずま" … のようにカンマが無い
    var lines = t.split(/\r?\n/).filter(function (line) {
      return String(line).trim() !== '';
    });
    return lines.length >= 1;
  }

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var i = 0;
    var inQuotes = false;

    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        cell += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(cell);
        cell = '';
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
        continue;
      }
      cell += c;
      i++;
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    return rows;
  }

  async function fetchSheetRows(spreadsheetId, sheetName) {
    var res = await fetch(csvUrl(spreadsheetId, sheetName), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        'シート「' +
          sheetName +
          '」の取得に失敗しました（HTTP ' +
          res.status +
          '）'
      );
    }
    var text = await res.text();
    if (!csvLooksValid(text)) {
      throw new Error(
        'シート「' +
          sheetName +
          '」を読めません。スプレッドシートが「リンクを知っている全員が閲覧可」か、シート名が正しいか確認してください。'
      );
    }
    return parseCSV(text);
  }

  function bundleCacheKey(spreadsheetId) {
    var d = new Date();
    return (
      'volley_gviz_' +
      spreadsheetId +
      '_v1_' +
      d.getFullYear() +
      '-' +
      (d.getMonth() + 1) +
      '-' +
      d.getDate()
    );
  }

  function openBundleIdb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(BUNDLE_IDB_NAME, 1);
      req.onerror = function () {
        reject(req.error);
      };
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(BUNDLE_IDB_STORE)) {
          req.result.createObjectStore(BUNDLE_IDB_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
    });
  }

  async function readBundleCache(cacheKey, ttlMs) {
    try {
      var db = await openBundleIdb();
      var row = await new Promise(function (resolve) {
        var tx = db.transaction(BUNDLE_IDB_STORE, 'readonly');
        var g = tx.objectStore(BUNDLE_IDB_STORE).get(cacheKey);
        g.onsuccess = function () {
          resolve(g.result || null);
        };
        g.onerror = function () {
          resolve(null);
        };
      });
      db.close();
      if (!row || typeof row.ts !== 'number' || !row.payload) return null;
      if (Date.now() - row.ts > ttlMs) return null;
      return row.payload;
    } catch (e) {
      return null;
    }
  }

  async function writeBundleCache(cacheKey, payload) {
    try {
      var db = await openBundleIdb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(BUNDLE_IDB_STORE, 'readwrite');
        tx.objectStore(BUNDLE_IDB_STORE).put({ ts: Date.now(), payload: payload }, cacheKey);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
      db.close();
    } catch (e) {
      /* ignore */
    }
  }

  function scheduleTimeGroupKey(dateLabel, timeSlot) {
    return String(dateLabel || '').trim() + '\x1f' + String(timeSlot || '').trim();
  }

  function formatScheduleId(num) {
    var s = String(num);
    while (s.length < 7) {
      s = '0' + s;
    }
    return 'S' + s;
  }

  function normalizeIncomingScheduleId(value) {
    var sid = String(value || '')
      .trim()
      .replace(/^'/, '');
    if (!sid) return '';
    var m = sid.match(/^S(\d+)$/i);
    if (m) return formatScheduleId(parseInt(m[1], 10));
    if (/^\d+$/.test(sid)) return formatScheduleId(parseInt(sid, 10));
    return '';
  }

  function canonicalScheduleId(value) {
    return normalizeIncomingScheduleId(value) || String(value || '').trim();
  }

  function normalizeOrgId(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    if (/^\d+$/.test(s) && s.length < 8) {
      return s.padStart(8, '0');
    }
    return s;
  }

  function statusLabel(status) {
    if (status === STATUS.CONFIRMED) return '○';
    if (status === STATUS.PENDING) return '△';
    if (status === STATUS.ABSENT) return '✕';
    return String(status);
  }

  function formatCountLabel(confirmed, pending, absent) {
    confirmed = confirmed || 0;
    pending = pending || 0;
    absent = absent || 0;
    var parts = [];
    var active = confirmed + pending;
    if (active > 0) {
      parts.push(
        pending > 0 ? active + '人(△' + pending + '人)' : active + '人'
      );
    } else if (confirmed === 0 && pending === 0 && absent === 0) {
      return '0人';
    }
    if (absent > 0) {
      parts.push('✕' + absent + '人');
    }
    return parts.length ? parts.join(' ') : '0人';
  }

  function stripTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function getTwoMonthRange() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    var end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    return { start: start, end: end };
  }

  function parseScheduleDateInRange(dateLabel, rangeStart, rangeEnd) {
    var m = String(dateLabel).match(/^(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    var month = parseInt(m[1], 10);
    var day = parseInt(m[2], 10);
    var yStart = rangeStart.getFullYear();
    var yEnd = rangeEnd.getFullYear();
    for (var y = yStart; y <= yEnd; y++) {
      var d = new Date(y, month - 1, day);
      if (d >= stripTime(rangeStart) && d <= rangeEnd) {
        return d;
      }
    }
    return null;
  }

  function formatDateIso(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function findOrgIdColumnIndex(headers) {
    var remarkCol = findScheduleRemarkIndex(headers);
    var named = headers.indexOf('利用者番号');
    if (named >= 0) return named;
    named = headers.indexOf('主催団体番号');
    if (named >= 0) return named;
    if (remarkCol > 0) return remarkCol - 1;
    if (headers.length >= 6) return 5;
    return headers.length - 1;
  }

  function findScheduleRemarkIndex(headers) {
    var idx = headers.indexOf('備考');
    if (idx >= 0) return idx;
    if (headers.length > 6) return 6;
    return -1;
  }

  function findHiddenFlagColumnIndex(headers) {
    var idx = headers.indexOf('非表示フラグ');
    if (idx >= 0) return idx;
    if (headers.length > 7) return 7;
    return -1;
  }

  function isScheduleRowHidden(row, headers) {
    var idx = findHiddenFlagColumnIndex(headers);
    if (idx < 0) return false;
    var v = String(row[idx] == null ? '' : row[idx])
      .trim()
      .toLowerCase();
    return v === 'true' || v === '1' || v === '真';
  }

  function findParticipantRemarkIndex(headers) {
    if (!headers) return PARTICIPANT_REMARK_COL - 1;
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === '備考') return i;
    }
    return PARTICIPANT_REMARK_COL - 1;
  }

  function getParticipantRemarkFromRow(row, headers) {
    var col = findParticipantRemarkIndex(headers);
    return col >= 0 && row.length > col ? String(row[col] || '').trim() : '';
  }

  function parseParticipantInputAt(row, headers) {
    var idx = headers.indexOf('入力日時');
    if (idx < 0) idx = PARTICIPANT_INPUT_AT_COL - 1;
    return idx >= 0 && row.length > idx ? String(row[idx] || '').trim() : '';
  }

  function buildConfigMap(configRows) {
    if (!configRows || configRows.length < 2) return {};
    var headers = configRows[0];
    var idxId = headers.indexOf('利用者番号');
    var idxName = headers.indexOf('団体名');
    if (idxId === -1) {
      throw new Error('config シートに「利用者番号」列がありません。');
    }
    var map = {};
    for (var i = 1; i < configRows.length; i++) {
      var row = configRows[i];
      var id = normalizeOrgId(row[idxId]);
      if (!id) continue;
      var idxRep = headers.indexOf('代表者名');
      var idxSubRep = headers.indexOf('副代表者名');
      map[id] = {
        orgId: id,
        orgName: idxName >= 0 ? String(row[idxName] || '') : '',
        repName: idxRep >= 0 ? String(row[idxRep] || '').trim() : '',
        subRepName: idxSubRep >= 0 ? String(row[idxSubRep] || '').trim() : '',
      };
    }
    return map;
  }

  function buildOrgByIdForExport(configMap) {
    var out = {};
    Object.keys(configMap).forEach(function (key) {
      var org = configMap[key];
      out[org.orgId || key] = {
        orgId: org.orgId || key,
        orgName: org.orgName || '',
        repName: org.repName || '',
        subRepName: org.subRepName || '',
      };
    });
    return out;
  }

  function loadMemberNames(memberRows) {
    if (!memberRows || memberRows.length < 2) return [];
    var idx = memberRows[0].indexOf('名前');
    if (idx === -1) {
      throw new Error('members シートに「名前」列がありません。');
    }
    var names = [];
    for (var i = 1; i < memberRows.length; i++) {
      var n = String(memberRows[i][idx] || '').trim();
      if (n) names.push(n);
    }
    return names;
  }

  function buildScheduleIdToTimeGroupMapFromRows(rows, headers) {
    var map = {};
    if (!rows || rows.length < 2 || !headers || !headers.length) return map;
    var idxSid = headers.indexOf('スケジュールID');
    var idxDate = headers.indexOf('日付');
    var idxTime = headers.indexOf('時間帯');
    if (idxSid === -1 || idxDate === -1 || idxTime === -1) return map;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (isScheduleRowHidden(row, headers)) continue;
      var sid = canonicalScheduleId(row[idxSid]);
      if (!sid || map[sid]) continue;
      var dateLabel = String(row[idxDate] || '').trim();
      var timeSlot = String(row[idxTime] || '').trim();
      if (!dateLabel || !timeSlot) continue;
      map[sid] = {
        dateLabel: dateLabel,
        timeSlot: timeSlot,
        groupKey: scheduleTimeGroupKey(dateLabel, timeSlot),
      };
    }
    return map;
  }

  function parseParticipantRowGroupKey(row, headers, sidToGroup) {
    var idxDate = headers.indexOf('日付');
    var idxTime = headers.indexOf('時間帯');
    if (idxDate >= 0 && idxTime >= 0) {
      var dateLabel = String(row[idxDate] || '').trim();
      var timeSlot = String(row[idxTime] || '').trim();
      if (dateLabel && timeSlot) {
        return scheduleTimeGroupKey(dateLabel, timeSlot);
      }
    }
    var idxSid = headers.indexOf('スケジュールID');
    if (idxSid >= 0 && sidToGroup) {
      var sid = canonicalScheduleId(row[idxSid]);
      if (sid && sidToGroup[sid]) {
        return sidToGroup[sid].groupKey;
      }
    }
    return '';
  }

  function loadParticipantCountsByTimeGroup(partRows, partHeaders, sidToGroup) {
    var result = {};
    if (!partRows || partRows.length < 2) return result;
    var headers = partHeaders;
    var idxName = headers.indexOf('名前');
    var idxStatus = headers.indexOf('参加状況');
    if (idxStatus === -1) {
      throw new Error('participants シートの列構成が不正です。');
    }
    var seenByGroup = {};
    for (var i = 1; i < partRows.length; i++) {
      var row = partRows[i];
      var gKey = parseParticipantRowGroupKey(row, headers, sidToGroup);
      if (!gKey) continue;
      var rowName = idxName >= 0 ? String(row[idxName] || '').trim() : '';
      var dedupeKey = gKey + '\x1f' + rowName;
      if (rowName && seenByGroup[dedupeKey]) continue;
      if (rowName) seenByGroup[dedupeKey] = true;
      var st = parseInt(String(row[idxStatus]).trim(), 10);
      if (!result[gKey]) {
        result[gKey] = { confirmed: 0, pending: 0, absent: 0 };
      }
      if (st === STATUS.CONFIRMED) result[gKey].confirmed++;
      else if (st === STATUS.PENDING) result[gKey].pending++;
      else if (st === STATUS.ABSENT) result[gKey].absent++;
    }
    return result;
  }

  function buildParticipantsByTimeGroupFromRows(partRows, partHeaders, sidToGroup) {
    if (!partRows || partRows.length < 2) return {};
    var headers = partHeaders;
    var idxName = headers.indexOf('名前');
    var idxStatus = headers.indexOf('参加状況');
    if (idxName === -1 || idxStatus === -1) {
      throw new Error('participants シートの列構成が不正です。');
    }
    var byGroupName = {};
    for (var i = 1; i < partRows.length; i++) {
      var row = partRows[i];
      var gKey = parseParticipantRowGroupKey(row, headers, sidToGroup);
      if (!gKey) continue;
      var pName = String(row[idxName] || '').trim();
      if (!pName) continue;
      var st = parseInt(String(row[idxStatus]).trim(), 10);
      var inputAt = parseParticipantInputAt(row, headers);
      if (!byGroupName[gKey]) byGroupName[gKey] = {};
      if (
        !byGroupName[gKey][pName] ||
        inputAt >= (byGroupName[gKey][pName]._inputAt || '')
      ) {
        byGroupName[gKey][pName] = {
          name: pName,
          status: st,
          statusLabel: statusLabel(st),
          remark: getParticipantRemarkFromRow(row, headers),
          _inputAt: inputAt,
        };
      }
    }
    var result = {};
    Object.keys(byGroupName).forEach(function (gKey2) {
      var list = [];
      Object.keys(byGroupName[gKey2]).forEach(function (name) {
        delete byGroupName[gKey2][name]._inputAt;
        list.push(byGroupName[gKey2][name]);
      });
      list.sort(function (a, b) {
        if (a.status !== b.status) return a.status - b.status;
        return a.name.localeCompare(b.name, 'ja');
      });
      result[gKey2] = list;
    });
    return result;
  }

  function buildScheduleObject(row, headers, configMap) {
    var idxSid = headers.indexOf('スケジュールID');
    var idxLoc = headers.indexOf('場所');
    var idxCourt = headers.indexOf('面');
    var idxTime = headers.indexOf('時間帯');
    var orgCol = findOrgIdColumnIndex(headers);
    var idxScheduleRemark = findScheduleRemarkIndex(headers);
    var sid = canonicalScheduleId(row[idxSid]);
    var orgId = normalizeOrgId(row[orgCol]);
    var org = configMap[orgId] || { orgId: orgId, orgName: '' };
    return {
      scheduleId: sid,
      location: idxLoc >= 0 ? String(row[idxLoc] || '') : '',
      court: idxCourt >= 0 ? String(row[idxCourt] || '') : '',
      timeSlot: idxTime >= 0 ? String(row[idxTime] || '') : '',
      orgId: org.orgId,
      orgName: org.orgName,
      scheduleRemark:
        idxScheduleRemark >= 0 ? String(row[idxScheduleRemark] || '').trim() : '',
    };
  }

  function loadSchedulesInRange(
    rangeStart,
    rangeEnd,
    configMap,
    countsByTimeGroup,
    schedRows,
    schedHeaders
  ) {
    if (!schedRows || schedRows.length < 2) return [];
    var headers = schedHeaders;
    var idxSid = headers.indexOf('スケジュールID');
    var idxDate = headers.indexOf('日付');
    if (idxSid === -1 || idxDate === -1) {
      throw new Error('schedules シートの列構成が不正です。');
    }
    var out = [];
    for (var i = 1; i < schedRows.length; i++) {
      var row = schedRows[i];
      if (isScheduleRowHidden(row, headers)) continue;
      var dateLabel = String(row[idxDate] || '').trim();
      var eventDate = parseScheduleDateInRange(dateLabel, rangeStart, rangeEnd);
      if (!eventDate) continue;
      var base = buildScheduleObject(row, headers, configMap);
      var gKey = scheduleTimeGroupKey(dateLabel, base.timeSlot);
      var counts = countsByTimeGroup[gKey] || {
        confirmed: 0,
        pending: 0,
        absent: 0,
      };
      var confirmed = counts.confirmed || 0;
      var pending = counts.pending || 0;
      var absent = counts.absent || 0;
      out.push({
        scheduleId: base.scheduleId,
        dateIso: formatDateIso(eventDate),
        dateLabel: dateLabel,
        year: eventDate.getFullYear(),
        month: eventDate.getMonth() + 1,
        day: eventDate.getDate(),
        location: base.location,
        court: base.court,
        timeSlot: base.timeSlot,
        orgId: base.orgId,
        orgName: base.orgName,
        scheduleRemark: base.scheduleRemark,
        confirmed: confirmed,
        pending: pending,
        absent: absent,
        totalCount: confirmed + pending,
        highAttendance: confirmed + pending >= HIGH_ATTENDANCE_THRESHOLD,
        countLabel: formatCountLabel(confirmed, pending, absent),
      });
    }
    out.sort(function (a, b) {
      if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
      return a.timeSlot.localeCompare(b.timeSlot, 'ja');
    });
    return out;
  }

  function buildCalendarFromSheets(sheetData) {
    var range = getTwoMonthRange();
    var configMap = buildConfigMap(sheetData.config);
    var schedRows = sheetData.schedules;
    var schedHeaders = schedRows.length > 0 ? schedRows[0] : [];
    var partRows = sheetData.participants;
    var partHeaders = partRows.length > 0 ? partRows[0] : [];
    var sidToGroup = buildScheduleIdToTimeGroupMapFromRows(schedRows, schedHeaders);
    var countsByTimeGroup = loadParticipantCountsByTimeGroup(
      partRows,
      partHeaders,
      sidToGroup
    );
    var schedules = loadSchedulesInRange(
      range.start,
      range.end,
      configMap,
      countsByTimeGroup,
      schedRows,
      schedHeaders
    );
    return {
      generatedAt: new Date().toISOString(),
      range: {
        startYear: range.start.getFullYear(),
        startMonth: range.start.getMonth() + 1,
        endYear: range.end.getFullYear(),
        endMonth: range.end.getMonth() + 1,
      },
      schedules: schedules,
      members: loadMemberNames(sheetData.members),
      participantsByGroup: buildParticipantsByTimeGroupFromRows(
        partRows,
        partHeaders,
        sidToGroup
      ),
      orgById: buildOrgByIdForExport(configMap),
    };
  }

  async function fetchAllSheets(spreadsheetId, sheetNames) {
    var results = await Promise.all([
      fetchSheetRows(spreadsheetId, sheetNames.schedules),
      fetchSheetRows(spreadsheetId, sheetNames.participants),
      fetchSheetRows(spreadsheetId, sheetNames.members),
      fetchSheetRows(spreadsheetId, sheetNames.config),
    ]);
    return {
      schedules: results[0],
      participants: results[1],
      members: results[2],
      config: results[3],
    };
  }

  /**
   * @param {{ skipCache?: boolean }} opts
   * @returns {Promise<Object>}
   */
  async function loadVolleyCalendarBundle(opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (!cfg.spreadsheetId) {
      throw new Error('CONFIG.SPREADSHEET_ID が設定されていません。');
    }
    var cacheKey = bundleCacheKey(cfg.spreadsheetId);
    if (!opts.skipCache) {
      var cached = await readBundleCache(cacheKey, cfg.cacheTtlMs);
      if (cached) return cached;
    }
    var sheetData = await fetchAllSheets(cfg.spreadsheetId, cfg.sheets);
    var bundle = buildCalendarFromSheets(sheetData);
    await writeBundleCache(cacheKey, bundle);
    return bundle;
  }

  global.loadVolleyCalendarBundle = loadVolleyCalendarBundle;
})(typeof window !== 'undefined' ? window : this);
