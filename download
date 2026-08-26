/**
 * 단위 테스트 — node test/logic.test.js
 *
 * 공유 엑셀로 관리하던 시절 실제로 어긋났던 자리를 고정한다.
 *   · '요청' 이던 줄이 다음 주에 '완료' 로 바뀌어 있던 것 (건너뛰기)
 *   · 파일이 없는데 '제출 완료' 로 적혀 있던 것
 *   · 희망완료일이 요청일보다 빠른 줄 (엑셀 열 밀림)
 *   · 요청자 수정본이 수행자 초안을 덮어써 원본을 잃은 것
 *   · 파일명만 남은 옛 자료에서 날짜를 잘못 읽는 것
 */
'use strict';

var Logic = require('../js/logic.js');
var S = Logic.STATUS, R = Logic.ROLE, K = Logic.FILE_KIND;

var pass = 0, fail = 0;

function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; }
  else { fail++; console.error('  ✗ ' + label + '\n      기대: ' + b + '\n      실제: ' + a); }
}
function ok(cond, label) { eq(!!cond, true, label); }
function group(name) { console.log('\n' + name); }

/* ==================================================== 1. 상태 전이 ======= */
group('1. 상태 전이 — 건너뛰기와 되돌리기');

var worker = { role: R.WORKER, isAssignee: true, hasAssignee: true };

ok(Logic.canTransition(S.REQ, S.WORK, worker).ok, '요청 → 작업중 (수행자 배정됨)');
eq(Logic.canTransition(S.REQ, S.WORK, { role: R.WORKER, isAssignee: true, hasAssignee: false }).reason,
   '수행자를 먼저 배정하세요', '배정 없이 착수할 수 없다');

// 공유 엑셀에서 가장 자주 일어나던 일
ok(!Logic.canTransition(S.REQ, S.DONE, { role: R.REQUESTER }).ok, '요청 → 완료 건너뛰기 금지');
eq(Logic.canTransition(S.REQ, S.REVIEW, { role: R.REQUESTER }).reason,
   '요청에서 검토/수정로 건너뛸 수 없습니다. 작업중이(가) 먼저입니다',
   '건너뛰면 다음에 와야 할 상태를 알려 준다');
ok(!Logic.canTransition(S.WORK, S.DONE, { role: R.REQUESTER }).ok, '작업중 → 완료 건너뛰기 금지');

// 이 프로젝트의 이유 — 파일 없이 제출로 넘기지 못한다
eq(Logic.canTransition(S.WORK, S.REVIEW, { role: R.WORKER, isAssignee: true, deliverableCount: 0 }).reason,
   '산출물 파일을 1개 이상 올려야 검토로 넘어갑니다', '산출물 0건이면 검토로 못 넘긴다');
ok(Logic.canTransition(S.WORK, S.REVIEW, { role: R.WORKER, isAssignee: true, deliverableCount: 1 }).ok,
   '산출물 1건이면 넘어간다');

// 검토·완료는 요청자만
ok(!Logic.canTransition(S.REVIEW, S.DONE, { role: R.WORKER, isAssignee: true }).ok,
   '수행자는 완료 처리를 할 수 없다');
ok(Logic.canTransition(S.REVIEW, S.DONE, { role: R.REQUESTER }).ok, '요청자는 완료 처리할 수 있다');
ok(Logic.canTransition(S.REVIEW, S.DONE, { role: R.ADMIN }).ok, '관리자도 완료 처리할 수 있다');

// 되돌리기는 사유가 있어야 한다 — 사유 없는 재작업 요청이 분쟁의 씨앗이었다
eq(Logic.canTransition(S.REVIEW, S.WORK, { role: R.REQUESTER }).reason,
   '재작업 사유를 적어야 되돌릴 수 있습니다', '사유 없는 재작업 반려는 막힌다');
ok(Logic.canTransition(S.REVIEW, S.WORK, { role: R.REQUESTER, reason: '재질 단가 누락' }).ok,
   '사유가 있으면 재작업으로 되돌린다');
