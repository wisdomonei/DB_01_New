/**
 * 순수 로직 — 화면도 저장소도 모른다. node 에서 그대로 테스트한다.
 *
 * 이 파일에 담은 것은 "사람이 틀리기 쉬운 자리"다.
 *   · 상태를 건너뛰는 것        (요청 → 완료)
 *   · 산출물 없이 검토로 넘기는 것
 *   · 희망완료일보다 빠른 요청일
 *   · 수정본이 초안을 덮어쓰는 것
 *   · 파일명만 남은 옛 자료에서 날짜·품번을 읽어 내는 것
 *
 * 화면(app.js)과 저장소(store.js)는 여기 판정을 그대로 따르고,
 * 같은 규칙을 supabase/schema.sql 이 서버에서 한 번 더 막는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================================================================== 상수 */

  /** 작업 상태 4단계. 화면 태그·차트·DB check 제약이 모두 이 문자열을 쓴다. */
  var STATUS = {
    REQ:    '요청',
    WORK:   '작업중',
    REVIEW: '검토/수정',
    DONE:   '완료'
  };
  var STATUS_ORDER = [STATUS.REQ, STATUS.WORK, STATUS.REVIEW, STATUS.DONE];

  /** 업무 프로세스 5단계 — 상태 4개 + 그 사이의 '산출물 제출'. */
  var PROCESS = [
    { key: 'req',    label: '요청',        desc: '요청자가 품번·모델·희망완료일을 등록합니다' },
    { key: 'work',   label: '수행',        desc: '외부 수행자가 예상완료일과 진행 상태를 갱신합니다' },
    { key: 'submit', label: '산출물 제출', desc: '품번 1건에 여러 파일을 올리고 완료 메일이 나갑니다' },
    { key: 'review', label: '검토/수정',   desc: '요청자만 들어와 수정본을 버전으로 쌓습니다' },
    { key: 'done',   label: '완료',        desc: '요청자가 확정해야 닫힙니다' }
  ];

  var ROLE = {
    REQUESTER: '작업 요청자',
    WORKER:    '작업 수행자',
    ADMIN:     '관리자'
  };

  /** 외부 인원 가입 승인 상태. */
  var ACCOUNT = { PENDING: '승인대기', APPROVED: '승인', REJECTED: '거절' };

  var FILE_KIND = { DRAFT: '초안', REVISION: '수정본' };

  /* ============================================================ 날짜 도우미 */

  /** 'YYYY-MM-DD' 만 다룬다. Date 객체를 돌리면 시간대 때문에 하루가 밀린다. */
  function isDateStr(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && validYmd(
      +s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
  }

  function validYmd(y, m, d) {
    if (!(y >= 1900 && y <= 2199)) return false;
    if (!(m >= 1 && m <= 12)) return false;
    if (!(d >= 1)) return false;
    var last = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return d <= last;
  }
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  /** 두 날짜의 일수 차 (b - a). 둘 다 'YYYY-MM-DD'. */
  function daysBetween(a, b) {
    if (!isDateStr(a) || !isDateStr(b)) return null;
    var MS = 86400000;
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
                     - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / MS);
  }

  /** 'YYYY-MM-DD' → 'YYYY-MM'. */
  function monthKey(s) { return isDateStr(s) ? s.slice(0, 7) : null; }

  /** today 기준 최근 n개월 키를 오래된 순으로. */
  function recentMonths(today, n) {
    if (!isDateStr(today)) return [];
    var y = +today.slice(0, 4), m = +today.slice(5, 7), out = [];
    for (var i = n - 1; i >= 0; i--) {
      var mm = m - i, yy = y;
      while (mm <= 0) { mm += 12; yy -= 1; }
      out.push(yy + '-' + pad2(mm));
    }
    return out;
  }

  /* ========================================================== 상태 전이 규칙 */

  /**
   * 상태를 바꿀 수 있는지 판정한다.
   *
   * 건너뛰기를 막는 것이 핵심이다. 공유 엑셀에서는 '요청'으로 적어 둔 줄이
   * 다음 주에 '완료'로 바뀌어 있고, 그 사이에 무슨 일이 있었는지가 남지 않았다.
   * 여기서는 한 칸씩만 움직이고, 되돌릴 때는 사유를 받는다.
   *
   * @param {string} from 현재 상태
   * @param {string} to   바꾸려는 상태
   * @param {object} ctx  { role, isAssignee, isOwner, deliverableCount, reason }
   * @returns {{ok: boolean, reason: string}}
   */
  function canTransition(from, to, ctx) {
    ctx = ctx || {};
    var role = ctx.role;
    var files = ctx.deliverableCount || 0;
    var reason = String(ctx.reason || '').trim();

    if (STATUS_ORDER.indexOf(from) < 0) return no('알 수 없는 현재 상태입니다: ' + from);
    if (STATUS_ORDER.indexOf(to) < 0)   return no('알 수 없는 상태입니다: ' + to);
    if (from === to)                    return no('이미 ' + from + ' 상태입니다');

    var owner = (role === ROLE.ADMIN || role === ROLE.REQUESTER);

    // ── 앞으로 ─────────────────────────────────────────────────────────
    if (from === STATUS.REQ && to === STATUS.WORK) {
      if (!ctx.isAssignee && !owner) return no('배정된 수행자만 착수할 수 있습니다');
      if (!ctx.hasAssignee)          return no('수행자를 먼저 배정하세요');
      return yes();
    }
    if (from === STATUS.WORK && to === STATUS.REVIEW) {
      // 이 한 줄이 이 프로젝트의 이유다. 산출물 없이 "제출했다"고 적힌 줄이
      // 공유 엑셀에는 실제로 있었고, 나중에 파일을 찾을 수 없었다.
      if (files < 1) return no('산출물 파일을 1개 이상 올려야 검토로 넘어갑니다');
      if (!ctx.isAssignee && !owner) return no('배정된 수행자만 제출할 수 있습니다');
      return yes();
    }
    if (from === STATUS.REVIEW && to === STATUS.DONE) {
      if (!owner) return no('검토·완료는 작업 요청자만 할 수 있습니다');
      return yes();
    }

    // ── 되돌리기 (사유 필수) ────────────────────────────────────────────
    if (from === STATUS.REVIEW && to === STATUS.WORK) {
      if (!owner)    return no('재작업 요청은 작업 요청자만 할 수 있습니다');
      if (!reason)   return no('재작업 사유를 적어야 되돌릴 수 있습니다');
      return yes();
    }
    if (from === STATUS.DONE && to === STATUS.REVIEW) {
      if (!owner)  return no('완료 건의 재개는 작업 요청자만 할 수 있습니다');
      if (!reason) return no('재개 사유를 적어야 합니다');
      return yes();
    }

    // ── 나머지는 전부 건너뛰기 ──────────────────────────────────────────
    var gap = STATUS_ORDER.indexOf(to) - STATUS_ORDER.indexOf(from);
    if (gap > 1) {
      return no(from + '에서 ' + to + '로 건너뛸 수 없습니다. ' +
                STATUS_ORDER[STATUS_ORDER.indexOf(from) + 1] + '이(가) 먼저입니다');
    }
    return no(from + '에서 ' + to + '로는 되돌릴 수 없습니다');

    function yes() { return { ok: true, reason: '' }; }
    function no(m) { return { ok: false, reason: m }; }
  }

  /** 화면에서 고를 수 있는 다음 상태 목록. */
  function allowedTargets(from, ctx) {
    return STATUS_ORDER.filter(function (to) {
      return canTransition(from, to, ctx).ok;
    });
  }

  /* ============================================================== 요청 검증 */

  var PART_NO_RE = /^\d{6}-\d{6}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * 품번 표기를 하나로 맞춘다.
   * 엑셀에서 복사하면 전각 하이픈·공백·줄바꿈이 섞여 들어와,
   * 같은 품번이 서로 다른 두 건으로 등록되는 일이 잦았다.
   */
  function normalizePartNo(v) {
    var s = String(v == null ? '' : v)
      .replace(/[‐-―－]/g, '-')     // 전각·유니코드 하이픈
      .replace(/[０-９]/g, function (c) { // 전각 숫자
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/\s+/g, '')
      .toUpperCase();
    var digits = s.replace(/\D/g, '');
    if (digits.length === 12) return digits.slice(0, 6) + '-' + digits.slice(6);
    return s;
  }

  /**
   * 신규/수정 요청을 검증한다. 반환은 오류 배열 — 비어 있으면 통과.
   * 화면은 이 배열을 그대로 필드 밑에 뿌린다.
   */
  function validateRequest(input, today) {
    var e = [];
    var v = input || {};
    var partNo = normalizePartNo(v.partNo);

    if (!partNo) e.push({ field: 'partNo', message: '품번을 입력하세요' });
    else if (!PART_NO_RE.test(partNo))
      e.push({ field: 'partNo', message: '품번은 123456-100001 형식입니다 (숫자 6자리-6자리)' });

    if (!String(v.partName || '').trim()) e.push({ field: 'partName', message: '품명을 입력하세요' });
    if (!String(v.model || '').trim())    e.push({ field: 'model', message: '모델명을 입력하세요' });

    if (!isDateStr(v.requestedAt)) e.push({ field: 'requestedAt', message: '요청일을 올바르게 입력하세요' });
    if (!isDateStr(v.dueDate))     e.push({ field: 'dueDate', message: '희망완료일을 올바르게 입력하세요' });

    // 엑셀에서 열이 밀리면 실제로 들어오던 값이다. 통과시키면 이후 지연 집계가 전부 음수가 된다.
    if (isDateStr(v.requestedAt) && isDateStr(v.dueDate) && daysBetween(v.requestedAt, v.dueDate) < 0)
      e.push({ field: 'dueDate', message: '희망완료일이 요청일보다 빠릅니다' });

    if (isDateStr(v.requestedAt) && isDateStr(today) && daysBetween(today, v.requestedAt) > 0)
      e.push({ field: 'requestedAt', message: '요청일이 오늘보다 미래입니다' });

    if (!EMAIL_RE.test(String(v.requesterEmail || '').trim()))
      e.push({ field: 'requesterEmail', message: '요청자 메일 주소를 올바르게 입력하세요' });

    return e;
  }

  /** 예상완료일 검증 — 수행자가 직접 입력한다. */
  function validateEta(eta, request) {
    if (!isDateStr(eta)) return { ok: false, reason: '예상완료일을 올바르게 입력하세요' };
    if (request && isDateStr(request.requestedAt) && daysBetween(request.requestedAt, eta) < 0)
      return { ok: false, reason: '예상완료일이 요청일보다 빠릅니다' };
    return { ok: true, reason: '' };
  }

  /** REQ-001 … 다음 번호. 비어 있으면 REQ-001. */
  function nextRequestId(requests) {
    var max = 0;
    (requests || []).forEach(function (r) {
      var m = /^REQ-(\d+)$/.exec(String(r && r.id || ''));
      if (m) max = Math.max(max, +m[1]);
    });
    var n = max + 1;
    return 'REQ-' + (n < 1000 ? ('00' + n).slice(-3) : String(n));
  }

  /* ============================================================== 산출물 */

  /**
   * 다음 버전 번호. 종류(초안/수정본)마다 따로 센다.
   *
   * 요청자의 수정본이 수행자 초안을 덮어쓰면 "원본이 뭐였는지" 를 잃는다.
   * 초안 v1 과 수정본 v1 은 다른 파일이고, 둘 다 남는다.
   */
  function nextVersion(files, requestId, kind) {
    var max = 0;
    (files || []).forEach(function (f) {
      if (f.requestId === requestId && f.kind === kind) max = Math.max(max, f.version || 0);
    });
    return max + 1;
  }

  function filesOf(files, requestId) {
    return (files || []).filter(function (f) { return f.requestId === requestId; });
  }

  /** 사람이 읽는 파일 크기. 표에서 자릿수를 맞추려고 소수 한 자리로 고정한다. */
  function humanSize(bytes) {
    var b = Number(bytes) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ============================================================== 일정 판정 */

  /**
   * 이 건이 언제 끝날 예정인가.
   * 수행자가 예상완료일을 적었으면 그것이, 아직이면 희망완료일이 기준이다.
   */
  function effectiveDue(req) {
    if (!req) return null;
    if (isDateStr(req.eta)) return req.eta;
    if (isDateStr(req.dueDate)) return req.dueDate;
    return null;
  }

  /**
   * 일정 신호. '완료' | '지연' | '오늘' | '임박' | '정상' | '미정'
   * 완료된 건은 기한이 지났어도 지연으로 세지 않는다 — 이미 끝난 일이다.
   */
  function scheduleFlag(req, today) {
    if (!req) return '미정';
    if (req.status === STATUS.DONE) return '완료';
    var due = effectiveDue(req);
    if (!due || !isDateStr(today)) return '미정';
    var d = daysBetween(today, due);
    if (d < 0) return '지연';
    if (d === 0) return '오늘';
    if (d <= 2) return '임박';
    return '정상';
  }

  /** 예상완료일이 희망완료일을 넘겼는가 — 요청자에게 미리 알려야 하는 신호. */
  function etaOverrun(req) {
    if (!req || !isDateStr(req.eta) || !isDateStr(req.dueDate)) return 0;
    var d = daysBetween(req.dueDate, req.eta);
    return d > 0 ? d : 0;
  }

  /* ============================================================== 집계 */

  /**
   * 대시보드 KPI 4장.
   *   완료      — 상태가 완료인 요청 건수
   *   진행중    — 작업중 + 검토/수정 (요청자 입장에서 '굴러가고 있는' 건)
   *   오늘완료예정 — 완료가 아니면서 기준일이 오늘인 건
   *   산출물     — 파일 총 개수
   */
  function summarize(requests, files, today) {
    var rs = requests || [];
    var done = 0, running = 0, dueToday = 0, overdue = 0;
    rs.forEach(function (r) {
      if (r.status === STATUS.DONE) { done++; return; }
      if (r.status === STATUS.WORK || r.status === STATUS.REVIEW) running++;
      var f = scheduleFlag(r, today);
      if (f === '오늘') dueToday++;
      if (f === '지연') overdue++;
    });
    return {
      total: rs.length,
      done: done,
      running: running,
      dueToday: dueToday,
      overdue: overdue,
      fileCount: (files || []).length
    };
  }

  /**
   * 상태별 분포. 퍼센트는 반올림해도 합이 100이 되도록 최대잉여법으로 맞춘다.
   * (그냥 반올림하면 도넛 옆 숫자가 99% 나 101% 로 적히는데, 보고 화면에서 이건 눈에 띈다.)
   */
  function statusBreakdown(requests) {
    var rs = requests || [];
    var rows = STATUS_ORDER.map(function (s) {
      return { status: s, count: rs.filter(function (r) { return r.status === s; }).length, pct: 0 };
    });
    var total = rs.length;
    if (!total) return rows;

    var floors = rows.map(function (r) { return Math.floor(r.count * 100 / total); });
    var used = floors.reduce(function (a, b) { return a + b; }, 0);
    var rest = rows.map(function (r, i) {
      return { i: i, frac: (r.count * 100 / total) - floors[i] };
    }).sort(function (a, b) { return b.frac - a.frac || a.i - b.i; });

    for (var k = 0; k < 100 - used; k++) floors[rest[k % rest.length].i] += 1;
    rows.forEach(function (r, i) { r.pct = floors[i]; });
    return rows;
  }

  /** 월별 완료 추이 — 완료 처리한 날(closedAt) 기준. */
  function monthlyTrend(requests, today, n) {
    var keys = recentMonths(today, n || 6);
    var counts = {};
    keys.forEach(function (k) { counts[k] = 0; });
    (requests || []).forEach(function (r) {
      if (r.status !== STATUS.DONE) return;
      var k = monthKey(r.closedAt);
      if (k && counts.hasOwnProperty(k)) counts[k] += 1;
    });
    return keys.map(function (k) {
      return { key: k, label: (+k.slice(5, 7)) + '월', count: counts[k] };
    });
  }

  /** 오늘 기준 일정 목록 — 완료 예정 / 진행 중으로 나눈다. */
  function todaySchedule(requests, today) {
    var due = [], running = [];
    (requests || []).forEach(function (r) {
      if (r.status === STATUS.DONE) return;
      var f = scheduleFlag(r, today);
      if (f === '오늘' || f === '지연') due.push(r);
      else if (r.status === STATUS.WORK) running.push(r);
    });
    return { due: due, running: running };
  }

  /* ============================================================== 권한 */

  /**
   * 승인된 계정인가.
   * 역할과 무관하게 '승인' 이어야 한다 — supabase/schema.sql 의 my_role() 이
   * 승인되지 않은 계정에 null 을 돌려주는 것과 같은 규칙이다.
   * 두 곳의 기준이 어긋나면 데모에서 되던 일이 서버에서 조용히 막힌다.
   */
  function isApproved(user) {
    return !!user && user.status === ACCOUNT.APPROVED;
  }

  /**
   * 이 사용자가 볼 수 있는 요청.
   *
   * 외부 수행자는 자기에게 배정된 건만 본다. 화면에서 감추는 것이 아니라
   * 목록 자체가 좁혀지고, 서버 모드에서는 같은 규칙을 RLS 가 한 번 더 막는다.
   */
  function visibleRequests(requests, user) {
    var rs = requests || [];
    if (!isApproved(user)) return [];
    if (user.role === ROLE.ADMIN || user.role === ROLE.REQUESTER) return rs.slice();
    return rs.filter(function (r) { return r.assigneeId === user.id; });
  }

  /** 검토/수정 화면은 요청자·관리자 전용. 기획서의 "작업 요청자만 접근" 이다. */
  function canReview(user) {
    return isApproved(user) && (user.role === ROLE.REQUESTER || user.role === ROLE.ADMIN);
  }

  function canManageUsers(user) { return isApproved(user) && user.role === ROLE.ADMIN; }

  function canEditRequest(user, req) {
    if (!isApproved(user) || !req) return false;
    if (user.role === ROLE.ADMIN) return true;
    return user.role === ROLE.REQUESTER && req.requesterId === user.id;
  }

  /**
   * 지금 이 사람이 이 건에 올릴 수 있는 파일 종류.
   * 올릴 수 없으면 null — 화면은 업로드 칸 자체를 내린다.
   */
  function uploadKind(user, req) {
    if (!user || !req || !isApproved(user)) return null;
    var owner = (user.role === ROLE.REQUESTER || user.role === ROLE.ADMIN);
    if (req.status === STATUS.WORK && (req.assigneeId === user.id || owner)) return FILE_KIND.DRAFT;
    if (req.status === STATUS.REVIEW && owner) return FILE_KIND.REVISION;
    return null;
  }

  /* ============================================================== 메일 */

  /**
   * 산출물 제출 완료 메일. 실제 발송은 하지 않고 메일 클라이언트를 연다
   * (사내 메일 서버 권한 없이도 오늘 쓸 수 있게 — README '메일' 참조).
   */
  function buildCompletionMail(req, files, sender) {
    var list = filesOf(files, req.id).sort(function (a, b) {
      return String(a.uploadedAt).localeCompare(String(b.uploadedAt));
    });
    var subject = '[부품원가계산서] ' + req.partNo + ' ' + req.partName +
                  ' 산출물 제출 (' + req.model + ')';
    var lines = [
      req.requesterName ? (req.requesterName + '님,') : '안녕하세요,',
      '',
      '요청하신 부품원가계산서 산출물을 제출합니다.',
      '',
      '· 요청번호 : ' + req.id,
      '· 품번/품명 : ' + req.partNo + ' / ' + req.partName,
      '· 모델명   : ' + req.model,
      '· 희망완료일 : ' + (req.dueDate || '-'),
      '· 제출일   : ' + (req.submittedAt || '-'),
      '',
      '첨부 산출물 ' + list.length + '건',
      list.length
        ? list.map(function (f, i) {
            return '  ' + (i + 1) + ') ' + f.name + ' (' + f.kind + ' v' + f.version + ')';
          }).join('\n')
        : '  (없음)',
      '',
      '검토 후 수정 사항이 있으면 시스템의 [검토/수정 관리] 에서 수정본을 올려 주세요.',
      '',
      sender || 'PCT 작업관리 시스템'
    ];
    return {
      to: req.requesterEmail || '',
      cc: '',
      subject: subject,
      body: lines.join('\n'),
      requestId: req.id
    };
  }

  function mailtoUrl(mail) {
    var q = [];
    if (mail.cc) q.push('cc=' + encodeURIComponent(mail.cc));
    q.push('subject=' + encodeURIComponent(mail.subject));
    q.push('body=' + encodeURIComponent(mail.body));
    return 'mailto:' + encodeURIComponent(mail.to || '') + '?' + q.join('&');
  }

  /* ================================================== 파일명 해독 (Database) */

  var EXT_RE = /\.(xlsx|xlsm|xlsb|xls|csv|pdf|zip|7z)$/i;

  /**
   * 옛 부품원가계산서 파일명에서 품번·날짜·모델·버전을 읽어 낸다.
   *
   * 기획서의 "AI가 파일명만 보고 찾아서 알아서 넣을 수 있는지" 에 대한 답이다.
   * 실제로 필요한 건 추론이 아니라 **일관된 규칙과, 규칙이 안 맞을 때 조용히
   * 지어내지 않는 것**이었다. 확신이 없으면 confidence 를 낮춰 돌려주고
   * 화면은 그 건만 사람에게 확인을 받는다.
   *
   * 읽는 순서가 중요하다. 품번(11자리)을 먼저 떼어 내지 않으면
   * `123456-100001` 의 숫자가 날짜로 잘못 잡힌다.
   */
  function parseArchiveName(filename) {
    var raw = String(filename == null ? '' : filename);
    var base = raw.replace(/^.*[\\/]/, '').replace(EXT_RE, '');
    var out = {
      name: raw, partNo: null, model: null, docDate: null, docMonth: null,
      version: null, title: '', confidence: 'low', hints: []
    };
    if (!base) { out.hints.push('파일명이 비어 있습니다'); return out; }

    var rest = base;

    // ① 품번 — 12자리(6+6). 하이픈·언더바·공백 어느 구분자든 받는다.
    var mPart = /(?:^|[^0-9])(\d{6})[-_. ]?(\d{6})(?![0-9])/.exec(rest);
    if (mPart) {
      out.partNo = mPart[1] + '-' + mPart[2];
      rest = rest.replace(mPart[0], ' ');
    }

    // ② 버전 — v2 / _rev3 / (수정2) / (최종)
    var mVer = /[_\-. (\[]?(?:v|ver|rev|Rev|VER)[ .]?(\d{1,2})(?![0-9])/.exec(rest);
    if (mVer) { out.version = +mVer[1]; rest = rest.replace(mVer[0], ' '); }
    else {
      var mKo = /[_\-. (\[](수정|재작업|보완)[ ]?(\d{0,2})/.exec(rest);
      if (mKo) { out.version = mKo[2] ? +mKo[2] : 2; rest = rest.replace(mKo[0], ' '); }
      else if (/최종|final|Final|FINAL/.test(rest)) {
        out.version = 99;
        out.hints.push('“최종”이 붙어 있어 마지막 판으로 봅니다 — 버전 번호는 확인이 필요합니다');
        rest = rest.replace(/최종|final|Final|FINAL/g, ' ');
      }
    }

    // ③ 날짜 — 넓은 형식부터. 억지로 만들지 않는 것이 핵심이다.
    var d = readDate(rest);
    if (d) {
      out.docDate = d.date; out.docMonth = d.month;
      if (d.note) out.hints.push(d.note);
      rest = rest.replace(d.matched, ' ');
    }

    // ④ 모델 — 괄호 안이 1순위, 아니면 영문+숫자 토큰
    var mModel = /[(\[]([A-Za-z][A-Za-z0-9\-]{2,12})[)\]]/.exec(rest);
    if (mModel) { out.model = mModel[1].toUpperCase(); rest = rest.replace(mModel[0], ' '); }
    else {
      var mTok = /(?:^|[^A-Za-z0-9])([A-Z]{1,3}\d{2,4}[A-Z]{0,3}(?:-\d{1,2})?)(?![A-Za-z0-9])/.exec(rest);
      if (mTok) { out.model = mTok[1].toUpperCase(); rest = rest.replace(mTok[0], ' '); }
    }

    // ⑤ 남은 한글/영문 낱말이 제목
    out.title = rest.replace(/[_\-.()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

    // ⑥ 확신도 — 자동 등록할지, 사람이 볼지를 가른다
    if (out.partNo && out.docDate) out.confidence = 'high';
    else if (out.partNo || out.docDate) out.confidence = 'medium';
    else out.confidence = 'low';

    if (!out.docDate && !out.docMonth) {
      out.hints.push(/(?:^|[^0-9])\d{8}(?![0-9])/.test(base)
        ? '8자리 숫자가 있으나 달력에 없는 날짜입니다 — 사람이 확인해야 합니다'
        : '파일명에서 날짜를 찾지 못했습니다');
    }
    if (!out.partNo) out.hints.push('파일명에서 품번을 찾지 못했습니다');

    return out;
  }

  /**
   * 문자열에서 날짜를 읽는다. 실제로 없는 날짜(20250230)는 버린다.
   * 6자리는 앞 두 자리를 연도로 보되, 2000년대만 받는다.
   */
  function readDate(s) {
    var re, m;

    // YYYY-MM-DD / YYYY.MM.DD / YYYYMMDD
    re = /(?:^|[^0-9])((?:19|20)\d{2})[-._ ]?(\d{2})[-._ ]?(\d{2})(?![0-9])/g;
    while ((m = re.exec(s))) {
      if (validYmd(+m[1], +m[2], +m[3]))
        return { date: ymd(+m[1], +m[2], +m[3]), month: m[1] + '-' + m[2], matched: m[0] };
    }

    // YYMMDD (240115)
    re = /(?:^|[^0-9])(\d{2})(\d{2})(\d{2})(?![0-9])/g;
    while ((m = re.exec(s))) {
      var y = 2000 + (+m[1]);
      if (+m[1] <= 79 && validYmd(y, +m[2], +m[3]))
        return { date: ymd(y, +m[2], +m[3]), month: y + '-' + m[2], matched: m[0],
                 note: '두 자리 연도를 20' + m[1] + '년으로 읽었습니다' };
    }

    // YYYY-MM / YYYYMM — 일자는 비워 둔다. 1일로 채우면 없던 정보가 생긴다.
    re = /(?:^|[^0-9])((?:19|20)\d{2})[-._ ]?(0[1-9]|1[0-2])(?![0-9])/g;
    while ((m = re.exec(s))) {
      return { date: null, month: m[1] + '-' + m[2], matched: m[0],
               note: '월까지만 읽혔습니다 — 일자는 비워 둡니다' };
    }
    return null;
  }

  /** 여러 파일명을 한 번에 해독하고 확신도별로 나눈다. */
  function parseArchiveBatch(names) {
    var rows = (names || []).map(parseArchiveName);
    return {
      rows: rows,
      high:   rows.filter(function (r) { return r.confidence === 'high'; }).length,
      medium: rows.filter(function (r) { return r.confidence === 'medium'; }).length,
      low:    rows.filter(function (r) { return r.confidence === 'low'; }).length
    };
  }

  /** 보관 자료 검색 — 키워드 + 일자 구간. 일자 없는 자료는 구간 검색에서 빠진다. */
  function archiveSearch(rows, q) {
    q = q || {};
    var kw = String(q.keyword || '').trim().toLowerCase();
    return (rows || []).filter(function (r) {
      if (kw) {
        var hay = [r.name, r.partNo, r.model, r.title].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      if (q.from || q.to) {
        if (!isDateStr(r.docDate)) return false;
        if (q.from && r.docDate < q.from) return false;
        if (q.to && r.docDate > q.to) return false;
      }
      if (q.model && String(r.model || '').toUpperCase() !== String(q.model).toUpperCase()) return false;
      return true;
    });
  }

  /* ============================================================== 내보내기 */

  return {
    STATUS: STATUS, STATUS_ORDER: STATUS_ORDER, PROCESS: PROCESS,
    ROLE: ROLE, ACCOUNT: ACCOUNT, FILE_KIND: FILE_KIND,

    isDateStr: isDateStr, daysBetween: daysBetween, monthKey: monthKey,
    recentMonths: recentMonths, pad2: pad2,

    canTransition: canTransition, allowedTargets: allowedTargets,
    validateRequest: validateRequest, validateEta: validateEta,
    normalizePartNo: normalizePartNo, nextRequestId: nextRequestId,

    nextVersion: nextVersion, filesOf: filesOf, humanSize: humanSize,

    effectiveDue: effectiveDue, scheduleFlag: scheduleFlag, etaOverrun: etaOverrun,
    summarize: summarize, statusBreakdown: statusBreakdown,
    monthlyTrend: monthlyTrend, todaySchedule: todaySchedule,

    isApproved: isApproved, visibleRequests: visibleRequests, canReview: canReview,
    canManageUsers: canManageUsers, canEditRequest: canEditRequest, uploadKind: uploadKind,

    buildCompletionMail: buildCompletionMail, mailtoUrl: mailtoUrl,

    parseArchiveName: parseArchiveName, parseArchiveBatch: parseArchiveBatch,
    archiveSearch: archiveSearch
  };
});
