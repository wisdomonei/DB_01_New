/**
 * 화면 — 데이터 접근은 전부 DB(=Store 또는 SupabaseStore) 를 거친다.
 *
 * 판정은 하나도 여기서 하지 않는다. 무엇을 할 수 있고 없는지는 js/logic.js 가
 * 정하고, 이 파일은 그 결과를 그리기만 한다. 화면에서 한 번 더 판단하면
 * 규칙이 두 군데로 갈라져 반드시 어긋난다.
 */
(function (root) {
  'use strict';

  var L = root.Logic, Charts = root.Charts;
  var DB = root.Store;                       // 서버 모드면 boot() 에서 갈아 끼운다

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  var VIEWS = {
    dashboard: ['대시보드', '부품원가계산서 작업 전체 현황'],
    requests:  ['작업 요청 관리', '요청 등록 · 조회 · 검색 필터'],
    work:      ['작업 수행 관리', '진행 상태 갱신 · 산출물 업로드 · 완료 메일'],
    files:     ['산출물 관리', '요청 품번별 산출물 보관과 이력'],
    review:    ['검토 / 수정 관리', '요청자 최종 검토와 수정본 버전 이력'],
    db:        ['Database 관리', '흩어져 있던 옛 원가계산서를 파일명으로 정리'],
    users:     ['사용자 · 권한 관리', '외부 작업 수행자 가입 승인']
  };

  var state = {
    view: 'dashboard',
    detailId: null,
    archivePreview: null,
    req:  { keyword: '', status: '', model: '', assignee: '', from: '', to: '' },
    work: { keyword: '', status: '' },
    file: { keyword: '', kind: '' },
    arch: { keyword: '', from: '', to: '', needOnly: false },
    trendMonths: 6,
    // 164행을 한 번에 뿌리면 스크롤 말고는 아무것도 못 한다. 50행씩 늘린다.
    limit: { req: 50, file: 50, arch: 50 }
  };
  var PAGE = 50;

  /* ============================================================== 도우미 */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function me() { return DB.currentUser(); }
  function today() { return DB.today(); }

  function nameOf(id) {
    var u = id ? DB.user(id) : null;
    return u ? u.name : '';
  }

  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast hidden'; }, 3200);
  }
  // 서버 모드 어댑터가 "서버가 거절했다" 를 알릴 통로. 없으면 콘솔로만 남는다.
  root.PCT_TOAST = toast;

  /**
   * 상태 배지. 테마의 ok / bad / info 색을 그대로 쓴다.
   *
   * 주의(경고)만 `warn` 이 아니라 `badge-warn` 을 쓴다. 공통 테마에는
   * 안내 띠용 `.warn { margin: 22px 0 }` 규칙이 따로 있어서, 배지에 맨 `warn`
   * 을 붙이면 표의 그 행만 두 배 높이가 된다. 테마가 함께 제공하는 별칭이라
   * 색과 ■ 표식은 똑같이 붙는다.
   */
  function statusBadge(s) {
    var cls = { '요청': 'info', '작업중': 'ok', '검토/수정': 'badge-warn', '완료': '' }[s] || '';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }

  /** 일정 신호 배지. 완료 건은 회색으로 두고 지연으로 세지 않는다. */
  function flagBadge(r) {
    var f = L.scheduleFlag(r, today());
    var cls = { '지연': 'bad', '오늘': 'badge-warn', '임박': 'badge-warn',
                '정상': 'ok', '완료': '', '미정': '' }[f];
    return '<span class="badge ' + (cls || '') + '">' + f + '</span>';
  }

  /** 표 아래 "더 보기". 잘라 낸 사실을 숨기지 않고 몇 건이 남았는지 적는다. */
  function moreRow(key, shown, total) {
    var host = document.getElementById('more-' + key);
    if (!host) return;
    if (shown >= total) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="more-row">' +
      '<button type="button" class="btn small" data-more="' + key + '">' +
      Math.min(PAGE, total - shown) + '건 더 보기</button>' +
      '<span class="muted">전체 ' + total + '건 중 ' + shown + '건을 보고 있습니다 — ' +
      '검색으로 좁히면 더 빨리 찾습니다</span></div>';
  }

  function emptyRow(cols, msg) {
    return '<tr><td class="empty" colspan="' + cols + '">' + esc(msg) + '</td></tr>';
  }

  function table(host, head, rows, emptyMsg) {
    var el = typeof host === 'string' ? $(host) : host;
    el.innerHTML =
      '<thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + (rows.length ? rows.join('') : emptyRow(head.length, emptyMsg || '표시할 자료가 없습니다')) + '</tbody>';
  }

  /* ============================================================== 라우팅 */

  function go(view) {
    if (!VIEWS[view]) view = 'dashboard';
    state.view = view;
    $$('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    $$('.view').forEach(function (v) {
      v.classList.toggle('hidden', v.id !== 'view-' + view);
    });
    $('#viewTitle').textContent = VIEWS[view][0];
    $('#viewSub').textContent = VIEWS[view][1];
    render();
    root.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ============================================================== 렌더 */

  function render() {
    renderChrome();
    ({
      dashboard: renderDashboard,
      requests:  renderRequests,
      work:      renderWork,
      files:     renderFiles,
      review:    renderReview,
      db:        renderDb,
      users:     renderUsers
    }[state.view] || renderDashboard)();
  }

  function renderChrome() {
    var u = me();
    $('#whoName').textContent = u ? u.name : '(로그인 없음)';
    $('#whoRole').textContent = u ? (u.role + (u.org ? ' · ' + u.org : '')) : '';

    var sum = L.summarize(visible(), DB.files(), today());
    $('#chipOverdue').textContent = '지연 ' + sum.overdue + '건';
    $('#chipOverdue').className = 'pill ' + (sum.overdue ? 'bad' : 'ok');

    var pend = DB.users().filter(function (x) { return x.status === L.ACCOUNT.PENDING; }).length;
    $('#chipPending').textContent = '가입 승인 대기 ' + pend + '건';
    $('#chipPending').className = 'pill ' + (pend ? 'badge-warn' : '');
    $('#chipPending').classList.toggle('hidden', !L.canManageUsers(u));

    // 권한이 없는 메뉴는 감추지 않고 눌러 볼 수 있게 둔다.
    // 감추면 "왜 안 보이지" 로 문의가 오고, 눌러서 사유를 읽으면 그 자리에서 끝난다.
    $('#reviewDenied').classList.toggle('hidden', L.canReview(u));
    $('#reviewPanel').classList.toggle('hidden', !L.canReview(u));
  }

  /** 지금 로그인한 사람이 볼 수 있는 요청. 모든 화면의 출발점이다. */
  function visible() { return L.visibleRequests(DB.requests(), me()); }

  /* -------------------------------------------------------- 대시보드 */

  function renderDashboard() {
    var rs = visible();
    var fs = DB.files().filter(byVisibleRequest(rs));
    var sum = L.summarize(rs, fs, today());

    $('#kpiRow').innerHTML = [
      kpi('총 완료 건수', sum.done, '건', '요청자가 확정해 닫은 작업'),
      kpi('작업 진행 중', sum.running, '건', '작업중 + 검토/수정'),
      kpi('오늘 완료 예정', sum.dueToday, '건', '기준일이 오늘인 미완료 작업'),
      kpi('산출물 총 개수', sum.fileCount, '개', '초안 + 수정본 전 버전')
    ].join('');

    var bd = L.statusBreakdown(rs);
    $('#donutSub').textContent = '전체 ' + rs.length + '건 기준';
    Charts.donut($('#donut'), bd);
    $('#donutLegend').innerHTML = bd.map(function (b) {
      return '<li><span class="dot" style="background:' + Charts.STATUS_COLOR[b.status] + '"></span>' +
             '<span class="lg-name">' + esc(b.status) + '</span>' +
             '<span class="lg-num">' + b.count + '건</span>' +
             '<span class="lg-pct">' + b.pct + '%</span></li>';
    }).join('');

    Charts.line($('#trend'), L.monthlyTrend(rs, today(), state.trendMonths));

    renderToday(rs);
    renderProcess(rs, fs);

    var recent = rs.slice().sort(function (a, b) {
      return String(b.requestedAt).localeCompare(String(a.requestedAt)) || b.id.localeCompare(a.id);
    }).slice(0, 6);
    table('#recentTable',
      ['요청번호', '품번', '품명', '요청일', '희망완료일', '상태'],
      recent.map(function (r) {
        return row(r, ['<td class="id">' + esc(r.id) + '</td>',
          '<td class="pn">' + esc(r.partNo) + '</td>',
          '<td>' + esc(r.partName) + '</td>',
          '<td class="nowrap">' + esc(r.requestedAt) + '</td>',
          '<td class="nowrap">' + esc(r.dueDate) + '</td>',
          '<td>' + statusBadge(r.status) + '</td>']);
      }));

    var due = L.todaySchedule(rs, today()).due.slice(0, 8);
    table('#dueTable',
      ['요청번호', '품명', '기준일', '수행자', '상태'],
      due.map(function (r) {
        return row(r, ['<td class="id">' + esc(r.id) + '</td>',
          '<td>' + esc(r.partName) + '</td>',
          '<td class="nowrap">' + esc(L.effectiveDue(r) || '-') + ' ' + flagBadge(r) + '</td>',
          '<td>' + esc(nameOf(r.assigneeId) || '미배정') + '</td>',
          '<td>' + statusBadge(r.status) + '</td>']);
      }), '오늘 처리할 작업이 없습니다');

    $('#quick').innerHTML = [
      quick('requests', '신규 작업 요청', '품번·모델·희망완료일을 등록합니다'),
      quick('work', '산출물 업로드', '진행 중인 건에 결과 파일을 올립니다'),
      quick('review', '검토 / 수정 관리', '수정본을 버전으로 쌓습니다'),
      quick('users', '사용자 · 권한 관리', '외부 인원 가입을 승인합니다')
    ].join('');

    var logs = DB.logs().slice(0, 8);
    table('#logTable', ['시각', '사용자', '작업', '대상', '내용'],
      logs.map(function (g) {
        return '<tr><td class="nowrap">' + esc(String(g.at).slice(0, 16).replace('T', ' ')) + '</td>' +
               '<td>' + esc(nameOf(g.actorId)) + '</td>' +
               '<td>' + esc(g.action) + '</td>' +
               '<td class="id">' + esc(g.target) + '</td>' +
               '<td>' + esc(g.detail) + '</td></tr>';
      }), '아직 활동 이력이 없습니다 — 요청을 등록하거나 상태를 바꿔 보세요');
  }

  function byVisibleRequest(rs) {
    var ids = {};
    rs.forEach(function (r) { ids[r.id] = true; });
    return function (f) { return ids[f.requestId]; };
  }

  function kpi(label, value, unit, note) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div>' +
           '<div class="value">' + value + '<small style="font-size:14px;font-weight:600"> ' + unit + '</small></div>' +
           '<div class="note" style="margin:6px 0 0;font-size:11.5px">' + esc(note) + '</div></div>';
  }

  function quick(view, title, desc) {
    return '<button type="button" data-goto="' + view + '"><b>' + esc(title) + '</b>' +
           '<span>' + esc(desc) + '</span></button>';
  }

  function row(r, cells) {
    return '<tr class="clickable" data-open="' + esc(r.id) + '">' + cells.join('') + '</tr>';
  }

  function renderToday(rs) {
    var t = L.todaySchedule(rs, today());
    var html = '';
    html += head('#e0913a', '완료 예정 · 지연', t.due.length);
    html += t.due.length
      ? t.due.slice(0, 5).map(line).join('')
      : '<div class="today-more">해당 건이 없습니다</div>';
    if (t.due.length > 5) html += '<div class="today-more">외 ' + (t.due.length - 5) + '건</div>';

    html += head('#22a06b', '진행 중', t.running.length);
    html += t.running.length
      ? t.running.slice(0, 5).map(line).join('')
      : '<div class="today-more">해당 건이 없습니다</div>';
    if (t.running.length > 5) html += '<div class="today-more">외 ' + (t.running.length - 5) + '건</div>';
    $('#todayList').innerHTML = html;

    function head(color, label, n) {
      return '<div class="today-head"><span class="dot" style="background:' + color + '"></span>' +
             esc(label) + ' (' + n + ')</div>';
    }
    function line(r) {
      return '<div class="today-row" data-open="' + esc(r.id) + '">' +
             '<span class="r-id">' + esc(r.id) + '</span>' +
             '<span class="r-meta">' + esc(L.effectiveDue(r) || '-') +
             ' · ' + esc(nameOf(r.assigneeId) || '미배정') + '</span></div>';
    }
  }

  function renderProcess(rs, fs) {
    var counts = {
      req:    rs.filter(function (r) { return r.status === L.STATUS.REQ; }).length,
      work:   rs.filter(function (r) { return r.status === L.STATUS.WORK; }).length,
      submit: fs.length,
      review: rs.filter(function (r) { return r.status === L.STATUS.REVIEW; }).length,
      done:   rs.filter(function (r) { return r.status === L.STATUS.DONE; }).length
    };
    $('#process').innerHTML = L.PROCESS.map(function (p, i) {
      return '<li><span class="step-no">' + (i + 1) + '</span>' +
             '<span class="step-count">' + counts[p.key] + (p.key === 'submit' ? '개' : '건') + '</span>' +
             '<b>' + esc(p.label) + '</b><p>' + esc(p.desc) + '</p></li>';
    }).join('');
  }

  /* ----------------------------------------------------- 작업 요청 관리 */

  function renderRequests() {
    var u = me();
    $('#newRequestCard').classList.toggle('hidden', !(u && (u.role === L.ROLE.REQUESTER || u.role === L.ROLE.ADMIN)));

    fillSelect($('#fReqStatus'), L.STATUS_ORDER, state.req.status, '전체');
    fillSelect($('#fReqModel'), uniq(DB.requests().map(function (r) { return r.model; })), state.req.model, '전체');
    fillSelect($('#fReqAssignee'),
      DB.users().filter(function (x) { return x.role === L.ROLE.WORKER; })
        .map(function (x) { return { value: x.id, label: x.name + ' (' + x.org + ')' }; }),
      state.req.assignee, '전체');
    fillAssignee($('#reqForm select[name=assigneeId]'));

    var all = filterRequests(visible(), state.req);
    var rows = all.slice(0, state.limit.req);
    $('#reqCount').textContent = all.length + '건';
    table('#reqTable',
      ['요청번호', '품번', '품명', '모델', '요청자', '수행자', '요청일', '희망완료일', '예상완료일', '일정', '상태'],
      rows.map(function (r) {
        var over = L.etaOverrun(r);
        return row(r, ['<td class="id">' + esc(r.id) + '</td>',
          '<td class="pn">' + esc(r.partNo) + '</td>',
          '<td>' + esc(r.partName) + '</td>',
          '<td>' + esc(r.model) + '</td>',
          '<td>' + esc(nameOf(r.requesterId)) + '</td>',
          '<td>' + esc(nameOf(r.assigneeId) || '미배정') + '</td>',
          '<td class="nowrap">' + esc(r.requestedAt) + '</td>',
          '<td class="nowrap">' + esc(r.dueDate) + '</td>',
          '<td class="nowrap">' + esc(r.eta || '-') +
            (over ? ' <span class="badge bad">+' + over + '일</span>' : '') + '</td>',
          '<td>' + flagBadge(r) + '</td>',
          '<td>' + statusBadge(r.status) + '</td>']);
      }), '조건에 맞는 요청이 없습니다');
    moreRow('req', rows.length, all.length);
  }

  function filterRequests(rs, f) {
    var kw = f.keyword.trim().toLowerCase();
    return rs.filter(function (r) {
      if (kw && [r.id, r.partNo, r.partName, r.model].join(' ').toLowerCase().indexOf(kw) < 0) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.model && r.model !== f.model) return false;
      if (f.assignee && r.assigneeId !== f.assignee) return false;
      if (f.from && String(r.requestedAt) < f.from) return false;
      if (f.to && String(r.requestedAt) > f.to) return false;
      return true;
    }).sort(function (a, b) { return b.id.localeCompare(a.id); });
  }

  /* ----------------------------------------------------- 작업 수행 관리 */

  function renderWork() {
    var u = me();
    fillSelect($('#fWorkStatus'), [L.STATUS.REQ, L.STATUS.WORK, L.STATUS.REVIEW, L.STATUS.DONE],
      state.work.status, '진행 중 전체');

    $('#workScope').textContent = u && u.role === L.ROLE.WORKER
      ? '나에게 배정된 건만' : '팀 전체';
    $('#workNote').innerHTML = u && u.role === L.ROLE.WORKER
      ? '외부 작업 수행자에게는 <b>배정된 건만</b> 보입니다. 화면에서 감추는 것이 아니라 목록 자체가 좁혀지고, 서버 모드에서는 같은 규칙을 데이터베이스가 한 번 더 막습니다.'
      : '행을 누르면 예상완료일 입력 · 상태 변경 · 산출물 업로드 · 완료 메일을 한 자리에서 처리합니다.';

    var kw = state.work.keyword.trim().toLowerCase();
    var rows = visible().filter(function (r) {
      if (state.work.status) { if (r.status !== state.work.status) return false; }
      else if (r.status === L.STATUS.DONE) return false;
      if (kw && [r.id, r.partNo, r.partName].join(' ').toLowerCase().indexOf(kw) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return String(L.effectiveDue(a) || '9999').localeCompare(String(L.effectiveDue(b) || '9999'));
    });

    table('#workTable',
      ['요청번호', '품번', '품명', '수행자', '희망완료일', '예상완료일', '산출물', '일정', '상태', ''],
      rows.map(function (r) {
        var n = DB.deliverables(r.id).length;
        return row(r, ['<td class="id">' + esc(r.id) + '</td>',
          '<td class="pn">' + esc(r.partNo) + '</td>',
          '<td>' + esc(r.partName) + ' <span class="muted">(' + esc(r.model) + ')</span></td>',
          '<td>' + esc(nameOf(r.assigneeId) || '미배정') + '</td>',
          '<td class="nowrap">' + esc(r.dueDate) + '</td>',
          '<td class="nowrap">' + esc(r.eta || '-') + '</td>',
          '<td class="num">' + n + '개</td>',
          '<td>' + flagBadge(r) + '</td>',
          '<td>' + statusBadge(r.status) + '</td>',
          '<td><button type="button" class="btn small" data-open="' + esc(r.id) + '">열기</button></td>']);
      }), '처리할 작업이 없습니다');
  }

  /* -------------------------------------------------------- 산출물 관리 */

  function renderFiles() {
    var rs = visible();
    var byId = {};
    rs.forEach(function (r) { byId[r.id] = r; });
    var kw = state.file.keyword.trim().toLowerCase();

    var fs = DB.files().filter(function (f) {
      var r = byId[f.requestId];
      if (!r) return false;
      if (state.file.kind && f.kind !== state.file.kind) return false;
      if (kw && [f.name, r.partNo, r.partName, r.id].join(' ').toLowerCase().indexOf(kw) < 0) return false;
      return true;
    }).sort(function (a, b) { return String(b.uploadedAt).localeCompare(String(a.uploadedAt)); });

    $('#fileCount').textContent = fs.length + '개';
    var shown = fs.slice(0, state.limit.file);
    table('#fileTable',
      ['요청번호', '품번', '품명', '파일명', '종류', '버전', '크기', '올린 사람', '등록일', ''],
      shown.map(function (f) {
        var r = byId[f.requestId];
        return '<tr><td class="id">' + esc(f.requestId) + '</td>' +
          '<td class="pn">' + esc(r.partNo) + '</td>' +
          '<td>' + esc(r.partName) + '</td>' +
          '<td>' + esc(f.name) + '</td>' +
          '<td>' + (f.kind === '수정본' ? '<span class="badge badge-warn">수정본</span>' : '<span class="badge info">초안</span>') + '</td>' +
          '<td class="num">v' + f.version + '</td>' +
          '<td class="num">' + L.humanSize(f.size) + '</td>' +
          '<td>' + esc(nameOf(f.uploaderId)) + '</td>' +
          '<td class="nowrap">' + esc(f.uploadedAt) + '</td>' +
          '<td><button type="button" class="btn small" data-open="' + esc(f.requestId) + '">요청 보기</button></td></tr>';
      }), '조건에 맞는 산출물이 없습니다');
    moreRow('file', shown.length, fs.length);

    table('#mailTable', ['발송일', '요청번호', '종류', '수신', '제목'],
      DB.mails().slice(0, 30).map(function (m) {
        return '<tr><td class="nowrap">' + esc(m.at) + '</td>' +
          '<td class="id">' + esc(m.requestId) + '</td>' +
          '<td>' + esc(m.kind) + '</td>' +
          '<td>' + esc(m.to) + '</td>' +
          '<td>' + esc(m.subject) + '</td></tr>';
      }), '발송 이력이 없습니다');
  }

  /* ------------------------------------------------------ 검토/수정 관리 */

  function renderReview() {
    if (!L.canReview(me())) return;
    var rs = visible().filter(function (r) {
      return r.status === L.STATUS.REVIEW || r.status === L.STATUS.DONE;
    }).sort(function (a, b) {
      if ((a.status === L.STATUS.REVIEW) !== (b.status === L.STATUS.REVIEW))
        return a.status === L.STATUS.REVIEW ? -1 : 1;
      return String(b.submittedAt).localeCompare(String(a.submittedAt));
    });

    $('#reviewCount').textContent =
      rs.filter(function (r) { return r.status === L.STATUS.REVIEW; }).length + '건 검토 대기';

    table('#reviewTable',
      ['요청번호', '품번', '품명', '수행자', '제출일', '초안', '수정본', '최신 버전', '상태', ''],
      rs.map(function (r) {
        var fs = DB.deliverables(r.id);
        var draft = fs.filter(function (f) { return f.kind === '초안'; });
        var rev = fs.filter(function (f) { return f.kind === '수정본'; });
        var latest = rev.length ? '수정본 v' + Math.max.apply(null, rev.map(function (f) { return f.version; }))
                                : (draft.length ? '초안 v' + Math.max.apply(null, draft.map(function (f) { return f.version; })) : '-');
        return row(r, ['<td class="id">' + esc(r.id) + '</td>',
          '<td class="pn">' + esc(r.partNo) + '</td>',
          '<td>' + esc(r.partName) + '</td>',
          '<td>' + esc(nameOf(r.assigneeId)) + '</td>',
          '<td class="nowrap">' + esc(r.submittedAt || '-') + '</td>',
          '<td class="num">' + draft.length + '</td>',
          '<td class="num">' + rev.length + '</td>',
          '<td class="nowrap">' + esc(latest) + '</td>',
          '<td>' + statusBadge(r.status) + '</td>',
          '<td><button type="button" class="btn small primary" data-open="' + esc(r.id) + '">검토</button></td>']);
      }), '검토할 건이 없습니다');
  }

  /* ------------------------------------------------------ Database 관리 */

  function renderDb() {
    var rows = L.archiveSearch(DB.archive(), {
      keyword: state.arch.keyword, from: state.arch.from, to: state.arch.to
    }).filter(function (r) { return !state.arch.needOnly || !r.confirmed; })
      .sort(function (a, b) {
        return String(b.docDate || b.docMonth || '').localeCompare(String(a.docDate || a.docMonth || ''));
      });

    var need = DB.archive().filter(function (r) { return !r.confirmed; }).length;
    $('#archCount').textContent = DB.archive().length + '건 중 ' + rows.length + '건 표시 · 확인 필요 ' + need + '건';

    var shown = rows.slice(0, state.limit.arch);
    table('#archTable',
      ['파일명', '품번', '모델', '문서일자', '버전', '해독', '보관 위치', '등록일', ''],
      shown.map(function (a) {
        return '<tr><td class="wrap">' + esc(a.name) +
            (a.hints && a.hints.length && !a.confirmed
              ? '<ul class="hintlist"><li>' + a.hints.map(esc).join('</li><li>') + '</li></ul>' : '') + '</td>' +
          '<td class="pn">' + esc(a.partNo || '-') + '</td>' +
          '<td>' + esc(a.model || '-') + '</td>' +
          '<td class="nowrap">' + esc(a.docDate || (a.docMonth ? a.docMonth + ' (월만)' : '-')) + '</td>' +
          '<td class="num">' + (a.version ? (a.version === 99 ? '최종' : 'v' + a.version) : '-') + '</td>' +
          '<td class="conf-' + a.confidence + ' nowrap">' + confLabel(a.confidence) + '</td>' +
          '<td>' + esc(a.source) + '</td>' +
          '<td class="nowrap">' + esc(a.registeredAt) + '</td>' +
          '<td class="nowrap">' + (a.confirmed
            ? '<span class="badge ok">확인됨</span>'
            : '<button type="button" class="btn small" data-arch-fix="' + esc(a.id) + '">보정</button>' +
              '<button type="button" class="btn small" data-arch-ok="' + esc(a.id) + '">확인</button>') + '</td></tr>';
      }), '조건에 맞는 자료가 없습니다');
    moreRow('arch', shown.length, rows.length);
  }

  function confLabel(c) {
    return { high: '자동 확정', medium: '확인 권장', low: '수동 확인' }[c] || c;
  }

  function renderArchivePreview() {
    var host = $('#archivePreview');
    var p = state.archivePreview;
    if (!p) { host.innerHTML = ''; $('#btnArchiveCommit').classList.add('hidden'); return; }

    $('#btnArchiveCommit').classList.remove('hidden');
    host.innerHTML =
      '<p class="note"><b>' + p.rows.length + '건</b> 해독했습니다 — ' +
      '자동 확정 ' + p.high + '건 · 확인 권장 ' + p.medium + '건 · 수동 확인 ' + p.low + '건. ' +
      '확신이 서지 않는 건은 값을 지어내지 않고 빈칸으로 둡니다.</p>' +
      '<div class="tablewrap"><table class="tbl"><thead><tr>' +
      ['파일명', '품번', '모델', '문서일자', '버전', '제목', '해독'].map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      p.rows.map(function (r) {
        return '<tr><td class="wrap">' + esc(r.name) +
          (r.hints.length ? '<ul class="hintlist"><li>' + r.hints.map(esc).join('</li><li>') + '</li></ul>' : '') + '</td>' +
          '<td class="pn">' + esc(r.partNo || '-') + '</td>' +
          '<td>' + esc(r.model || '-') + '</td>' +
          '<td class="nowrap">' + esc(r.docDate || (r.docMonth ? r.docMonth + ' (월만)' : '-')) + '</td>' +
          '<td class="num">' + (r.version ? (r.version === 99 ? '최종' : 'v' + r.version) : '-') + '</td>' +
          '<td>' + esc(r.title) + '</td>' +
          '<td class="conf-' + r.confidence + ' nowrap">' + confLabel(r.confidence) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ----------------------------------------------------- 사용자 · 권한 */

  function renderUsers() {
    var admin = L.canManageUsers(me());
    var pend = DB.users().filter(function (u) { return u.status === L.ACCOUNT.PENDING; });
    $('#pendingCount').textContent = pend.length + '건';

    table('#pendingTable', ['이름', '메일', '소속', '역할', '신청일', ''],
      pend.map(function (u) {
        return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td>' +
          '<td>' + esc(u.org) + '</td><td>' + esc(u.role) + '</td>' +
          '<td class="nowrap">' + esc(u.joinedAt) + '</td>' +
          '<td class="nowrap">' + (admin
            ? '<button type="button" class="btn small primary" data-approve="' + esc(u.id) + '">승인</button> ' +
              '<button type="button" class="btn small danger" data-reject="' + esc(u.id) + '">거절</button>'
            : '<span class="muted">관리자만 처리할 수 있습니다</span>') + '</td></tr>';
      }), '승인 대기 중인 신청이 없습니다');

    table('#userTable', ['이름', '메일', '소속', '역할', '상태', '가입일', '처리자', '배정 건수', ''],
      DB.users().map(function (u) {
        var n = DB.requests().filter(function (r) { return r.assigneeId === u.id; }).length;
        var cls = { '승인': 'ok', '승인대기': 'badge-warn', '거절': 'bad' }[u.status] || '';
        return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td>' +
          '<td>' + esc(u.org) + '</td><td>' + esc(u.role) + '</td>' +
          '<td><span class="badge ' + cls + '">' + esc(u.status) + '</span></td>' +
          '<td class="nowrap">' + esc(u.joinedAt) + '</td>' +
          '<td>' + esc(nameOf(u.decidedBy) || '-') + '</td>' +
          '<td class="num">' + n + '건</td>' +
          '<td class="nowrap">' + (admin && u.role === L.ROLE.WORKER
            ? (u.status === L.ACCOUNT.APPROVED
                ? '<button type="button" class="btn small" data-reject="' + esc(u.id) + '">승인 취소</button>'
                : '<button type="button" class="btn small primary" data-approve="' + esc(u.id) + '">승인</button>')
            : '') + '</td></tr>';
      }));
  }

  /* ============================================================== 상세 */

  function openDetail(id) {
    var r = DB.request(id);
    if (!r) return;
    if (!visible().some(function (x) { return x.id === id; })) {
      toast('이 요청은 열람 권한이 없습니다', true);
      return;
    }
    state.detailId = id;
    $('#modalTitle').textContent = r.id + ' · ' + r.partNo + ' ' + r.partName;
    $('#modal').classList.remove('hidden');
    renderDetail();
  }

  function closeDetail() {
    state.detailId = null;
    $('#modal').classList.add('hidden');
  }

  function renderDetail() {
    var r = DB.request(state.detailId);
    if (!r) { closeDetail(); return; }
    var u = me();
    var fs = DB.deliverables(r.id);
    var over = L.etaOverrun(r);

    var html = '<dl class="kv">' +
      kv('상태', statusBadge(r.status) + ' ' + flagBadge(r)) +
      kv('모델명', esc(r.model)) +
      kv('요청자', esc(nameOf(r.requesterId)) + ' <span class="muted">' + esc(r.requesterEmail) + '</span>') +
      kv('수행자', esc(nameOf(r.assigneeId) || '미배정')) +
      kv('요청일', esc(r.requestedAt)) +
      kv('희망완료일', esc(r.dueDate)) +
      kv('예상완료일', esc(r.eta || '-') + (over ? ' <span class="badge bad">희망완료일 +' + over + '일</span>' : '')) +
      kv('제출일 / 완료일', esc(r.submittedAt || '-') + ' / ' + esc(r.closedAt || '-')) +
      (r.note ? kv('비고', esc(r.note)) : '') +
      (r.reviewNote ? kv('재작업 사유', esc(r.reviewNote)) : '') +
      '</dl>';

    /* --- 산출물 --- */
    html += '<h4>산출물 ' + fs.length + '개</h4>';
    html += '<div class="tablewrap"><table class="tbl"><thead><tr>' +
      ['파일명', '종류', '버전', '크기', '올린 사람', '등록일', ''].map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (fs.length ? fs.map(function (f) {
        var mine = u && (u.role === L.ROLE.ADMIN || f.uploaderId === u.id);
        return '<tr><td>' + esc(f.name) + '</td>' +
          '<td>' + (f.kind === '수정본' ? '<span class="badge badge-warn">수정본</span>' : '<span class="badge info">초안</span>') + '</td>' +
          '<td class="num">v' + f.version + '</td>' +
          '<td class="num">' + L.humanSize(f.size) + '</td>' +
          '<td>' + esc(nameOf(f.uploaderId)) + '</td>' +
          '<td class="nowrap">' + esc(f.uploadedAt) + '</td>' +
          '<td>' + (mine ? '<button type="button" class="btn small danger" data-delfile="' + esc(f.id) + '">삭제</button>' : '') + '</td></tr>';
      }).join('') : emptyRow(7, '아직 올라온 산출물이 없습니다')) +
      '</tbody></table></div>';

    /* --- 업로드 --- */
    var kind = L.uploadKind(u, r);
    if (kind) {
      html += '<h4>' + kind + ' 올리기 <span class="muted">품번 1건에 여러 파일을 한 번에</span></h4>' +
        '<div class="act-row">' +
        '<input type="file" id="dFiles" multiple>' +
        '<button type="button" class="btn primary" id="dUpload">' + kind + ' 등록</button>' +
        '</div>' +
        '<p class="note">파일 본문은 저장하지 않습니다 — 이름 · 크기 · 버전만 기록됩니다.' +
        (kind === '수정본'
          ? ' 수행자 초안은 그대로 두고 <b>수정본 v' + L.nextVersion(DB.files(), r.id, '수정본') + '</b> 으로 쌓입니다.'
          : '') + '</p>';
    }

    /* --- 배정 / 예상완료일 --- */
    if (u && (u.role === L.ROLE.REQUESTER || u.role === L.ROLE.ADMIN)) {
      html += '<h4>수행자 배정</h4><div class="act-row">' +
        '<label>수행자<select id="dAssignee"></select></label>' +
        '<button type="button" class="btn" id="dAssign">배정</button></div>';
    }
    if (u && (r.assigneeId === u.id || u.role === L.ROLE.REQUESTER || u.role === L.ROLE.ADMIN)) {
      html += '<h4>예상완료일</h4><div class="act-row">' +
        '<label>예상완료일<input type="date" id="dEta" value="' + esc(r.eta || '') + '"></label>' +
        '<button type="button" class="btn" id="dSetEta">저장</button>' +
        '<span class="muted">희망완료일 ' + esc(r.dueDate) + '</span></div>';
    }

    /* --- 상태 변경 --- */
    var ctx = {
      role: u ? u.role : null,
      isAssignee: !!(u && r.assigneeId === u.id),
      hasAssignee: !!r.assigneeId,
      deliverableCount: fs.length,
      reason: '__probe__'      // 사유가 필요한 전이도 후보로는 보이게 한다
    };
    var targets = L.allowedTargets(r.status, ctx);
    html += '<h4>상태 변경</h4>';
    if (targets.length) {
      html += '<div class="act-row">' +
        '<label>다음 상태<select id="dStatus">' +
        targets.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') +
        '</select></label>' +
        '<label>사유 <span class="muted">(되돌릴 때 필수)</span><input type="text" id="dReason" placeholder="재질 단가 누락 등"></label>' +
        '<button type="button" class="btn primary" id="dGo">변경</button>' +
        '<span class="act-msg" id="dMsg"></span></div>';
    } else {
      html += '<p class="note">지금 이 계정으로 바꿀 수 있는 상태가 없습니다. ' +
        (r.status === L.STATUS.WORK && !fs.length
          ? '<b>산출물을 1개 이상 올려야 검토로 넘어갑니다.</b>'
          : (L.canReview(u) ? '' : '검토 · 완료는 작업 요청자만 할 수 있습니다.')) + '</p>';
    }

    /* --- 메일 --- */
    if (fs.length && u && (r.assigneeId === u.id || u.role === L.ROLE.REQUESTER || u.role === L.ROLE.ADMIN)) {
      html += '<h4>산출물 제출 메일</h4><div class="act-row">' +
        '<button type="button" class="btn" id="dMailOpen">메일 열기</button>' +
        '<button type="button" class="btn" id="dMailCopy">본문 복사</button>' +
        '<span class="muted">수신 ' + esc(r.requesterEmail) + '</span></div>' +
        '<p class="note">사내 메일 서버 권한 없이 오늘 쓸 수 있도록, 시스템이 직접 보내지 않고 ' +
        '메일 클라이언트를 제목·본문이 채워진 채로 엽니다. 보내는 것은 사람이 확인한 뒤입니다.</p>';
    }

    $('#modalBody').innerHTML = html;

    var sel = $('#dAssignee');
    if (sel) { fillAssignee(sel); sel.value = r.assigneeId || ''; }

    function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }
  }

  /* ============================================================== 입력 */

  function fillSelect(sel, items, current, allLabel) {
    if (!sel) return;
    var opts = ['<option value="">' + esc(allLabel || '전체') + '</option>'];
    items.forEach(function (it) {
      var v = typeof it === 'string' ? it : it.value;
      var t = typeof it === 'string' ? it : it.label;
      opts.push('<option value="' + esc(v) + '">' + esc(t) + '</option>');
    });
    sel.innerHTML = opts.join('');
    sel.value = current || '';
  }

  function fillAssignee(sel) {
    if (!sel) return;
    var ws = DB.users().filter(function (u) {
      return u.role === L.ROLE.WORKER && u.status === L.ACCOUNT.APPROVED;
    });
    sel.innerHTML = '<option value="">미배정</option>' + ws.map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name + ' (' + u.org + ')') + '</option>';
    }).join('');
  }

  function uniq(a) {
    var seen = {}, out = [];
    a.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }

  /* ============================================================== 이벤트 */

  function wire() {
    $('#sideNav').addEventListener('click', function (e) {
      var b = e.target.closest('.nav-item');
      if (b) go(b.dataset.view);
    });

    document.addEventListener('click', function (e) {
      var t = e.target;

      var more = t.closest('[data-more]');
      if (more) { state.limit[more.dataset.more] += PAGE; render(); return; }

      var goBtn = t.closest('[data-goto]');
      if (goBtn) { go(goBtn.dataset.goto); return; }

      var openEl = t.closest('[data-open]');
      if (openEl) { openDetail(openEl.dataset.open); return; }

      if (t.closest('[data-close]')) { closeDetail(); return; }

      var ap = t.closest('[data-approve]');
      if (ap) { decide(ap.dataset.approve, L.ACCOUNT.APPROVED); return; }
      var rj = t.closest('[data-reject]');
      if (rj) { decide(rj.dataset.reject, L.ACCOUNT.REJECTED); return; }

      var fix = t.closest('[data-arch-fix]');
      if (fix) { fixArchive(fix.dataset.archFix); return; }
      var aok = t.closest('[data-arch-ok]');
      if (aok) {
        DB.updateArchive(aok.dataset.archOk, { confirmed: true });
        toast('확인 처리했습니다'); render(); return;
      }

      var del = t.closest('[data-delfile]');
      if (del) {
        var res = DB.removeFile(del.dataset.delfile);
        toast(res.ok ? '산출물을 삭제했습니다' : res.reason, !res.ok);
        renderDetail(); render(); return;
      }

      if (t.id === 'dUpload') return doUpload();
      if (t.id === 'dAssign') return doAssign();
      if (t.id === 'dSetEta') return doEta();
      if (t.id === 'dGo') return doStatus();
      if (t.id === 'dMailOpen') return doMail(true);
      if (t.id === 'dMailCopy') return doMail(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeDetail();
    });

    /* 계정 전환 · 초기화 */
    $('#userSwitch').addEventListener('change', function () {
      DB.setCurrentUser(this.value);
      closeDetail();
      render();
      toast(me().name + ' (' + me().role + ') 로 전환했습니다');
    });
    $('#btnReset').addEventListener('click', function () {
      if (!root.confirm('브라우저에 저장된 데모 데이터를 지우고 처음 상태로 되돌립니다. 계속할까요?')) return;
      DB.reset();
      fillUserSwitch();
      closeDetail();
      render();
      toast('데모 데이터를 초기화했습니다');
    });

    /* 신규 요청 */
    $('#reqForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(this);
      var input = {};
      ['partNo', 'partName', 'model', 'requestedAt', 'dueDate', 'requesterEmail', 'assigneeId', 'note']
        .forEach(function (k) { input[k] = String(f.get(k) || ''); });

      var res = DB.addRequest(input);
      var box = $('#reqErrors');
      if (!res.ok) {
        box.classList.remove('hidden');
        box.innerHTML = res.errors.map(function (x) { return '<li>' + esc(x.message) + '</li>'; }).join('');
        $('#reqFormMsg').textContent = '입력값을 확인하세요';
        $('#reqFormMsg').className = 'form-msg bad';
        return;
      }
      box.classList.add('hidden'); box.innerHTML = '';
      this.reset();
      presetForm();
      $('#reqFormMsg').textContent = res.request.id + ' 등록 완료';
      $('#reqFormMsg').className = 'form-msg';
      toast(res.request.id + ' 요청을 등록했습니다');
      render();
    });

    /* 가입 신청 */
    $('#userForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(this);
      var res = DB.addUser({
        name: f.get('name'), email: f.get('email'), org: f.get('org'), role: f.get('role')
      });
      $('#userFormMsg').textContent = res.ok
        ? (res.user.status === L.ACCOUNT.PENDING
            ? '신청 완료 — 관리자 승인 후 사용할 수 있습니다'
            : '등록 완료')
        : res.reason;
      $('#userFormMsg').className = 'form-msg' + (res.ok ? '' : ' bad');
      if (res.ok) this.reset();
      render();
    });

    /* 필터 */
    bind('#fReqKeyword', 'req', 'keyword', 'input');
    bind('#fReqStatus', 'req', 'status');
    bind('#fReqModel', 'req', 'model');
    bind('#fReqAssignee', 'req', 'assignee');
    bind('#fReqFrom', 'req', 'from');
    bind('#fReqTo', 'req', 'to');
    $('#fReqClear').addEventListener('click', function () {
      state.req = { keyword: '', status: '', model: '', assignee: '', from: '', to: '' };
      state.limit.req = PAGE;
      ['#fReqKeyword', '#fReqStatus', '#fReqModel', '#fReqAssignee', '#fReqFrom', '#fReqTo']
        .forEach(function (s) { $(s).value = ''; });
      render();
    });

    bind('#fWorkKeyword', 'work', 'keyword', 'input');
    bind('#fWorkStatus', 'work', 'status');
    bind('#fFileKeyword', 'file', 'keyword', 'input');
    bind('#fFileKind', 'file', 'kind');
    bind('#fArchKeyword', 'arch', 'keyword', 'input');
    bind('#fArchFrom', 'arch', 'from');
    bind('#fArchTo', 'arch', 'to');
    $('#fArchNeed').addEventListener('change', function () {
      state.arch.needOnly = this.checked; state.limit.arch = PAGE; render();
    });
    $('#fArchClear').addEventListener('click', function () {
      state.arch = { keyword: '', from: '', to: '', needOnly: false };
      state.limit.arch = PAGE;
      ['#fArchKeyword', '#fArchFrom', '#fArchTo'].forEach(function (s) { $(s).value = ''; });
      $('#fArchNeed').checked = false;
      render();
    });

    $('#trendRange').addEventListener('change', function () {
      state.trendMonths = +this.value;
      render();
    });

    /* Database 관리 — 파일명 해독 */
    $('#btnArchivePreview').addEventListener('click', function () {
      var picked = [].slice.call($('#archiveFile').files || []);
      if (!picked.length) { toast('파일을 먼저 고르세요', true); return; }
      state.archivePreview = L.parseArchiveBatch(picked.map(function (f) { return f.name; }));
      state.archivePreview.picked = picked;
      renderArchivePreview();
    });
    $('#btnArchiveCommit').addEventListener('click', function () {
      var p = state.archivePreview;
      if (!p) return;
      var res = DB.addArchive(p.picked, $('#archiveSource').value);
      if (!res.ok) { toast(res.reason, true); return; }
      state.archivePreview = null;
      $('#archiveFile').value = '';
      renderArchivePreview();
      render();
      toast(res.added + '건 등록 — 확인 필요 ' + res.needCheck + '건');
    });

    function bind(sel, group, key, ev) {
      var el = $(sel);
      if (!el) return;
      el.addEventListener(ev || 'change', function () {
        state[group][key] = this.value;
        // 조건이 바뀌면 다시 처음 50건부터. 그러지 않으면 좁힌 뒤에도
        // 앞서 늘려 둔 만큼이 그대로 남아 결과가 아니라 목록이 보인다.
        if (state.limit[group] !== undefined) state.limit[group] = PAGE;
        render();
      });
    }
  }

  /* ------------------------------------------------------- 상세 동작 */

  function doUpload() {
    var picked = $('#dFiles') ? [].slice.call($('#dFiles').files || []) : [];
    var res = DB.addFiles(state.detailId, picked);
    if (!res.ok) { toast(res.reason, true); return; }
    toast(res.kind + ' ' + res.added + '건을 등록했습니다');
    renderDetail(); render();
  }

  function doAssign() {
    var v = $('#dAssignee').value;
    if (!v) { toast('수행자를 고르세요', true); return; }
    var res = DB.assign(state.detailId, v);
    toast(res.ok ? '수행자를 배정했습니다' : res.reason, !res.ok);
    renderDetail(); render();
  }

  function doEta() {
    var res = DB.setEta(state.detailId, $('#dEta').value);
    toast(res.ok ? '예상완료일을 저장했습니다' : res.reason, !res.ok);
    renderDetail(); render();
  }

  function doStatus() {
    var to = $('#dStatus').value;
    var reason = $('#dReason').value;
    var res = DB.setStatus(state.detailId, to, null, reason);
    var msg = $('#dMsg');
    if (!res.ok) {
      msg.textContent = res.reason;
      msg.className = 'act-msg bad';
      return;
    }
    toast(to + ' 상태로 바꿨습니다');
    renderDetail(); render();
  }

  function doMail(open) {
    var r = DB.request(state.detailId);
    var mail = L.buildCompletionMail(r, DB.files(), 'PCT 작업관리 시스템');
    if (open) {
      DB.logMail(mail);
      root.location.href = L.mailtoUrl(mail);
      toast('메일 클라이언트를 엽니다 — 확인 후 보내세요');
      render();
    } else if (root.navigator.clipboard) {
      root.navigator.clipboard.writeText(mail.subject + '\n\n' + mail.body)
        .then(function () { toast('제목과 본문을 복사했습니다'); })
        .catch(function () { toast('복사에 실패했습니다', true); });
    }
  }

  function decide(userId, status) {
    var res = DB.setUserStatus(userId, status);
    toast(res.ok ? (status === L.ACCOUNT.APPROVED ? '승인했습니다' : '승인을 거두었습니다') : res.reason, !res.ok);
    fillUserSwitch();
    render();
  }

  function fixArchive(id) {
    var row = DB.archive().filter(function (a) { return a.id === id; })[0];
    if (!row) return;
    var d = root.prompt('문서일자를 YYYY-MM-DD 로 입력하세요.\n(비워 두면 일자 없음으로 둡니다)\n\n' + row.name,
                        row.docDate || '');
    if (d === null) return;
    var pn = root.prompt('품번을 입력하세요. (비워 두면 없음)', row.partNo || '');
    if (pn === null) return;
    var res = DB.updateArchive(id, { docDate: d.trim(), partNo: pn.trim(), confirmed: true });
    toast(res.ok ? '보정했습니다' : res.reason, !res.ok);
    render();
  }

  /* ============================================================== 시작 */

  function fillUserSwitch() {
    var sel = $('#userSwitch');
    var us = DB.users().filter(function (u) { return u.status === L.ACCOUNT.APPROVED; });
    sel.innerHTML = us.map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name + ' — ' + u.role) + '</option>';
    }).join('');
    var cur = me();
    sel.value = cur ? cur.id : us[0].id;
    if (!cur || sel.value !== cur.id) DB.setCurrentUser(sel.value);
  }

  function presetForm() {
    var f = $('#reqForm');
    var u = me();
    f.querySelector('[name=requestedAt]').value = today();
    var due = new Date();
    due.setDate(due.getDate() + 14);
    f.querySelector('[name=dueDate]').value =
      due.getFullYear() + '-' + L.pad2(due.getMonth() + 1) + '-' + L.pad2(due.getDate());
    if (u && u.email) f.querySelector('[name=requesterEmail]').value = u.email;
  }

  function boot() {
    // 서버 모드 — config.js 에 값이 채워져 있고 스키마가 올라가 있으면 갈아 끼운다.
    var cfg = root.APP_CONFIG || {};
    var ready = Promise.resolve(false);
    if (cfg.USE_SUPABASE && root.SupabaseStore) ready = root.SupabaseStore.init();

    ready.then(function (on) {
      if (on) {
        DB = root.SupabaseStore;
        $('#modeChip').textContent = 'Supabase 모드';
        $('#modeChip').style.borderColor = 'var(--accent)';
        // 서버 모드에서는 로그인한 사람이 곧 나다. 전환·초기화 단추를 남겨 두면
        // 눌러도 아무 일이 없어 "고장났나" 로 읽힌다.
        $('.who-switch').classList.add('hidden');
        $('#btnReset').classList.add('hidden');
        $('.demo-banner').innerHTML =
          '<b>Supabase 모드입니다.</b> 이 화면의 자료는 본인 Supabase 프로젝트에 저장되며, ' +
          '누가 무엇을 보고 바꿀 수 있는지는 <b>RLS 정책</b>이 정합니다. ' +
          '파일 본문은 데이터베이스에 넣지 않고 이름·크기·버전만 기록합니다.';
      }
    }).catch(function (e) {
      // 스키마를 아직 안 올렸을 때가 대부분이다. 화면이 죽는 것보다 데모로 내려가는 편이 낫다.
      console.warn('Supabase 연결 실패 — 데모 모드로 계속합니다:', e && e.message);
      toast('Supabase 연결에 실패해 데모 모드로 엽니다', true);
    }).then(function () {
      fillUserSwitch();
      presetForm();
      wire();
      go('dashboard');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