ok(Logic.canTransition(S.DONE, S.REVIEW, { role: R.REQUESTER, reason: '설계 변경' }).ok,
   '완료 건도 사유가 있으면 재개된다');
ok(!Logic.canTransition(S.DONE, S.WORK, { role: R.REQUESTER, reason: 'x' }).ok,
   '완료에서 작업중으로 두 칸 되돌릴 수는 없다');

ok(!Logic.canTransition(S.WORK, S.WORK, { role: R.ADMIN }).ok, '같은 상태로는 못 바꾼다');
ok(!Logic.canTransition('보류', S.WORK, { role: R.ADMIN }).ok, '없는 상태는 거부한다');

eq(Logic.allowedTargets(S.REVIEW, { role: R.REQUESTER, reason: '사유' }), [S.WORK, S.DONE],
   '화면에 뜨는 다음 상태 후보');
eq(Logic.allowedTargets(S.REVIEW, { role: R.WORKER, isAssignee: true }), [],
   '수행자에게는 검토 단계에서 고를 것이 없다');

/* ==================================================== 2. 요청 검증 ======= */
group('2. 요청 등록 검증');

var TODAY = '2026-08-26';
function base(over) {
  var v = { partNo: '123456-100001', partName: '붐 실린더 브라켓', model: 'HX220L',
            requestedAt: '2026-08-20', dueDate: '2026-09-03',
            requesterEmail: 'hanjihye@hd.example.com' };
  Object.keys(over || {}).forEach(function (k) { v[k] = over[k]; });
  return v;
}
eq(Logic.validateRequest(base(), TODAY), [], '정상 입력은 오류가 없다');

// 엑셀 열이 밀리면 실제로 들어오던 값
eq(Logic.validateRequest(base({ dueDate: '2026-08-01' }), TODAY)[0].message,
   '희망완료일이 요청일보다 빠릅니다', '희망완료일이 요청일보다 빠르면 막는다');
ok(Logic.validateRequest(base({ dueDate: '2026-08-20' }), TODAY).length === 0,
   '희망완료일 = 요청일 은 허용한다 (당일 처리 건)');
eq(Logic.validateRequest(base({ requestedAt: '2026-09-01' }), TODAY)[0].field, 'requestedAt',
   '요청일이 미래면 막는다');

eq(Logic.validateRequest(base({ partNo: '12345-10001' }), TODAY)[0].message,
   '품번은 123456-100001 형식입니다 (숫자 6자리-6자리)', '품번 형식 검사');
eq(Logic.validateRequest(base({ partNo: '' }), TODAY)[0].message, '품번을 입력하세요', '품번 필수');
eq(Logic.validateRequest(base({ partName: '  ' }), TODAY)[0].field, 'partName', '품명 필수');
eq(Logic.validateRequest(base({ model: '' }), TODAY)[0].field, 'model', '모델명 필수');
eq(Logic.validateRequest(base({ requesterEmail: 'hanjihye' }), TODAY)[0].field, 'requesterEmail',
   '메일 형식 검사');
eq(Logic.validateRequest(base({ dueDate: '2026-02-30' }), TODAY)[0].field, 'dueDate',
   '달력에 없는 날짜는 거부한다');

// 엑셀에서 복사하면 전각 문자가 딸려 온다 — 같은 품번이 두 건으로 갈라지던 자리
eq(Logic.normalizePartNo('１２３４５６－１００００１'), '123456-100001', '전각 숫자·하이픈을 정규화');
eq(Logic.normalizePartNo(' 123456 100001 '), '123456-100001', '공백 구분자도 받는다');
eq(Logic.normalizePartNo('123456100001'), '123456-100001', '구분자 없이 12자리도 받는다');
eq(Logic.validateRequest(base({ partNo: '123456 100001' }), TODAY), [], '정규화 후 통과한다');

eq(Logic.nextRequestId([]), 'REQ-001', '첫 요청번호');
eq(Logic.nextRequestId([{ id: 'REQ-007' }, { id: 'REQ-012' }, { id: '잘못된값' }]), 'REQ-013',
   '가장 큰 번호 다음. 형식이 다른 값은 무시한다');

