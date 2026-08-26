/**
 * 서버 모드 어댑터 테스트 — node test/server.test.js
 *
 * js/supabase-store.js 가 js/store.js 와 **같은 모양**으로 동작하는지,
 * 그리고 서버가 거절했을 때 화면이 앞서 나간 채로 남지 않는지 본다.
 * 진짜 Postgres 검증은 scripts/sqltest/run.sh 가 따로 한다.
 */
'use strict';

var Logic = require('../js/logic.js');
var Store = require('../js/store.js');
var Adapter = require('../js/supabase-store.js');
var Fake = require('./fake-supabase.js');

var pass = 0, fail = 0;
function eq(a, b, label) {
  var x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.error('  ✗ ' + label + '\n      기대: ' + y + '\n      실제: ' + x); }
}
function ok(c, label) { eq(!!c, true, label); }
function group(n) { console.log('\n' + n); }
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

var REQ = '00000000-0000-0000-0000-000000000001';
var WORKER = '00000000-0000-0000-0000-000000000002';

var shouted = [];
global.PCT_TOAST = function (m) { shouted.push(m); };

var fake = Fake.makeFake({
  uid: REQ,
  app_user: [
    { id: REQ, name: '한지혜', email: 'req@example.com', org: '원가기획팀',
      role: '작업 요청자', status: '승인', joined_at: '2026-01-02' },
    { id: WORKER, name: '정민수', email: 'w1@example.com', org: '다원기술',
      role: '작업 수행자', status: '승인', joined_at: '2026-02-02' }
  ],
  request: [], deliverable: [], archive_doc: []
});

