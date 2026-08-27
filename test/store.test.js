/**
 * 저장소 통합 테스트 — node test/store.test.js
 *
 * logic.test.js 가 규칙 하나하나를 본다면, 여기서는 **요청 → 수행 → 제출 →
 * 검토 → 완료** 한 바퀴를 실제로 돌려 부수 효과(제출일·완료일·버전·이력)가
 * 맞는지 본다. node 에는 localStorage 가 없어 메모리에만 남는다.
 */
'use strict';

var Logic = require('../js/logic.js');
var Store = require('../js/store.js');
var S = Logic.STATUS;

var pass = 0, fail = 0;
function eq(a, b, label) {
  var x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.error('  ✗ ' + label + '\n      기대: ' + y + '\n      실제: ' + x); }
}
function ok(c, label) { eq(!!c, true, label); }
function group(n) { console.log('\n' + n); }

var REQUESTER = 'U-R1', WORKER = 'U-W1', ADMIN = 'U-A1';
function as(id) { return Store.setCurrentUser(id); }

Store.reset();

/* ------------------------------------------------------------------ 시드 */
group('1. 샘플 데이터');

var db = Store.load();
eq(db.requests.length, 164, '요청 164건');
eq(db.users.length, 12, '사용자 12명');
ok(db.files.length > 200, '산출물이 200개 이상');
ok(db.archive.length === 46, '보관 자료 46건');

// 시드의 날짜는 오늘 기준으로 만들어진다 — 몇 달 뒤에 열어도 데모가 살아 있어야 한다
ok(db.requests.every(function (r) { return Logic.isDateStr(r.requestedAt); }), '요청일이 전부 실제 날짜');
ok(db.requests.some(function (r) { return r.requestedAt >= Store.today(); }) ||
   db.requests.every(function (r) { return r.requestedAt <= Store.today(); }),
   '요청일이 오늘을 넘지 않는다');
ok(db.requests.filter(function (r) { return r.status === S.DONE; })
     .every(function (r) { return Logic.isDateStr(r.closedAt); }),
   '완료 건에는 완료일이 있다');
ok(db.requests.filter(function (r) { return r.status !== S.DONE; })
     .every(function (r) { return !r.closedAt; }),
   '완료가 아닌 건에는 완료일이 없다');

// 보관 자료는 시드에 정답을 적어 두지 않고 파일명을 그 자리에서 해독한다
ok(db.archive.some(function (a) { return a.confidence === 'high'; }), '자동 확정된 보관 자료가 있다');
ok(db.archive.some(function (a) { return a.confidence === 'low'; }), '수동 확인이 필요한 자료도 있다');
ok(db.archive.filter(function (a) { return a.confirmed; })
     .every(function (a) { return a.partNo || a.docDate || a.docMonth; }),
   '확인됨으로 표시된 자료에는 품번이나 일자가 있다 — 서버 제약과 같은 규칙');

/* -------------------------------------------------------------- 요청 등록 */
group('2. 요청 등록');

as(REQUESTER);
var bad = Store.addRequest({
  partNo: '123456-100999', partName: '테스트 부품', model: 'HX220L',
  requestedAt: Store.today(), dueDate: '2000-01-01',
  requesterEmail: 'hanjihye@hd.example.com'
});
ok(!bad.ok, '희망완료일이 요청일보다 빠르면 등록되지 않는다');
eq(Store.requests().length, 164, '실패한 등록은 저장되지 않는다');

var made = Store.addRequest({
  partNo: '123456 100999', partName: '테스트 부품', model: 'HX220L',
  requestedAt: Store.today(), dueDate: Store.offToDate(10),
  requesterEmail: 'hanjihye@hd.example.com', note: '통합 테스트'
});
ok(made.ok, '정상 요청은 등록된다');
eq(made.request.id, 'REQ-165', '요청번호가 이어진다');
eq(made.request.partNo, '123456-100999', '품번이 정규화되어 저장된다');
eq(made.request.status, S.REQ, '처음 상태는 요청');

var RID = made.request.id;

/* ---------------------------------------------------------------- 배정 */
group('3. 배정과 착수');

var r1 = Store.setStatus(RID, S.WORK);
ok(!r1.ok, '수행자 없이 착수할 수 없다');
eq(r1.reason, '수행자를 먼저 배정하세요', '사유가 그대로 전달된다');

ok(!Store.assign(RID, 'U-W5').ok, '승인 대기 중인 외부 계정에는 배정할 수 없다');
ok(Store.assign(RID, WORKER).ok, '승인된 수행자에게 배정');

as(WORKER);
ok(!Store.assign(RID, 'U-W2').ok, '수행자는 배정을 바꿀 수 없다');
ok(Store.setStatus(RID, S.WORK).ok, '배정된 수행자가 착수한다');
eq(Store.request(RID).status, S.WORK, '상태가 작업중');