eq(Logic.validateEta('2026-08-19', { requestedAt: '2026-08-20' }).reason,
   '예상완료일이 요청일보다 빠릅니다', '예상완료일이 요청일보다 빠르면 막는다');
ok(Logic.validateEta('2026-09-10', { requestedAt: '2026-08-20' }).ok, '정상 예상완료일');

/* ==================================================== 3. 산출물 버전 ===== */
group('3. 산출물 버전 — 초안과 수정본은 서로 덮어쓰지 않는다');

var FILES = [
  { requestId: 'REQ-001', kind: K.DRAFT,    version: 1 },
  { requestId: 'REQ-001', kind: K.DRAFT,    version: 2 },
  { requestId: 'REQ-001', kind: K.REVISION, version: 1 },
  { requestId: 'REQ-002', kind: K.DRAFT,    version: 1 }
];
eq(Logic.nextVersion(FILES, 'REQ-001', K.DRAFT), 3, '초안 다음 버전');
eq(Logic.nextVersion(FILES, 'REQ-001', K.REVISION), 2, '수정본은 따로 센다 — 초안 v2를 덮지 않는다');
eq(Logic.nextVersion(FILES, 'REQ-003', K.DRAFT), 1, '첫 파일은 v1');
eq(Logic.filesOf(FILES, 'REQ-001').length, 3, '건별 파일 목록');

eq(Logic.humanSize(0), '0 B', '0바이트');
eq(Logic.humanSize(2048), '2.0 KB', 'KB 표기');
eq(Logic.humanSize(3 * 1024 * 1024), '3.0 MB', 'MB 표기');

/* ==================================================== 4. 일정 판정 ======= */
group('4. 일정 — 완료된 건은 지연으로 세지 않는다');

function req(over) {
  var r = { status: S.WORK, requestedAt: '2026-08-01', dueDate: '2026-08-30', eta: null };
  Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
  return r;
}
eq(Logic.effectiveDue(req()), '2026-08-30', '예상완료일이 없으면 희망완료일이 기준');
eq(Logic.effectiveDue(req({ eta: '2026-09-04' })), '2026-09-04', '예상완료일이 있으면 그것이 기준');

eq(Logic.scheduleFlag(req({ dueDate: '2026-08-20' }), TODAY), '지연', '기한이 지나면 지연');
eq(Logic.scheduleFlag(req({ dueDate: TODAY }), TODAY), '오늘', '오늘이 기한');
eq(Logic.scheduleFlag(req({ dueDate: '2026-08-28' }), TODAY), '임박', '2일 이내는 임박');
eq(Logic.scheduleFlag(req({ dueDate: '2026-09-30' }), TODAY), '정상', '여유 있음');

// 이미 끝난 일을 빨갛게 칠하면 목록이 온통 빨개져 진짜 지연이 묻힌다
eq(Logic.scheduleFlag(req({ status: S.DONE, dueDate: '2026-01-01' }), TODAY), '완료',
   '완료 건은 기한이 지났어도 지연이 아니다');
eq(Logic.scheduleFlag(req({ dueDate: null }), TODAY), '미정', '기준일이 없으면 미정');

eq(Logic.etaOverrun(req({ dueDate: '2026-08-30', eta: '2026-09-04' })), 5,
   '예상완료일이 희망완료일을 5일 넘겼다');
eq(Logic.etaOverrun(req({ dueDate: '2026-08-30', eta: '2026-08-25' })), 0, '앞당겨졌으면 0');

/* ==================================================== 5. 집계 ============ */
group('5. 대시보드 집계');

