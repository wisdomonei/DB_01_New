/**
 * 데모 저장소 — localStorage 안의 JSON 문서 하나.
 *
 * 데이터 접근은 전부 이 파일을 거친다. 서버 모드로 바꿔도 화면(app.js)은
 * 그대로 두고 이 모듈과 같은 모양의 supabase-store.js 를 갈아 끼운다.
 *
 * ⚠ **파일 본문(바이트)은 저장하지 않는다.**
 *   부품원가계산서 한 건이 수 MB 이고 품번 1건에 여러 개가 붙는다.
 *   브라우저 localStorage 는 5MB 안팎이라 몇 건 만에 꽉 찬다.
 *   그래서 이름·크기·올린 사람·버전·원본 위치(link)만 남긴다.
 *   기획서의 "용량 문제" 에 대한 답이며, 서버 모드에서도 같은 방침이다
 *   (파일은 Storage/Teams 에 두고 표에는 메타데이터만) — README 참조.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Store = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'pct_workflow_db_v1';
  var Logic = root.Logic || (typeof require === 'function' ? require('./logic.js') : null);
  var Seed  = root.SeedData || (typeof require === 'function' ? require('./seed-data.js') : null);

  var cache = null;

  /* ------------------------------------------------------------ 날짜 */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + Logic.pad2(d.getMonth() + 1) + '-' + Logic.pad2(d.getDate());
  }

  function nowIso() { return new Date().toISOString(); }

  /** 오늘로부터 n일. 시드의 ...Off 를 실제 날짜로 바꾼다. */
  function offToDate(off) {
    if (off === null || off === undefined) return null;
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + Logic.pad2(d.getMonth() + 1) + '-' + Logic.pad2(d.getDate());
  }

  /* ------------------------------------------------------------ 시드 */

  function seed() {
    var src = Seed || { users: [], requests: [], files: [], archive: [], mails: [] };
    var users = (src.users || []).map(function (u) {
      return {
        id: u.id, name: u.name, email: u.email, org: u.org, role: u.role,
        status: u.status, joinedAt: offToDate(u.joinedOff),
        decidedAt: u.status === '승인대기' ? null : offToDate(u.joinedOff + 1),
        decidedBy: u.status === '승인대기' ? null : 'U-A1'
      };
    });
    var byId = {};
    users.forEach(function (u) { byId[u.id] = u; });

    var requests = (src.requests || []).map(function (r) {
      var owner = byId[r.requesterId] || {};
      return {
        id: r.id, partNo: r.partNo, partName: r.partName, model: r.model,
        requesterId: r.requesterId, requesterName: owner.name || '',
        requesterEmail: r.requesterEmail,
        requestedAt: offToDate(r.requestedOff),
        dueDate: offToDate(r.dueOff),
        eta: offToDate(r.etaOff),
        assigneeId: r.assigneeId,
        status: r.status,
        submittedAt: offToDate(r.submittedOff),
        closedAt: offToDate(r.closedOff),
        note: r.note || '',
        reviewNote: ''
      };
    });

    var files = (src.files || []).map(function (f, i) {
      return {
        id: 'F-' + (i + 1), requestId: f.requestId, name: f.name,
        size: f.sizeKb * 1024, kind: f.kind, version: f.version,
        uploaderId: f.uploaderId, uploadedAt: offToDate(f.uploadedOff),
        link: ''
      };
    });

    // 보관 자료는 파일명을 **그 자리에서 해독해** 담는다.
    // 시드에 정답을 적어 두면 해독기가 망가져도 화면은 멀쩡해 보인다.
    var archive = (src.archive || []).map(function (a, i) {
      var p = Logic.parseArchiveName(a.name);
      return {
        id: 'A-' + (i + 1), name: a.name, size: a.sizeKb * 1024,
        partNo: p.partNo, model: p.model, docDate: p.docDate, docMonth: p.docMonth,
        version: p.version, title: p.title, confidence: p.confidence, hints: p.hints,
        source: a.source, registeredAt: offToDate(a.registeredOff),
        confirmed: p.confidence === 'high'
      };
    });

    var mails = (src.mails || []).map(function (m, i) {
      return {
        id: 'M-' + (i + 1), requestId: m.requestId, kind: m.kind, to: m.to,
        subject: m.subject, at: offToDate(m.atOff), sentBy: 'U-A1'
      };
    });
    mails.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    // 활동 이력도 시드에서 만든다.
    // 빈 표로 열면 "이력이 안 남는 건가" 로 읽히는데, 실제로는 남는다.
    // 없는 사건을 지어내지 않고 이미 만들어진 요청·파일에서 되짚어 만든다.
    var logs = [];
    requests.slice().sort(function (a, b) {
      return String(b.submittedAt || b.requestedAt).localeCompare(String(a.submittedAt || a.requestedAt));
    }).slice(0, 12).forEach(function (r) {
      var actor = r.assigneeId || r.requesterId;
      if (r.closedAt) {
        logs.push(entry(r.closedAt, r.requesterId, '상태 변경', r.id, '검토/수정 → 완료'));
      }
      if (r.submittedAt) {
        var n = files.filter(function (f) { return f.requestId === r.id && f.kind === '초안'; }).length;
        logs.push(entry(r.submittedAt, actor, '상태 변경', r.id, '작업중 → 검토/수정'));
        if (n) logs.push(entry(r.submittedAt, actor, '초안 업로드', r.id, n + '건'));
      } else {
        logs.push(entry(r.requestedAt, r.requesterId, '요청 등록', r.id, r.partNo + ' ' + r.partName));
      }
    });
    logs.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    function entry(date, actorId, action, target, detail) {
      return { at: date + 'T09:00:00.000Z', actorId: actorId,
               action: action, target: target, detail: detail };
    }

    return {
      version: 1,
      users: users, requests: requests, files: files, archive: archive,
      mails: mails, logs: logs.slice(0, 20),
      settings: { currentUserId: 'U-R1', sender: 'PCT 작업관리 시스템' }
    };
  }

  /* ------------------------------------------------------------ 입출력 */

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function load() {
    if (cache) return cache;
    var ls = storage();
    if (ls) {
      try {
        var raw = ls.getItem(KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.requests && parsed.version === 1) { cache = parsed; return cache; }
        }
      } catch (e) { /* 깨진 값이면 새로 만든다 */ }
    }
    cache = seed();
    save();
    return cache;
  }

  function save() {
    var ls = storage();
    if (!ls || !cache) return;
    try { ls.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { /* 용량 초과 — 데모라 조용히 넘긴다. 파일 본문을 안 담는 이유이기도 하다 */ }
  }

  function reset() { cache = seed(); save(); return cache; }

  /* ------------------------------------------------------------ 읽기 */

  function users()    { return load().users; }
  function requests() { return load().requests; }
  function files()    { return load().files; }
  function archive()  { return load().archive; }
  function mails()    { return load().mails; }
  function logs()     { return load().logs; }

  function user(id) {
    return load().users.filter(function (u) { return u.id === id; })[0] || null;
  }
  function request(id) {
    return load().requests.filter(function (r) { return r.id === id; })[0] || null;
  }
  function currentUser() { return user(load().settings.currentUserId); }
  function setCurrentUser(id) { load().settings.currentUserId = id; save(); return currentUser(); }

  function deliverables(requestId) {
    return load().files.filter(function (f) { return f.requestId === requestId; })
      .sort(function (a, b) {
        return String(a.kind).localeCompare(String(b.kind)) || a.version - b.version;
      });
  }

  /* ------------------------------------------------------------ 이력 */

  function log(action, target, detail) {
    var db = load();
    db.logs.unshift({
      at: nowIso(), actorId: db.settings.currentUserId,
      action: action, target: target || '', detail: detail || ''
    });
    db.logs = db.logs.slice(0, 300);
    save();
  }

  /* ------------------------------------------------------------ 쓰기 */

  /** 신규 작업 요청. 검증은 Logic 이 하고, 여기서는 저장만 한다. */
  function addRequest(input, actor) {
    var db = load();
    var errors = Logic.validateRequest(input, today());
    if (errors.length) return { ok: false, errors: errors, request: null };

    var owner = actor || currentUser();
    var r = {
      id: Logic.nextRequestId(db.requests),
      partNo: Logic.normalizePartNo(input.partNo),
      partName: String(input.partName).trim(),
      model: String(input.model).trim(),
      requesterId: owner ? owner.id : null,
      requesterName: owner ? owner.name : '',
      requesterEmail: String(input.requesterEmail).trim(),
      requestedAt: input.requestedAt,
      dueDate: input.dueDate,
      eta: null,
      assigneeId: input.assigneeId || null,
      status: Logic.STATUS.REQ,
      submittedAt: null, closedAt: null,
      note: String(input.note || '').trim(),
      reviewNote: ''
    };
    db.requests.push(r);
    save();
    log('요청 등록', r.id, r.partNo + ' ' + r.partName);
    return { ok: true, errors: [], request: r };
  }

  function updateRequest(id, patch, actor) {
    var r = request(id);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다' };
    if (!Logic.canEditRequest(actor || currentUser(), r))
      return { ok: false, reason: '본인이 등록한 요청만 수정할 수 있습니다' };

    var merged = {
      partNo: patch.partNo !== undefined ? patch.partNo : r.partNo,
      partName: patch.partName !== undefined ? patch.partName : r.partName,
      model: patch.model !== undefined ? patch.model : r.model,
      requestedAt: patch.requestedAt !== undefined ? patch.requestedAt : r.requestedAt,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : r.dueDate,
      requesterEmail: patch.requesterEmail !== undefined ? patch.requesterEmail : r.requesterEmail
    };
    var errors = Logic.validateRequest(merged, today());
    if (errors.length) return { ok: false, reason: errors[0].message, errors: errors };

    r.partNo = Logic.normalizePartNo(merged.partNo);
    r.partName = merged.partName; r.model = merged.model;
    r.requestedAt = merged.requestedAt; r.dueDate = merged.dueDate;
    r.requesterEmail = merged.requesterEmail;
    if (patch.note !== undefined) r.note = patch.note;
    if (patch.assigneeId !== undefined) r.assigneeId = patch.assigneeId || null;
    save();
    log('요청 수정', r.id, r.partNo);
    return { ok: true, reason: '' };
  }

  /** 수행자 배정. 승인되지 않은 외부 계정에는 배정할 수 없다. */
  function assign(id, workerId, actor) {
    var r = request(id);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다' };
    var me = actor || currentUser();
    if (!(me && (me.role === Logic.ROLE.REQUESTER || me.role === Logic.ROLE.ADMIN)))
      return { ok: false, reason: '배정은 작업 요청자만 할 수 있습니다' };
    var w = user(workerId);
    if (!w) return { ok: false, reason: '수행자를 찾을 수 없습니다' };
    if (w.role !== Logic.ROLE.WORKER || w.status !== Logic.ACCOUNT.APPROVED)
      return { ok: false, reason: '승인된 작업 수행자에게만 배정할 수 있습니다' };
    r.assigneeId = workerId;
    save();
    log('수행자 배정', r.id, w.name);
    return { ok: true, reason: '' };
  }

  function setEta(id, eta, actor) {
    var r = request(id);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다' };
    var me = actor || currentUser();
    var owner = me && (me.role === Logic.ROLE.REQUESTER || me.role === Logic.ROLE.ADMIN);
    if (!(owner || (me && r.assigneeId === me.id)))
      return { ok: false, reason: '배정된 수행자만 예상완료일을 바꿀 수 있습니다' };
    var v = Logic.validateEta(eta, r);
    if (!v.ok) return v;
    r.eta = eta;
    save();
    log('예상완료일 변경', r.id, eta);
    return { ok: true, reason: '' };
  }

  /**
   * 상태 변경. 판정은 Logic.canTransition 이 하고 여기서는 부수 효과만 맡는다.
   * (제출일·완료일 기록, 이력 남기기)
   */
  function setStatus(id, to, actor, reason) {
    var r = request(id);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다' };
    var me = actor || currentUser();
    var ctx = {
      role: me ? me.role : null,
      isAssignee: !!(me && r.assigneeId === me.id),
      hasAssignee: !!r.assigneeId,
      deliverableCount: deliverables(r.id).length,
      reason: reason
    };
    var v = Logic.canTransition(r.status, to, ctx);
    if (!v.ok) return v;

    var from = r.status;
    r.status = to;
    if (to === Logic.STATUS.REVIEW && from === Logic.STATUS.WORK) r.submittedAt = today();
    if (to === Logic.STATUS.DONE) r.closedAt = today();
    if (to === Logic.STATUS.WORK && from === Logic.STATUS.REVIEW) {
      r.closedAt = null;
      r.reviewNote = String(reason || '');
    }
    if (to === Logic.STATUS.REVIEW && from === Logic.STATUS.DONE) {
      r.closedAt = null;
      r.reviewNote = String(reason || '');
    }
    save();
    log('상태 변경', r.id, from + ' → ' + to + (reason ? ' (' + reason + ')' : ''));
    return { ok: true, reason: '' };
  }

  /**
   * 산출물 등록. 파일 본문은 담지 않는다(위 주석 참조).
   * @param {Array} picked [{name, size}] — <input type=file> 의 File 도 그대로 들어온다
   */
  function addFiles(requestId, picked, actor) {
    var r = request(requestId);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다', added: 0 };
    var me = actor || currentUser();
    var kind = Logic.uploadKind(me, r);
    if (!kind) {
      return {
        ok: false, added: 0,
        reason: r.status === Logic.STATUS.REQ
          ? '작업중 상태에서만 산출물을 올릴 수 있습니다'
          : '지금 이 건에 파일을 올릴 권한이 없습니다'
      };
    }
    var list = [].slice.call(picked || []).filter(function (f) { return f && f.name; });
    if (!list.length) return { ok: false, reason: '파일을 고르세요', added: 0 };

    var db = load();
    var n = 0;
    list.forEach(function (f) {
      db.files.push({
        id: 'F-' + (db.files.length + 1 + Math.floor(Math.random() * 1e6)),
        requestId: requestId, name: f.name, size: f.size || 0,
        kind: kind, version: Logic.nextVersion(db.files, requestId, kind),
        uploaderId: me ? me.id : null, uploadedAt: today(), link: f.link || ''
      });
      n++;
    });
    save();
    log(kind + ' 업로드', requestId, n + '건');
    return { ok: true, reason: '', added: n, kind: kind };
  }

  function removeFile(fileId, actor) {
    var db = load();
    var f = db.files.filter(function (x) { return x.id === fileId; })[0];
    if (!f) return { ok: false, reason: '파일을 찾을 수 없습니다' };
    var me = actor || currentUser();
    if (!(me && (me.role === Logic.ROLE.ADMIN || f.uploaderId === me.id)))
      return { ok: false, reason: '올린 사람만 지울 수 있습니다' };
    db.files = db.files.filter(function (x) { return x.id !== fileId; });
    save();
    log('산출물 삭제', f.requestId, f.name);
    return { ok: true, reason: '' };
  }

  /* ------------------------------------------------------------ 메일 */

  function logMail(mail, actor) {
    var db = load();
    var me = actor || currentUser();
    db.mails.unshift({
      id: 'M-' + (db.mails.length + 1 + Math.floor(Math.random() * 1e6)),
      requestId: mail.requestId || '', kind: mail.kind || '산출물 제출',
      to: mail.to, subject: mail.subject, at: today(), sentBy: me ? me.id : null
    });
    save();
    log('메일 발송', mail.requestId || '', mail.to);
    return db.mails[0];
  }

  /* ------------------------------------------------- Database(보관 자료) */

  /**
   * 옛 자료를 파일명만 보고 등록한다.
   * 확신도가 high 인 건만 자동 확정하고 나머지는 사람이 확인하도록 남긴다.
   */
  function addArchive(picked, source, actor) {
    var db = load();
    var list = [].slice.call(picked || []).filter(function (f) { return f && f.name; });
    if (!list.length) return { ok: false, reason: '파일을 고르세요', added: 0, rows: [] };

    var rows = list.map(function (f) {
      var p = Logic.parseArchiveName(f.name);
      var row = {
        id: 'A-' + (db.archive.length + 1 + Math.floor(Math.random() * 1e6)),
        name: f.name, size: f.size || 0,
        partNo: p.partNo, model: p.model, docDate: p.docDate, docMonth: p.docMonth,
        version: p.version, title: p.title, confidence: p.confidence, hints: p.hints,
        source: source || '개인 PC', registeredAt: today(),
        confirmed: p.confidence === 'high'
      };
      db.archive.push(row);
      return row;
    });
    save();
    var need = rows.filter(function (r) { return !r.confirmed; }).length;
    log('보관자료 등록', '', rows.length + '건 (확인 필요 ' + need + '건)');
    return { ok: true, reason: '', added: rows.length, rows: rows, needCheck: need };
  }

  function updateArchive(id, patch) {
    var row = load().archive.filter(function (a) { return a.id === id; })[0];
    if (!row) return { ok: false, reason: '자료를 찾을 수 없습니다' };
    if (patch.partNo !== undefined) row.partNo = patch.partNo ? Logic.normalizePartNo(patch.partNo) : null;
    if (patch.model !== undefined) row.model = patch.model || null;
    if (patch.docDate !== undefined) {
      if (patch.docDate && !Logic.isDateStr(patch.docDate))
        return { ok: false, reason: '일자를 YYYY-MM-DD 로 입력하세요' };
      row.docDate = patch.docDate || null;
      row.docMonth = patch.docDate ? patch.docDate.slice(0, 7) : row.docMonth;
    }
    if (patch.confirmed !== undefined) row.confirmed = !!patch.confirmed;
    save();
    log('보관자료 수정', row.id, row.name);
    return { ok: true, reason: '' };
  }

  function deleteArchive(id, actor) {
    var db = load();
    var me = actor || currentUser();
    if (!(me && (me.role === Logic.ROLE.ADMIN || me.role === Logic.ROLE.REQUESTER)))
      return { ok: false, reason: '보관 자료 삭제는 요청자·관리자만 할 수 있습니다' };
    var row = db.archive.filter(function (a) { return a.id === id; })[0];
    if (!row) return { ok: false, reason: '자료를 찾을 수 없습니다' };
    db.archive = db.archive.filter(function (a) { return a.id !== id; });
    save();
    log('보관자료 삭제', id, row.name);
    return { ok: true, reason: '' };
  }

  /* ------------------------------------------------------------ 사용자 */

  /** 외부 인원 가입 승인/거절. 관리자만. */
  function setUserStatus(userId, status, actor) {
    var me = actor || currentUser();
    if (!Logic.canManageUsers(me)) return { ok: false, reason: '권한 관리는 관리자만 할 수 있습니다' };
    var u = user(userId);
    if (!u) return { ok: false, reason: '사용자를 찾을 수 없습니다' };
    if ([Logic.ACCOUNT.PENDING, Logic.ACCOUNT.APPROVED, Logic.ACCOUNT.REJECTED].indexOf(status) < 0)
      return { ok: false, reason: '알 수 없는 상태입니다' };
    u.status = status;
    u.decidedAt = today();
    u.decidedBy = me.id;

    // 승인이 풀린 계정에 배정된 건은 배정을 비운다.
    // 그대로 두면 "볼 수 없는 사람에게 배정된 요청" 이 남는다.
    if (status !== Logic.ACCOUNT.APPROVED) {
      load().requests.forEach(function (r) {
        if (r.assigneeId === userId && r.status !== Logic.STATUS.DONE) r.assigneeId = null;
      });
    }
    save();
    log('계정 ' + status, userId, u.name);
    return { ok: true, reason: '' };
  }

  function addUser(input, actor) {
    var db = load();
    var email = String(input.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: '메일 주소를 확인하세요' };
    if (db.users.some(function (u) { return u.email.toLowerCase() === email.toLowerCase(); }))
      return { ok: false, reason: '이미 등록된 메일 주소입니다' };
    if (!String(input.name || '').trim()) return { ok: false, reason: '이름을 입력하세요' };

    var u = {
      id: 'U-N' + (db.users.length + 1),
      name: String(input.name).trim(), email: email,
      org: String(input.org || '').trim(),
      role: input.role === Logic.ROLE.REQUESTER ? Logic.ROLE.REQUESTER : Logic.ROLE.WORKER,
      // 가입만으로는 아무것도 못 한다. 관리자가 승인해야 열린다.
      // 서버 모드의 app_user_signup 정책도 '승인대기' 외의 값을 거부한다 — 규칙을 하나로 둔다.
      status: Logic.ACCOUNT.PENDING,
      joinedAt: today(), decidedAt: null, decidedBy: null
    };
    db.users.push(u);
    save();
    log('계정 신청', u.id, u.name + ' (' + u.role + ')');
    return { ok: true, reason: '', user: u };
  }

  return {
    KEY: KEY,
    today: today, offToDate: offToDate,
    load: load, save: save, reset: reset, _seed: seed,

    users: users, requests: requests, files: files, archive: archive,
    mails: mails, logs: logs,
    user: user, request: request, deliverables: deliverables,
    currentUser: currentUser, setCurrentUser: setCurrentUser,

    addRequest: addRequest, updateRequest: updateRequest, assign: assign,
    setEta: setEta, setStatus: setStatus,
    addFiles: addFiles, removeFile: removeFile,
    logMail: logMail,
    addArchive: addArchive, updateArchive: updateArchive, deleteArchive: deleteArchive,
    setUserStatus: setUserStatus, addUser: addUser,
    log: log
  };
});
