/**
 * 화면 연기 테스트 — node test/smoke.browser.js  (playwright 필요)
 *
 * 규칙 테스트가 전부 통과해도 app.js 의 오타 하나로 페이지가 빈 화면이 될 수 있다.
 * 여기서는 실제로 브라우저에 띄워 **일곱 화면이 그려지는지**와
 * **권한 경계가 화면에서도 지켜지는지**만 본다. 계산은 다른 테스트가 본다.
 *
 * 브라우저가 없으면(로컬에 playwright 미설치) 조용히 건너뛴다 —
 * 이 하나 때문에 `node test/*.test.js` 가 막히면 아무도 안 돌린다.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PORT = 8791;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + label); }
}
function eq(a, b, label) {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error('  ✗ ' + label + '\n      기대: ' + JSON.stringify(b) + '\n      실제: ' + JSON.stringify(a)); }
}

var chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다 ' +
              '(CI 에서는 설치 후 돌립니다).');
  process.exit(0);
}

var server = http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  var file = path.join(ROOT, rel);
  // 저장소 밖으로 나가는 경로는 거절한다
  if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

var VIEWS = ['dashboard', 'requests', 'work', 'files', 'review', 'db', 'users'];

server.listen(PORT, '127.0.0.1', function () {
  run().then(function () {
    server.close();
    console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 통과 / ' + fail + ' 실패');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    server.close();
    console.error(e);
    process.exit(1);
  });
});

async function run() {
  // CI 는 `npx playwright install chromium` 으로 받은 것을 그대로 쓴다.
  // 브라우저를 따로 깔아 둔 환경(사내망·컨테이너)에서는 경로를 넘길 수 있게 둔다.
  var launch = {};
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  var browser = await chromium.launch(launch);
  var page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  var errors = [];
  page.on('pageerror', function (e) { errors.push(String(e.message)); });
  page.on('console', function (m) {
    // 폰트 CDN 이 막힌 망에서도 화면은 떠야 한다 — 네트워크 실패는 세지 않는다
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  console.log('\n1. 대시보드');
  eq(errors, [], '자바스크립트 오류 없이 뜬다');
  ok((await page.locator('#kpiRow .kpi').count()) === 4, 'KPI 카드 4장');
  ok((await page.locator('#donut svg circle').count()) > 1, '도넛이 그려진다');
  ok((await page.locator('#trend svg path').count()) >= 2, '꺾은선이 그려진다');
  eq(await page.locator('#process li').count(), 5, '프로세스 5단계');
  ok((await page.locator('#recentTable tbody tr').count()) > 0, '최근 요청 목록에 행이 있다');
  ok((await page.locator('#logTable tbody tr').count()) > 0, '활동 이력에 행이 있다');

  console.log('\n2. 일곱 화면이 모두 그려진다');
  for (var i = 0; i < VIEWS.length; i++) {
    var v = VIEWS[i];
    await page.click('.nav-item[data-view="' + v + '"]');
    await page.waitForTimeout(150);
    ok(await page.locator('#view-' + v).isVisible(), v + ' 화면이 보인다');
  }
  eq(errors, [], '화면을 옮겨 다녀도 오류가 없다');

  console.log('\n3. 표 행이 접혀 두 배 높이가 되지 않는다');
  await page.click('.nav-item[data-view="requests"]');
  await page.waitForTimeout(300);
  var tall = await page.evaluate(function () {
    return [].slice.call(document.querySelectorAll('#reqTable tbody tr'))
      .filter(function (r) { return r.getBoundingClientRect().height > 60; }).length;
  });
  eq(tall, 0, '모든 행이 한 줄 높이다 (공통 테마의 .warn 여백에 걸리지 않는다)');
  ok((await page.locator('#reqTable tbody tr').count()) <= 50, '한 번에 50행까지만 그린다');
  ok(await page.locator('[data-more="req"]').isVisible(), '"더 보기" 가 남은 건수를 알린다');

  console.log('\n4. 신규 요청 등록');
  await page.fill('#reqForm [name=partNo]', '123456 100999');
  await page.fill('#reqForm [name=partName]', '연기 테스트 부품');
  await page.fill('#reqForm [name=model]', 'HX220L');
  await page.click('#reqForm button[type=submit]');
  await page.waitForTimeout(300);
  ok(/등록 완료/.test(await page.textContent('#reqFormMsg')), '요청이 등록된다');

  // 희망완료일을 요청일보다 앞으로 두면 막혀야 한다
  await page.fill('#reqForm [name=partNo]', '123456 100998');
  await page.fill('#reqForm [name=partName]', '거절 테스트');
  await page.fill('#reqForm [name=model]', 'HX220L');
  await page.fill('#reqForm [name=dueDate]', '2000-01-01');
  await page.click('#reqForm button[type=submit]');
  await page.waitForTimeout(300);
  ok(await page.locator('#reqErrors').isVisible(), '규칙 위반은 사유가 화면에 뜬다');

  console.log('\n5. 권한 — 수행자에게는 검토/수정이 열리지 않는다');
  await page.selectOption('#userSwitch', { label: '정민수 — 작업 수행자' });
  await page.waitForTimeout(300);
  await page.click('.nav-item[data-view="review"]');
  await page.waitForTimeout(250);
  ok(await page.locator('#reviewDenied').isVisible(), '접근 불가 안내가 뜬다');
  ok(!(await page.locator('#reviewPanel').isVisible()), '검토 목록은 그려지지 않는다');

  await page.click('.nav-item[data-view="requests"]');
  await page.waitForTimeout(250);
  ok(!(await page.locator('#newRequestCard').isVisible()), '수행자에게는 등록 폼이 없다');

  console.log('\n6. 좁은 화면에서 가로로 넘치지 않는다');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  var overflow = await page.evaluate(function () {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  });
  eq(overflow, false, '390px 에서 본문이 가로로 밀리지 않는다');

  eq(errors, [], '끝까지 자바스크립트 오류가 없다');
  await browser.close();
}