var RS = [
  req({ status: S.REQ,    dueDate: '2026-09-10' }),
  req({ status: S.WORK,   dueDate: TODAY }),
  req({ status: S.WORK,   dueDate: '2026-08-01' }),
  req({ status: S.REVIEW, dueDate: '2026-09-01' }),
  req({ status: S.DONE,   dueDate: '2026-07-01', closedAt: '2026-07-15' }),
  req({ status: S.DONE,   dueDate: '2026-08-01', closedAt: '2026-08-03' }),
  req({ status: S.DONE,   dueDate: '2026-08-01', closedAt: '2026-08-20' })
];
eq(Logic.summarize(RS, [{}, {}], TODAY),
   { total: 7, done: 3, running: 3, dueToday: 1, overdue: 1, fileCount: 2 },
   'KPI 4장 + 지연 건수');

// 반올림한 퍼센트 합이 100이 아니면 보고 화면에서 바로 눈에 띈다
var BD = Logic.statusBreakdown(RS);
eq(BD.map(function (b) { return b.count; }), [1, 2, 1, 3], '상태별 건수');
eq(BD.reduce(function (a, b) { return a + b.pct; }, 0), 100, '퍼센트 합이 정확히 100');
eq(Logic.statusBreakdown([]).map(function (b) { return b.pct; }), [0, 0, 0, 0], '빈 목록은 0%');

var THREE = [{ status: S.REQ }, { status: S.WORK }, { status: S.REVIEW }];
eq(Logic.statusBreakdown(THREE).reduce(function (a, b) { return a + b.pct; }, 0), 100,
   '3등분(33.33%)도 합이 100');

eq(Logic.monthlyTrend(RS, TODAY, 3),
   [{ key: '2026-06', label: '6월', count: 0 },
    { key: '2026-07', label: '7월', count: 1 },
    { key: '2026-08', label: '8월', count: 2 }],
   '월별 완료 추이는 완료 처리한 날 기준');
eq(Logic.recentMonths('2026-01-15', 3), ['2025-11', '2025-12', '2026-01'], '해를 넘겨도 이어진다');

eq(Logic.todaySchedule(RS, TODAY).due.length, 2, '오늘 완료 예정 + 지연 건');
eq(Logic.todaySchedule(RS, TODAY).running.length, 0, '나머지 진행 중 건');

/* ==================================================== 6. 권한 ============ */
group('6. 권한 — 외부 수행자는 자기 건만 본다');

var U = {
  req1:  { id: 'U-R1', role: R.REQUESTER, status: '승인' },
  admin: { id: 'U-A1', role: R.ADMIN, status: '승인' },
  w1:    { id: 'U-W1', role: R.WORKER, status: '승인' },
  w2:    { id: 'U-W2', role: R.WORKER, status: '승인' },
  pend:  { id: 'U-W5', role: R.WORKER, status: '승인대기' }
};
var ASSIGNED = [
  { id: 'A', assigneeId: 'U-W1' }, { id: 'B', assigneeId: 'U-W2' }, { id: 'C', assigneeId: null }
];
eq(Logic.visibleRequests(ASSIGNED, U.w1).map(function (r) { return r.id; }), ['A'],
   '수행자는 배정된 건만 본다');
eq(Logic.visibleRequests(ASSIGNED, U.req1).length, 3, '요청자는 팀 전체를 본다');
eq(Logic.visibleRequests(ASSIGNED, U.pend), [], '승인 전 계정은 아무것도 못 본다');
eq(Logic.visibleRequests(ASSIGNED, null), [], '비로그인은 아무것도 못 본다');
// 승인 기준을 역할별로 다르게 두면 서버(schema.sql 의 my_role)와 어긋난다
eq(Logic.visibleRequests(ASSIGNED, { id: 'U-R9', role: R.REQUESTER, status: '승인대기' }), [],
   '승인 전이면 요청자여도 못 본다 — 서버의 my_role() 과 같은 기준');
ok(!Logic.canReview({ id: 'U-R9', role: R.REQUESTER, status: '승인대기' }),
   '승인 전 요청자는 검토 화면에 못 들어간다');
ok(!Logic.canManageUsers({ id: 'U-A9', role: R.ADMIN, status: '승인대기' }),
   '승인 전 관리자도 권한 관리를 못 한다');