ok(!Store.setEta(RID, '1999-01-01').ok, '요청일보다 빠른 예상완료일은 저장되지 않는다');
ok(Store.setEta(RID, Store.offToDate(12)).ok, '예상완료일 저장');
eq(Logic.etaOverrun(Store.request(RID)), 2, '희망완료일보다 2일 늦은 것으로 잡힌다');

/* -------------------------------------------------------------- 산출물 */
group('4. 산출물 제출');

var noFile = Store.setStatus(RID, S.REVIEW);
ok(!noFile.ok, '산출물 없이 검토로 넘어갈 수 없다');
eq(noFile.reason, '산출물 파일을 1개 이상 올려야 검토로 넘어갑니다', '사유가 화면에 그대로 뜬다');

var up = Store.addFiles(RID, [{ name: 'PCT_v1.xlsx', size: 512000 },
                              { name: 'PCT_근거.xlsx', size: 220000 }]);
ok(up.ok && up.added === 2, '품번 1건에 여러 파일을 한 번에 올린다');
eq(up.kind, '초안', '수행자가 올리면 초안');
eq(Store.deliverables(RID).map(function (f) { return f.version; }), [1, 2], '버전이 1, 2로 매겨진다');

// 화면이 이 id 로 본문 사본을 보관한다 (js/filestore.js)
ok(Array.isArray(up.files) && up.files.length === 2 && up.files[0].id,
   'addFiles 가 만들어진 행을 돌려준다 — 사본 보관용 id');

ok(Store.setStatus(RID, S.REVIEW).ok, '산출물이 있으면 검토로 넘어간다');
eq(Store.request(RID).submittedAt, Store.today(), '제출일이 자동으로 찍힌다');

var mail = Logic.buildCompletionMail(Store.request(RID), Store.files(), 'PCT 작업관리 시스템');
ok(mail.body.indexOf('첨부 산출물 2건') >= 0, '완료 메일에 이 건의 파일만 들어간다');
Store.logMail(mail);
eq(Store.mails()[0].requestId, RID, '메일 이력이 남는다');

/* -------------------------------------------------------------- 검토 */
group('5. 검토와 수정본');

ok(!Store.addFiles(RID, [{ name: '몰래.xlsx', size: 1 }]).ok,
   '검토 단계에서 수행자는 파일을 올릴 수 없다');
ok(!Store.setStatus(RID, S.DONE).ok, '수행자는 완료 처리를 할 수 없다');

as(REQUESTER);
var rev = Store.addFiles(RID, [{ name: 'PCT_수정본.xlsx', size: 530000 }]);
eq(rev.kind, '수정본', '요청자가 올리면 수정본');
eq(Store.deliverables(RID).length, 3, '초안 2건이 그대로 남아 있다');
eq(Store.deliverables(RID).filter(function (f) { return f.kind === '수정본'; })[0].version, 1,
   '수정본은 v1부터 — 초안 v2를 덮지 않는다');

ok(!Store.setStatus(RID, S.WORK).ok, '사유 없이 재작업으로 되돌릴 수 없다');
ok(Store.setStatus(RID, S.WORK, null, '재질 단가 누락').ok, '사유가 있으면 되돌아간다');
eq(Store.request(RID).reviewNote, '재질 단가 누락', '재작업 사유가 남는다');

as(WORKER);
Store.addFiles(RID, [{ name: 'PCT_v3.xlsx', size: 540000 }]);
eq(Logic.nextVersion(Store.files(), RID, '초안'), 4, '재작업 초안이 v3에 이어 붙는다');
Store.setStatus(RID, S.REVIEW);

as(REQUESTER);
ok(Store.setStatus(RID, S.DONE).ok, '요청자가 완료 처리');
eq(Store.request(RID).closedAt, Store.today(), '완료일이 찍힌다');

ok(!Store.setStatus(RID, S.WORK, null, '아무 사유').ok, '완료에서 작업중으로 두 칸 되돌릴 수 없다');
ok(Store.setStatus(RID, S.REVIEW, null, '설계 변경').ok, '사유가 있으면 완료 건을 재개한다');
eq(Store.request(RID).closedAt, null, '재개하면 완료일이 지워진다 — 완료 건수가 부풀지 않는다');
Store.setStatus(RID, S.DONE);

/* -------------------------------------------------------------- 권한 */
group('6. 권한');

as(WORKER);
eq(Logic.visibleRequests(Store.requests(), Store.currentUser())
     .every(function (r) { return r.assigneeId === WORKER; }), true,
   '수행자 목록에는 자기 건만 있다');
ok(!Logic.canReview(Store.currentUser()), '수행자는 검토 화면에 못 들어간다');
ok(!Store.setUserStatus('U-W5', '승인').ok, '수행자는 계정을 승인할 수 없다');

as(REQUESTER);
ok(!Store.setUserStatus('U-W5', '승인').ok, '요청자도 계정 승인은 못 한다');

