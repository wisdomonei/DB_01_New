/**
 * Supabase 어댑터 — js/store.js 와 **같은 모양의 API** 를 Postgres 위에 올린다.
 *
 * 설계 원칙: 화면(app.js)과 규칙(logic.js)은 저장 위치를 몰라야 한다.
 * 그래서 이 파일은 Store 와 똑같은 함수 이름·반환값을 내놓고,
 * app.js 는 `DB` 하나만 보고 쓴다.
 *
 * 읽기는 시작할 때 한 번에 받아 메모리에 올리고, 쓰기는 그때그때 보낸다.
 * 요청이 수백 건 규모라 전량을 받아도 가볍고, 화면 계산이 전부 동기 함수라
 * 이 방식이 코드가 훨씬 단순하다.
 *
 * 쓰기는 **낙관적**이다. 규칙 판정(logic.js)을 먼저 돌려 통과한 것만
 * 메모리에 반영하고 서버로 보낸다. 서버가 거절하면 — RLS 나 트리거가 막았다는
 * 뜻이므로 — 조용히 넘기지 않고 알린 뒤 서버 상태로 다시 읽어 온다.
 * 화면이 서버보다 앞서 나간 채로 남는 것이 가장 나쁘다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SupabaseStore = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Logic = root.Logic || (typeof require === 'function' ? require('./logic.js') : null);

  var sb = null;        // supabase 클라이언트
  var db = null;        // Store 와 같은 모양의 메모리 사본
  var meId = null;      // 로그인한 사람의 app_user.id (= auth.uid())

  /* ------------------------------------------------------------ 오류 알림 */

  function shout(msg) {
    // root 는 브라우저에서 window, node 에서는 module.exports 다(UMD 관용구).
    // 알림 함수는 전역에 붙으므로 둘 다 본다.
    var g = (typeof globalThis !== 'undefined') ? globalThis : root;
    var fn = (typeof root.PCT_TOAST === 'function') ? root.PCT_TOAST
           : (typeof g.PCT_TOAST === 'function') ? g.PCT_TOAST : null;
    if (fn) fn(msg, true);
    else if (typeof console !== 'undefined') console.error(msg);
  }

  /** 서버가 거절했다 — 화면이 앞서 나간 채로 두지 않고 다시 읽는다. */
  function rejected(where, error) {
    shout(where + ' — 서버가 거절했습니다: ' + (error && error.message || '알 수 없는 오류'));
    reload().catch(function () { /* 이미 알렸다 */ });
  }

  /* ------------------------------------------------------------ 접속 */

  function cfg() { return root.APP_CONFIG || {}; }

  /** supabase-js 를 필요할 때만 불러온다. 데모 모드에서는 CDN 을 건드리지 않는다. */
  function loadSdk() {
    if (root.supabase && root.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = root.document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('supabase-js 를 불러오지 못했습니다 (사내망 차단 가능)')); };
      root.document.head.appendChild(s);
    });
  }

  /**
   * 서버 모드로 올라간다.
   * @param {object} injected  테스트에서 가짜 클라이언트를 넣을 때만 쓴다
   * @returns {Promise<boolean>} 성공하면 true. 실패하면 예외 — app.js 가 데모로 내려간다.
   */
  function init(injected) {
    var c = cfg();
    if (injected) { sb = injected; return signIn().then(loadAll).then(function () { return true; }); }
    if (!c.USE_SUPABASE) return Promise.resolve(false);
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY)
      return Promise.reject(new Error('config.js 에 SUPABASE_URL / SUPABASE_ANON_KEY 를 채우세요'));

    return loadSdk().then(function () {
      sb = root.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
      return signIn();
    }).then(loadAll).then(function () { return true; });
  }

  /**
   * 로그인. 이미 세션이 있으면 그대로 쓰고, 없으면 물어본다.
   *
   * RLS 정책이 전부 `to authenticated` 라 비로그인으로는 한 줄도 못 읽는다.
   * 정책을 anon 까지 열면 링크를 아는 누구나 사내 품번을 보게 된다 — 열지 않는다.
   */
  function signIn() {
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (session && session.user) { meId = session.user.id; return; }

      var email = root.prompt && root.prompt('Supabase 계정 메일');
      if (!email) throw new Error('로그인이 필요합니다');
      var pw = root.prompt && root.prompt('비밀번호');
      if (!pw) throw new Error('로그인이 필요합니다');

      return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        if (r.error) throw new Error('로그인 실패: ' + r.error.message);
        meId = r.data.user.id;
      });
    });
  }

  /* ------------------------------------------------------------ 읽기 */

  function pick(table) {
    return sb.from(table).select('*').then(function (r) {
      if (r.error) throw new Error(table + ' 을 읽지 못했습니다: ' + r.error.message);
      return r.data || [];
    });
  }

  function loadAll() {
    return Promise.all([
      pick('app_user'), pick('request'), pick('deliverable'),
      pick('archive_doc'), pick('mail_log'), pick('activity_log')
    ]).then(function (all) {
      var users = all[0].map(fromUser);
      var byId = {};
      users.forEach(function (u) { byId[u.id] = u; });

      db = {
        version: 1,
        users: users,
        requests: all[1].map(function (r) { return fromRequest(r, byId); }),
        files: all[2].map(fromFile),
        archive: all[3].map(fromArchive),
        mails: all[4].map(fromMail),
        logs: all[5].map(fromLog),
        settings: { currentUserId: meId, sender: 'PCT 작업관리 시스템' }
      };
      if (!byId[meId]) {
        throw new Error('로그인한 계정이 app_user 에 없습니다. schema.sql 의 「첫 관리자 심기」를 참고하세요');
      }
      return true;
    });
  }

  function reload() { return loadAll(); }

  /* ------------------------------------------------------- 행 모양 맞추기 */

  function fromUser(r) {
    return { id: r.id, name: r.name, email: r.email, org: r.org || '', role: r.role,
             status: r.status, joinedAt: r.joined_at, decidedAt: r.decided_at, decidedBy: r.decided_by };
  }
  function fromRequest(r, byId) {
    var owner = byId[r.requester_id] || {};
    return { id: r.id, partNo: r.part_no, partName: r.part_name, model: r.model,
             requesterId: r.requester_id, requesterName: owner.name || '',
             requesterEmail: r.requester_email, assigneeId: r.assignee_id,
             requestedAt: r.requested_at, dueDate: r.due_date, eta: r.eta,
             status: r.status, submittedAt: r.submitted_at, closedAt: r.closed_at,
             note: r.note || '', reviewNote: r.review_note || '' };
  }
  function fromFile(r) {
    return { id: r.id, requestId: r.request_id, name: r.name, size: Number(r.size_bytes) || 0,
             kind: r.kind, version: r.version, uploaderId: r.uploader_id,
             uploadedAt: r.uploaded_at, link: r.link || '' };
  }
  function fromArchive(r) {
    return { id: r.id, name: r.name, size: Number(r.size_bytes) || 0, partNo: r.part_no,
             model: r.model, docDate: r.doc_date, docMonth: r.doc_month, version: r.version,
             title: r.title || '', confidence: r.confidence, hints: [],
             source: r.source || '', registeredAt: r.registered_at, confirmed: !!r.confirmed };
  }
  function fromMail(r) {
    return { id: r.id, requestId: r.request_id, kind: r.kind, to: r.to_addr,
             subject: r.subject, at: String(r.sent_at || '').slice(0, 10), sentBy: r.sent_by };
  }
  function fromLog(r) {
    return { at: r.at, actorId: r.actor_id, action: r.action,
             target: r.target || '', detail: r.detail || '' };
  }

  /* ------------------------------------------------------------ 도우미 */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + Logic.pad2(d.getMonth() + 1) + '-' + Logic.pad2(d.getDate());
  }
  function offToDate(off) {
    var d = new Date(); d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + Logic.pad2(d.getMonth() + 1) + '-' + Logic.pad2(d.getDate());
  }

  function users()    { return db.users; }
  function requests() { return db.requests; }
  function files()    { return db.files; }
  function archive()  { return db.archive; }
  function mails()    { return db.mails; }
  function logs()     { return db.logs; }
  function user(id)   { return db.users.filter(function (u) { return u.id === id; })[0] || null; }
  function request(id){ return db.requests.filter(function (r) { return r.id === id; })[0] || null; }
  function currentUser() { return user(meId); }

  /** 서버 모드에서는 로그인한 사람이 곧 나다 — 계정 전환은 없다. */
  function setCurrentUser() { return currentUser(); }

  function deliverables(requestId) {
    return db.files.filter(function (f) { return f.requestId === requestId; })
      .sort(function (a, b) {
        return String(a.kind).localeCompare(String(b.kind)) || a.version - b.version;
      });
  }

  /** 이력은 남기지 못해도 본 작업을 되돌리지 않는다 — 조용히 흘려보내고 알리기만 한다. */
  function log(action, target, detail) {
    var row = { actor_id: meId, action: action, target: target || '', detail: detail || '' };
    db.logs.unshift({ at: new Date().toISOString(), actorId: meId,
                      action: action, target: row.target, detail: row.detail });
    db.logs = db.logs.slice(0, 300);
    return sb.from('activity_log').insert([row]).then(function (r) {
      if (r.error) shout('활동 이력을 남기지 못했습니다: ' + r.error.message);
    });
  }

  /* ------------------------------------------------------------ 쓰기 */

  function addRequest(input, actor) {
    var me = actor || currentUser();
    var errors = Logic.validateRequest(input, today());
    if (errors.length) return { ok: false, errors: errors, request: null };

    var r = {
      id: Logic.nextRequestId(db.requests),
      partNo: Logic.normalizePartNo(input.partNo),
      partName: String(input.partName).trim(),
      model: String(input.model).trim(),
      requesterId: me.id, requesterName: me.name,
      requesterEmail: String(input.requesterEmail).trim(),
      requestedAt: input.requestedAt, dueDate: input.dueDate, eta: null,
      assigneeId: input.assigneeId || null, status: Logic.STATUS.REQ,
      submittedAt: null, closedAt: null,
      note: String(input.note || '').trim(), reviewNote: ''
    };
    db.requests.push(r);

    sb.from('request').insert([{
      id: r.id, part_no: r.partNo, part_name: r.partName, model: r.model,
      requester_id: r.requesterId, requester_email: r.requesterEmail,
      assignee_id: r.assigneeId, requested_at: r.requestedAt, due_date: r.dueDate,
      status: r.status, note: r.note
    }]).then(function (res) {
      if (res.error) rejected('요청 등록', res.error);
      else log('요청 등록', r.id, r.partNo + ' ' + r.partName);
    });
    return { ok: true, errors: [], request: r };
  }

  function patchRequest(id, patch, mem, note) {
    Object.keys(mem).forEach(function (k) { request(id)[k] = mem[k]; });
    sb.from('request').update(patch).eq('id', id).then(function (res) {
      if (res.error) rejected(note, res.error);
      else log(note, id, JSON.stringify(patch));
    });
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
    merged.partNo = Logic.normalizePartNo(merged.partNo);

    patchRequest(id, {
      part_no: merged.partNo, part_name: merged.partName, model: merged.model,
      requested_at: merged.requestedAt, due_date: merged.dueDate,
      requester_email: merged.requesterEmail
    }, merged, '요청 수정');
    return { ok: true, reason: '' };
  }

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

    patchRequest(id, { assignee_id: workerId }, { assigneeId: workerId }, '수행자 배정');
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

    patchRequest(id, { eta: eta }, { eta: eta }, '예상완료일 변경');
    return { ok: true, reason: '' };
  }

  function setStatus(id, to, actor, reason) {
    var r = request(id);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다' };
    var me = actor || currentUser();
    var v = Logic.canTransition(r.status, to, {
      role: me ? me.role : null,
      isAssignee: !!(me && r.assigneeId === me.id),
      hasAssignee: !!r.assigneeId,
      deliverableCount: deliverables(r.id).length,
      reason: reason
    });
    if (!v.ok) return v;

    var from = r.status;
    var mem = { status: to }, patch = { status: to };
    if (to === Logic.STATUS.REVIEW && from === Logic.STATUS.WORK) {
      mem.submittedAt = today(); patch.submitted_at = mem.submittedAt;
    }
    if (to === Logic.STATUS.DONE) { mem.closedAt = today(); patch.closed_at = mem.closedAt; }
    else { mem.closedAt = null; patch.closed_at = null; }
    if (to === Logic.STATUS.WORK && from === Logic.STATUS.REVIEW ||
        to === Logic.STATUS.REVIEW && from === Logic.STATUS.DONE) {
      mem.reviewNote = String(reason || ''); patch.review_note = mem.reviewNote;
    }

    patchRequest(id, patch, mem, '상태 변경');
    return { ok: true, reason: '' };
  }

  function addFiles(requestId, picked, actor) {
    var r = request(requestId);
    if (!r) return { ok: false, reason: '요청을 찾을 수 없습니다', added: 0 };
    var me = actor || currentUser();
    var kind = Logic.uploadKind(me, r);
    if (!kind) {
      return { ok: false, added: 0,
        reason: r.status === Logic.STATUS.REQ
          ? '작업중 상태에서만 산출물을 올릴 수 있습니다'
          : '지금 이 건에 파일을 올릴 권한이 없습니다' };
    }
    var list = [].slice.call(picked || []).filter(function (f) { return f && f.name; });
    if (!list.length) return { ok: false, reason: '파일을 고르세요', added: 0 };

    // 원본 위치는 화면에서 href 로 쓰인다. http(s) 가 아니면 받지 않는다.
    var bad = list.filter(function (f) {
      return String(f.link || '').trim() && !Logic.isSafeLink(f.link);
    })[0];
    if (bad) return { ok: false, added: 0, reason: '원본 위치는 http:// 또는 https:// 주소여야 합니다' };

    // 버전은 서버 트리거가 매긴다. 여기서 매기면 두 사람이 동시에 올릴 때 같은 번호가 나온다.
    var rows = list.map(function (f) {
      return { request_id: requestId, name: f.name, size_bytes: f.size || 0,
               kind: kind, uploader_id: me.id, link: String(f.link || '').trim() };
    });
    var made = [];
    sb.from('deliverable').insert(rows).select().then(function (res) {
      if (res.error) { rejected('산출물 등록', res.error); return; }
      (res.data || []).forEach(function (row) {
        var mapped = fromFile(row);
        db.files.push(mapped);
        made.push(mapped);
      });
      log(kind + ' 업로드', requestId, rows.length + '건');
    });
    // 서버가 id 를 매기므로 여기서는 아직 행이 없다.
    // 사본 보관은 화면이 addFiles 가 돌려준 files 로 하는데, 서버 모드에서는
    // 그 배열이 조금 뒤에 채워진다 — 그래서 같은 배열을 돌려준다(참조).
    return { ok: true, reason: '', added: rows.length, kind: kind, files: made };
  }

  function removeFile(fileId, actor) {
    var f = db.files.filter(function (x) { return x.id === fileId; })[0];
    if (!f) return { ok: false, reason: '파일을 찾을 수 없습니다' };
    var me = actor || currentUser();
    if (!(me && (me.role === Logic.ROLE.ADMIN || f.uploaderId === me.id)))
      return { ok: false, reason: '올린 사람만 지울 수 있습니다' };
    db.files = db.files.filter(function (x) { return x.id !== fileId; });
    sb.from('deliverable').delete().eq('id', fileId).then(function (res) {
      if (res.error) rejected('산출물 삭제', res.error);
      else log('산출물 삭제', f.requestId, f.name);
    });
    return { ok: true, reason: '' };
  }

  function logMail(mail) {
    var row = { request_id: mail.requestId || null, kind: mail.kind || '산출물 제출',
                to_addr: mail.to, subject: mail.subject, sent_by: meId };
    db.mails.unshift({ id: 'tmp', requestId: row.request_id, kind: row.kind,
                       to: row.to_addr, subject: row.subject, at: today(), sentBy: meId });
    sb.from('mail_log').insert([row]).then(function (res) {
      if (res.error) rejected('메일 이력', res.error);
      else log('메일 발송', row.request_id || '', row.to_addr);
    });
    return db.mails[0];
  }

  function addArchive(picked, source, actor) {
    var me = actor || currentUser();
    if (!Logic.canReview(me)) return { ok: false, reason: '보관 자료 등록은 요청자·관리자만 할 수 있습니다', added: 0, rows: [] };
    var list = [].slice.call(picked || []).filter(function (f) { return f && f.name; });
    if (!list.length) return { ok: false, reason: '파일을 고르세요', added: 0, rows: [] };

    var parsed = list.map(function (f) {
      var p = Logic.parseArchiveName(f.name);
      return { p: p, size: f.size || 0 };
    });
    var rows = parsed.map(function (x) {
      return { name: x.p.name, size_bytes: x.size, part_no: x.p.partNo, model: x.p.model,
               doc_date: x.p.docDate, doc_month: x.p.docMonth, version: x.p.version,
               title: x.p.title, confidence: x.p.confidence, source: source || '개인 PC',
               confirmed: x.p.confidence === 'high' };
    });
    var out = [];
    sb.from('archive_doc').insert(rows).select().then(function (res) {
      if (res.error) { rejected('보관 자료 등록', res.error); return; }
      (res.data || []).forEach(function (row, i) {
        var mapped = fromArchive(row);
        mapped.hints = parsed[i] ? parsed[i].p.hints : [];
        db.archive.push(mapped);
      });
      log('보관자료 등록', '', rows.length + '건');
    });
    parsed.forEach(function (x, i) {
      out.push({ id: 'tmp-' + i, name: x.p.name, size: x.size, partNo: x.p.partNo,
                 model: x.p.model, docDate: x.p.docDate, docMonth: x.p.docMonth,
                 version: x.p.version, title: x.p.title, confidence: x.p.confidence,
                 hints: x.p.hints, source: source || '개인 PC', registeredAt: today(),
                 confirmed: x.p.confidence === 'high' });
    });
    return { ok: true, reason: '', added: out.length, rows: out,
             needCheck: out.filter(function (r) { return !r.confirmed; }).length };
  }

  function updateArchive(id, patch) {
    var row = db.archive.filter(function (a) { return a.id === id; })[0];
    if (!row) return { ok: false, reason: '자료를 찾을 수 없습니다' };
    var up = {};
    if (patch.partNo !== undefined) {
      row.partNo = patch.partNo ? Logic.normalizePartNo(patch.partNo) : null;
      up.part_no = row.partNo;
    }
    if (patch.model !== undefined) { row.model = patch.model || null; up.model = row.model; }
    if (patch.docDate !== undefined) {
      if (patch.docDate && !Logic.isDateStr(patch.docDate))
        return { ok: false, reason: '일자를 YYYY-MM-DD 로 입력하세요' };
      row.docDate = patch.docDate || null;
      row.docMonth = patch.docDate ? patch.docDate.slice(0, 7) : row.docMonth;
      up.doc_date = row.docDate; up.doc_month = row.docMonth;
    }
    if (patch.confirmed !== undefined) { row.confirmed = !!patch.confirmed; up.confirmed = row.confirmed; }

    sb.from('archive_doc').update(up).eq('id', id).then(function (res) {
      if (res.error) rejected('보관 자료 수정', res.error);
      else log('보관자료 수정', String(id), row.name);
    });
    return { ok: true, reason: '' };
  }

  function deleteArchive(id, actor) {
    var me = actor || currentUser();
    if (!Logic.canReview(me))
      return { ok: false, reason: '보관 자료 삭제는 요청자·관리자만 할 수 있습니다' };
    var row = db.archive.filter(function (a) { return a.id === id; })[0];
    if (!row) return { ok: false, reason: '자료를 찾을 수 없습니다' };
    db.archive = db.archive.filter(function (a) { return a.id !== id; });
    sb.from('archive_doc').delete().eq('id', id).then(function (res) {
      if (res.error) rejected('보관 자료 삭제', res.error);
      else log('보관자료 삭제', String(id), row.name);
    });
    return { ok: true, reason: '' };
  }

  function setUserStatus(userId, status, actor) {
    var me = actor || currentUser();
    if (!Logic.canManageUsers(me)) return { ok: false, reason: '권한 관리는 관리자만 할 수 있습니다' };
    var u = user(userId);
    if (!u) return { ok: false, reason: '사용자를 찾을 수 없습니다' };
    if ([Logic.ACCOUNT.PENDING, Logic.ACCOUNT.APPROVED, Logic.ACCOUNT.REJECTED].indexOf(status) < 0)
      return { ok: false, reason: '알 수 없는 상태입니다' };

    u.status = status; u.decidedAt = today(); u.decidedBy = me.id;
    // 배정 해제는 서버 트리거(release_on_revoke)가 한다. 메모리도 같은 결과로 맞춘다.
    if (status !== Logic.ACCOUNT.APPROVED) {
      db.requests.forEach(function (r) {
        if (r.assigneeId === userId && r.status !== Logic.STATUS.DONE) r.assigneeId = null;
      });
    }
    sb.from('app_user').update({ status: status, decided_at: u.decidedAt, decided_by: me.id })
      .eq('id', userId).then(function (res) {
        if (res.error) rejected('계정 상태 변경', res.error);
        else log('계정 ' + status, userId, u.name);
      });
    return { ok: true, reason: '' };
  }

  /**
   * 가입 신청.
   *
   * 서버에서는 Supabase Auth 로 계정을 만든 사람이 **본인 한 줄만** 넣을 수 있다
   * (app_user_signup 정책: id = auth.uid()). 그래서 관리자가 남의 계정을
   * 대신 만들어 주는 길은 없다 — 여기서도 막아 두고 안내만 한다.
   */
  function addUser() {
    return { ok: false, reason: '서버 모드에서는 각자 Supabase Auth 로 가입한 뒤 관리자 승인을 받습니다' };
  }

  function reset() {
    shout('서버 모드에서는 데모 초기화를 쓰지 않습니다');
    return db;
  }

  return {
    init: init, reload: reload,
    today: today, offToDate: offToDate,
    load: function () { return db; },
    // 서버 모드에는 따로 저장할 것이 없다 — 쓰기가 곧 저장이다.
    // Store 와 함수 목록을 맞추려고 둔다(app.js 가 둘을 갈아 끼운다).
    save: function () {},
    users: users, requests: requests, files: files, archive: archive, mails: mails, logs: logs,
    user: user, request: request, deliverables: deliverables,
    currentUser: currentUser, setCurrentUser: setCurrentUser,
    addRequest: addRequest, updateRequest: updateRequest, assign: assign,
    setEta: setEta, setStatus: setStatus,
    addFiles: addFiles, removeFile: removeFile, logMail: logMail,
    addArchive: addArchive, updateArchive: updateArchive, deleteArchive: deleteArchive,
    setUserStatus: setUserStatus, addUser: addUser,
    log: log, reset: reset
  };
});