ok(Logic.canReview(U.req1) && Logic.canReview(U.admin), '검토/수정은 요청자·관리자');
ok(!Logic.canReview(U.w1), '수행자는 검토/수정 화면에 못 들어간다');
ok(Logic.canManageUsers(U.admin) && !Logic.canManageUsers(U.req1), '권한 관리는 관리자만');

ok(Logic.canEditRequest(U.req1, { requesterId: 'U-R1' }), '본인 요청은 수정할 수 있다');
ok(!Logic.canEditRequest(U.req1, { requesterId: 'U-R2' }), '남의 요청은 못 고친다');
ok(Logic.canEditRequest(U.admin, { requesterId: 'U-R2' }), '관리자는 고칠 수 있다');

eq(Logic.uploadKind(U.w1, { status: S.WORK, assigneeId: 'U-W1' }), K.DRAFT,
   '작업중 — 배정된 수행자가 올리면 초안');
eq(Logic.uploadKind(U.w2, { status: S.WORK, assigneeId: 'U-W1' }), null,
   '남의 건에는 못 올린다');
eq(Logic.uploadKind(U.req1, { status: S.REVIEW, assigneeId: 'U-W1' }), K.REVISION,
   '검토/수정 — 요청자가 올리면 수정본');
eq(Logic.uploadKind(U.w1, { status: S.REVIEW, assigneeId: 'U-W1' }), null,
   '검토 단계에서 수행자는 못 올린다');
eq(Logic.uploadKind(U.req1, { status: S.REQ }), null, '요청 상태에는 아무도 못 올린다');
eq(Logic.uploadKind(U.pend, { status: S.WORK, assigneeId: 'U-W5' }), null,
   '승인 전 계정은 못 올린다');

/* ==================================================== 7. 메일 ============ */
group('7. 완료 메일');

var MAIL = Logic.buildCompletionMail(
  { id: 'REQ-001', partNo: '123456-100001', partName: '붐 실린더 브라켓', model: 'HX220L',
    dueDate: '2026-09-03', submittedAt: '2026-08-30',
    requesterEmail: 'hanjihye@hd.example.com', requesterName: '한지혜' },
  [{ requestId: 'REQ-001', name: 'a.xlsx', kind: K.DRAFT, version: 1, uploadedAt: '2026-08-30' },
   { requestId: 'REQ-001', name: 'b.xlsx', kind: K.DRAFT, version: 2, uploadedAt: '2026-08-31' },
   { requestId: 'REQ-002', name: 'c.xlsx', kind: K.DRAFT, version: 1, uploadedAt: '2026-08-31' }],
  'PCT 작업관리 시스템');

eq(MAIL.to, 'hanjihye@hd.example.com', '수신자는 요청자');
eq(MAIL.subject, '[부품원가계산서] 123456-100001 붐 실린더 브라켓 산출물 제출 (HX220L)', '제목');
ok(MAIL.body.indexOf('첨부 산출물 2건') >= 0, '다른 건의 파일은 섞이지 않는다');
ok(MAIL.body.indexOf('a.xlsx (초안 v1)') >= 0, '파일 목록에 종류·버전이 들어간다');
ok(Logic.mailtoUrl(MAIL).indexOf('mailto:hanjihye%40hd.example.com?') === 0, 'mailto 주소');

/* ============================== 8. 파일명 해독 (Database 관리) ========== */
group('8. 파일명 해독 — 옛 자료를 이름만 보고 정리한다');

function P(n) { return Logic.parseArchiveName(n); }

// 기획서에 적힌 바로 그 예시
eq(P('부품원가계산서_20150103.xlsx').docDate, '2015-01-03', '부품원가계산서_20150103 → 2015-01-03');
eq(P('부품원가계산서_20150103.xlsx').confidence, 'medium', '날짜만 읽히면 medium');

eq(P('PCT_123456-100001_240115.xlsx').partNo, '123456-100001', '품번을 먼저 떼어 낸다');
eq(P('PCT_123456-100001_240115.xlsx').docDate, '2024-01-15', '품번 숫자를 날짜로 오독하지 않는다');
eq(P('PCT_123456-100001_240115.xlsx').confidence, 'high', '품번+날짜면 high');
eq(P('123456100001_20240115.xlsx').partNo, '123456-100001', '구분자 없는 품번도 읽는다');