(async function () {

  /* ------------------------------------------------------------ 접속 */
  group('1. 접속과 초기 적재');

  var on = await Adapter.init(fake);
  ok(on, '가짜 클라이언트로 서버 모드에 올라간다');
  eq(Adapter.currentUser().name, '한지혜', '로그인한 사람이 곧 나다');
  eq(Adapter.setCurrentUser('아무개').id, REQ, '서버 모드에는 계정 전환이 없다');

  // Store 와 같은 함수를 내놓아야 app.js 가 갈아 끼울 수 있다
  var missing = Object.keys(Store).filter(function (k) {
    return typeof Store[k] === 'function' && typeof Adapter[k] !== 'function';
  }).filter(function (k) { return k !== '_seed'; });
  eq(missing, [], '어댑터가 Store 의 함수를 빠짐없이 내놓는다');

  /* ------------------------------------------------------------ 등록 */
  group('2. 요청 등록');

  var bad = Adapter.addRequest({
    partNo: '123456-100001', partName: '붐 실린더 브라켓', model: 'HX220L',
    requestedAt: Adapter.today(), dueDate: '2000-01-01', requesterEmail: 'req@example.com'
  });
  ok(!bad.ok, '규칙 위반은 서버에 가기 전에 걸린다');
  eq(fake._tables.request.length, 0, '거절된 요청은 서버로 나가지 않는다');

  var made = Adapter.addRequest({
    partNo: '123456 100001', partName: '붐 실린더 브라켓', model: 'HX220L',
    requestedAt: Adapter.today(), dueDate: Adapter.offToDate(10),
    requesterEmail: 'req@example.com'
  });
  ok(made.ok, '정상 요청은 통과한다');
  await flush();
  eq(fake._tables.request.length, 1, '서버에 한 줄 들어갔다');
  eq(fake._tables.request[0].part_no, '123456-100001', '품번이 정규화되어 나간다');
  eq(fake._tables.request[0].status, '요청', '처음 상태는 요청');

  var RID = made.request.id;

  /* ------------------------------------------------------------ 흐름 */
  group('3. 요청 → 수행 → 제출');

  ok(!Adapter.setStatus(RID, '완료').ok, '요청에서 완료로 건너뛸 수 없다');
  ok(Adapter.assign(RID, WORKER).ok, '수행자 배정');
  await flush();
  eq(fake._tables.request[0].assignee_id, WORKER, '배정이 서버에 반영된다');

  ok(Adapter.setStatus(RID, '작업중').ok, '요청자도 착수 처리할 수 있다');
  await flush();
  eq(fake._tables.request[0].status, '작업중', '서버 상태도 작업중');

  ok(!Adapter.setStatus(RID, '검토/수정').ok, '산출물 없이 검토로 못 넘어간다');

  var up = Adapter.addFiles(RID, [{ name: 'a.xlsx', size: 100 }, { name: 'b.xlsx', size: 200 }]);
  ok(up.ok, '초안 2건 업로드');
  await flush();
  eq(fake._tables.deliverable.map(function (d) { return d.version; }), [1, 2],
     '버전은 서버 트리거가 매긴다');
  eq(Adapter.deliverables(RID).map(function (f) { return f.version; }), [1, 2],
     '서버가 매긴 버전이 화면 쪽 사본에도 들어온다');

  ok(Adapter.setStatus(RID, '검토/수정').ok, '산출물이 있으면 검토로 넘어간다');
  await flush();
  eq(fake._tables.request[0].submitted_at, Adapter.today(), '제출일이 서버에 기록된다');

  var rev = Adapter.addFiles(RID, [{ name: '수정본.xlsx', size: 300 }]);
  eq(rev.kind, '수정본', '검토 단계에서 요청자가 올리면 수정본');
  await flush();
  eq(fake._tables.deliverable.filter(function (d) { return d.kind === '수정본'; })[0].version, 1,
     '수정본은 v1부터 — 초안 v2를 덮지 않는다');
  eq(fake._tables.deliverable.length, 3, '초안 2건이 그대로 남아 있다');

  ok(!Adapter.setStatus(RID, '작업중').ok, '사유 없이 되돌릴 수 없다');
  ok(Adapter.setStatus(RID, '완료').ok, '요청자가 완료 처리');
  await flush();
  eq(fake._tables.request[0].closed_at, Adapter.today(), '완료일이 서버에 기록된다');

  /* -------------------------------------------------- 서버가 거절할 때 */
  group('4. 서버가 거절하면 화면을 되돌린다');

  shouted.length = 0;
  fake._deny('request:update', 'new row violates row-level security policy');
  ok(Adapter.setStatus(RID, '검토/수정', null, '설계 변경').ok,
     '규칙상 가능한 요청이라 화면에서는 일단 통과한다');
  await flush(); await flush();

  ok(shouted.length > 0, '서버 거절을 조용히 넘기지 않고 알린다');
  ok(shouted[0].indexOf('row-level security') >= 0, '거절 사유를 그대로 전한다');
  eq(Adapter.request(RID).status, '완료',
     '서버에서 다시 읽어 화면이 서버보다 앞서 나간 상태를 되돌린다');
  fake._allow('request:update');

  /* ------------------------------------------------------------ 권한 */
  group('5. 권한');

  ok(!Adapter.setUserStatus(WORKER, '거절').ok, '요청자는 계정 승인을 바꿀 수 없다');
  ok(!Adapter.addUser({ name: 'x', email: 'x@y.z' }).ok,
     '서버 모드에서는 남의 계정을 대신 만들 수 없다');

  /* ------------------------------------------------------- 보관 자료 */
  group('6. Database 관리');

  var arch = Adapter.addArchive([
    { name: '부품원가계산서_123456-100001_20150103.xlsx', size: 100 },
    { name: '스캔본.pdf', size: 50 }
  ], 'Teams 공유폴더');
  eq(arch.added, 2, '2건 등록');
  eq(arch.needCheck, 1, '못 읽은 1건은 확인 대상');
  await flush();
  eq(fake._tables.archive_doc[0].doc_date, '2015-01-03', '해독한 일자가 서버로 나간다');
  eq(fake._tables.archive_doc[1].doc_date, null, '못 읽은 일자를 지어내지 않는다');
  eq(fake._tables.archive_doc[1].confirmed, false, '확신이 없으면 확인됨으로 두지 않는다');

  /* ------------------------------------------------------------ 이력 */
  group('7. 활동 이력');

  var actions = fake._tables.activity_log.map(function (r) { return r.action; });
  ok(actions.indexOf('요청 등록') >= 0, '요청 등록이 서버 이력에 남는다');
  ok(actions.indexOf('초안 업로드') >= 0, '업로드가 서버 이력에 남는다');

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