as(ADMIN);
ok(Store.setUserStatus('U-W5', '승인').ok, '관리자가 승인');
eq(Store.user('U-W5').status, '승인', '상태가 바뀐다');

// 승인을 거두면 그 사람에게 배정된 진행 중 건도 함께 비워진다
var before = Store.requests().filter(function (r) {
  return r.assigneeId === WORKER && r.status !== S.DONE;
}).length;
ok(before > 0, '승인 취소 전에 진행 중 배정이 있다');
Store.setUserStatus(WORKER, '거절');
eq(Store.requests().filter(function (r) {
  return r.assigneeId === WORKER && r.status !== S.DONE;
}).length, 0, '승인을 거두면 진행 중 배정이 비워진다');
ok(Store.requests().some(function (r) { return r.assigneeId === WORKER && r.status === S.DONE; }),
   '이미 끝난 건의 기록은 지우지 않는다');

/* ------------------------------------------------------------ 보관 자료 */
group('7. Database 관리');

as(REQUESTER);
var add = Store.addArchive([
  { name: '부품원가계산서_123456-100001_20150103.xlsx', size: 300000 },
  { name: '부품원가계산서_20150103.xlsx', size: 280000 },
  { name: '스캔본.pdf', size: 120000 }
], 'Teams 공유폴더');
eq(add.added, 3, '3건 등록');
eq(add.needCheck, 2, '확신도가 낮은 2건은 확인 대상으로 남는다');
eq(add.rows[0].confirmed, true, '품번+일자가 읽힌 건만 자동 확정');
eq(add.rows[2].docDate, null, '못 읽은 일자를 지어내지 않는다');

var found = Logic.archiveSearch(Store.archive(), { from: '2015-01-01', to: '2015-12-31' });
ok(found.length >= 2, '일자 구간으로 옛 자료를 찾는다');
ok(found.every(function (a) { return a.docDate >= '2015-01-01' && a.docDate <= '2015-12-31'; }),
   '구간 밖 자료가 섞이지 않는다');

ok(!Store.updateArchive(add.rows[2].id, { docDate: '2015-13-01' }).ok, '없는 달은 저장되지 않는다');
ok(Store.updateArchive(add.rows[2].id, { docDate: '2015-03-02', confirmed: true }).ok, '사람이 보정한다');
eq(Store.archive().filter(function (a) { return a.id === add.rows[2].id; })[0].docMonth, '2015-03',
   '보정하면 월도 함께 맞춰진다');

/* ---------------------------------------------------------------- 이력 */
group('8. 원본 위치(link) — 화면에서 href 로 쓰이는 값');

// 이 검사는 흐름과 섞이지 않게 새 요청으로 따로 본다.
// 앞 단계 한복판에 파일을 하나 더 끼워 넣으면 버전·첨부 개수 기대치가 전부 밀린다
// (실제로 그렇게 넣었다가 완료 메일 첨부 수와 초안 버전이 어긋났다).
as(REQUESTER);
var LK = Store.addRequest({
  partNo: '123456-100998', partName: '링크 시험 부품', model: 'HX220L',
  requestedAt: Store.today(), dueDate: Store.offToDate(7),
  requesterEmail: 'hanjihye@hd.example.com'
}).request.id;
Store.assign(LK, 'U-W2');
as('U-W2');
Store.setStatus(LK, S.WORK);

var bad = Store.addFiles(LK, [{ name: 'x.xlsx', size: 10, link: 'javascript:alert(1)' }]);
ok(!bad.ok, 'javascript: 주소는 원본 위치로 저장되지 않는다');
eq(Store.deliverables(LK).length, 0, '거절된 업로드는 표에 아무것도 남기지 않는다');

var good = Store.addFiles(LK, [{ name: 'y.xlsx', size: 10, link: 'https://teams.example.com/y.xlsx' }]);
ok(good.ok, 'http(s) 주소는 받는다');
eq(Store.deliverables(LK)[0].link, 'https://teams.example.com/y.xlsx', '원본 위치가 그대로 저장된다');
eq(Logic.downloadAction(Store.deliverables(LK)[0], false).kind, 'link',
   '사본이 없어도 원본 위치가 있으면 그리로 보낸다');

Store.addFiles(LK, [{ name: 'z.xlsx', size: 10 }]);
eq(Logic.downloadAction(Store.deliverables(LK)[1], false).kind, 'none',
   '사본도 원본 위치도 없으면 받을 길이 없다고 표시한다');

/* ------------------------------------------------------------ 이력 */
group('9. 활동 이력');

var actions = Store.logs().map(function (g) { return g.action; });
ok(actions.indexOf('상태 변경') >= 0, '상태 변경이 이력에 남는다');
ok(actions.indexOf('초안 업로드') >= 0, '업로드가 이력에 남는다');
ok(actions.indexOf('계정 승인') >= 0, '계정 승인이 이력에 남는다');
ok(Store.logs().length <= 300, '이력은 300건까지만 들고 있는다');

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 통과 / ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