eq(P('부품원가계산서(HX220L)_240115.xls').model, 'HX220L', '괄호 안의 모델명');
eq(P('123456-100001_붐실린더브라켓_2024-01-15_v2.xlsx').title, '붐실린더브라켓',
   '남는 낱말이 제목이 된다');
eq(P('123456-100001_붐실린더브라켓_2024-01-15_v2.xlsx').version, 2, 'v2 → 버전 2');
eq(P('원가계산서_123456-100001_20240115(수정2).xlsm').version, 2, '(수정2) → 버전 2');
eq(P('원가계산서_123456-100001_20240115(수정).xlsm').version, 2, '(수정)만 있으면 2판으로 본다');
eq(P('PCT_123456-100001_20240115_rev3.xlsx').version, 3, 'rev3 → 버전 3');

// 없는 정보를 지어내지 않는 것이 이 해독기의 핵심이다
eq(P('부품원가계산서_20250230.xlsx').docDate, null, '2025-02-30 은 달력에 없다 — 버린다');
ok(P('부품원가계산서_20250230.xlsx').hints.join(' ').indexOf('달력에 없는') >= 0,
   '왜 못 읽었는지 사유가 남는다');
eq(P('원가계산서_2015010.xlsx').docDate, null, '자릿수가 어긋난 숫자는 날짜로 읽지 않는다');
eq(P('원가계산서_HX220L_201501.xlsx').docMonth, '2015-01', '월까지만 있으면 월만 채운다');
eq(P('원가계산서_HX220L_201501.xlsx').docDate, null, '일자를 1일로 채워 넣지 않는다');
eq(P('스캔본_카운터웨이트.pdf').confidence, 'low', '아무것도 못 읽으면 low');
eq(P('').confidence, 'low', '빈 파일명도 죽지 않는다');
eq(P('C:\\보관\\2019\\부품원가계산서_20190722.xlsx').docDate, '2019-07-22',
   '경로가 붙어 있어도 파일명만 본다');
eq(P('123456100001 카운터웨이트 2019.07.22 최종.xls').version, 99,
   '"최종"은 마지막 판(99)으로 두고 확인을 남긴다');

var BATCH = Logic.parseArchiveBatch([
  '부품원가계산서_123456-100001_20150103.xlsx',   // high
  '부품원가계산서_20150103.xlsx',                 // medium
  '스캔본.pdf'                                    // low
]);
eq([BATCH.high, BATCH.medium, BATCH.low], [1, 1, 1], '일괄 해독은 확신도별로 나뉜다');

/* 검색 */
var ARCH = [
  { name: 'a', partNo: '123456-100001', model: 'HX220L', title: '붐브라켓', docDate: '2015-01-03' },
  { name: 'b', partNo: '123456-100002', model: 'HL955',  title: '버킷링크', docDate: '2019-07-22' },
  { name: 'c', partNo: null,            model: null,     title: '스캔본',   docDate: null }
];
eq(Logic.archiveSearch(ARCH, { keyword: '붐' }).length, 1, '키워드 검색');
eq(Logic.archiveSearch(ARCH, { keyword: 'hx220l' }).length, 1, '대소문자 구분 없이 찾는다');
eq(Logic.archiveSearch(ARCH, { from: '2015-01-01', to: '2016-12-31' }).map(function (r) { return r.name; }),
   ['a'], '일자 구간 검색 — 기획서의 "일자별로 찾기"');
eq(Logic.archiveSearch(ARCH, { from: '2000-01-01' }).length, 2,
   '일자를 못 읽은 자료는 구간 검색에서 빠진다 — 조용히 섞이면 안 된다');
eq(Logic.archiveSearch(ARCH, { model: 'hl955' }).length, 1, '모델 필터');
eq(Logic.archiveSearch(ARCH, {}).length, 3, '조건이 없으면 전부');

/* ==================================================== 결과 ============== */
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 통과 / ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
