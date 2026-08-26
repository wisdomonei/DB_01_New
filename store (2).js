/* ============================================================================
 * PCT 부품원가계산서 작업관리 — 화면 골격
 *
 * 공통 디자인 시스템(css/hd-theme.css)이 이 파일 **뒤에** 실린다.
 * 그래서 여기에는 테마가 다루지 않는 것만 둔다: 좌측 고정 사이드바,
 * 대시보드 격자, 직접 그린 차트, 모달.
 * 카드·표·버튼·배지의 생김새는 테마에 맡긴다 — 여기서 다시 칠하면 어긋난다.
 * ========================================================================== */

:root {
  --side-w: 236px;
  --side-bg: #1a3a6b;
  --side-bg-2: #14305c;
  --side-ink: #dbe6f7;
  --side-ink-dim: #90a8cd;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

/* ------------------------------------------------------------------ 골격 */
.shell { display: flex; min-height: 100vh; }

.sidebar {
  width: var(--side-w);
  flex: 0 0 var(--side-w);
  background: linear-gradient(180deg, var(--side-bg) 0%, var(--side-bg-2) 100%);
  color: var(--side-ink);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.content {
  flex: 1 1 auto;
  min-width: 0;              /* 표가 넘칠 때 사이드바를 밀지 않게 한다 */
  display: flex;
  flex-direction: column;
  padding: 0 24px 40px;
}

/* ------------------------------------------------------------------ 브랜드 */
.brand {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 20px 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}
.brand-mark {
  flex: 0 0 auto;
  width: 34px; height: 34px; border-radius: 9px;
  background: #fff; color: var(--side-bg);
  font-size: 12px; font-weight: 800; letter-spacing: .02em;
  display: grid; place-items: center;
}
.brand-text b { display: block; font-size: 13.5px; line-height: 1.35; color: #fff; }
.brand-text small { display: block; margin-top: 4px; font-size: 11px; color: var(--side-ink-dim); }

/* ------------------------------------------------------------------ 메뉴 */
.side-nav { flex: 1 1 auto; overflow-y: auto; padding: 14px 10px; }
.nav-group {
  font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  color: var(--side-ink-dim); text-transform: uppercase;
  padding: 14px 8px 6px;
}
.nav-group:first-child { padding-top: 2px; }

.nav-item {
  display: block; width: 100%; text-align: left;
  padding: 9px 12px; margin-bottom: 2px;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--side-ink);
  font: inherit; font-size: 13.5px; font-weight: 500;
  cursor: pointer;
}
.nav-item:hover { background: rgba(255, 255, 255, .10); color: #fff; }
.nav-item:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
/* 선택 표시를 색만으로 두지 않는다 — 왼쪽 막대가 함께 선다.
   짙은 남색 위의 색 대비만으로는 흑백 인쇄나 색각 이상에서 구분이 사라진다. */
.nav-item.active {
  background: rgba(255, 255, 255, .16); color: #fff; font-weight: 700;
  box-shadow: inset 3px 0 0 #fff;
}

/* ------------------------------------------------------------------ 계정 */
.side-foot {
  padding: 14px 14px 16px;
  border-top: 1px solid rgba(255, 255, 255, .12);
  background: rgba(0, 0, 0, .12);
}
.who { margin-bottom: 10px; }
.who-label { display: block; font-size: 10.5px; color: var(--side-ink-dim); }
.who b { display: block; font-size: 15px; color: #fff; margin-top: 2px; }
.who-role { font-size: 11.5px; color: var(--side-ink-dim); }
.who-switch { display: block; font-size: 11px; color: var(--side-ink-dim); margin-bottom: 8px; }
.who-switch select {
  width: 100%; margin-top: 4px;
  background: rgba(255, 255, 255, .12); color: #fff;
  border: 1px solid rgba(255, 255, 255, .22); border-radius: 7px;
  padding: 6px 8px; font-size: 12.5px;
}
.who-switch select option { color: #0f172a; }
/* 공통 테마가 이 파일 뒤에 오므로 `.side-foot .btn` 만으로는 특정도가 같아 진다.
   짙은 남색 위에 흰 카드 버튼이 얹혀 글자가 묻히므로 `.hd.hd-app` 을 붙여 이긴다. */
.hd.hd-app .side-foot .btn {
  width: 100%; background: transparent; color: var(--side-ink);
  border-color: rgba(255, 255, 255, .28);
}
.hd.hd-app .side-foot .btn:hover {
  background: rgba(255, 255, 255, .14); color: #fff; border-color: rgba(255, 255, 255, .5);
}
.hd.hd-app .who-switch select {
  background: rgba(255, 255, 255, .12); color: #fff;
  border-color: rgba(255, 255, 255, .22);
}

/* ------------------------------------------------------------------ 상단 */
.appbar {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  padding: 22px 0 16px;
  border-bottom: 1px solid var(--hd-line);
  margin-bottom: 18px;
}
.appbar h1 { margin: 0; font-size: 22px; }
.appbar .sub { margin: 4px 0 0; font-size: 13px; }
.appbar-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mode-chip {
  font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px;
  background: var(--hd-surface-2); border: 1px solid var(--hd-line); color: var(--hd-ink-2);
}

.demo-banner {
  background: var(--hd-warn-soft);
  border: 1px solid #f0dcb4;
  border-radius: var(--hd-r);
  padding: 11px 14px;
  font-size: 12.5px; line-height: 1.65; color: #6b4a06;
  margin-bottom: 18px;
}

/* ------------------------------------------------------------------ 격자 */
.grid-2, .grid-3 { display: grid; gap: 16px; margin-top: 16px; }
.grid-2 { grid-template-columns: 1fr 1fr; }
.grid-3 { grid-template-columns: 1.05fr 1.15fr .9fr; }
@media (max-width: 1180px) { .grid-3 { grid-template-columns: 1fr 1fr; } }
@media (max-width: 900px)  { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

.view > .card + .card,
.view > .grid-2, .view > .grid-3 { margin-top: 16px; }

/* 카드 제목 오른쪽에 붙는 조작부 */
.card > h3 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.card > h3 .btn, .card > h3 .inline-ctl { margin-left: auto; }
.inline-ctl { font-size: 12px; font-weight: 500; color: var(--hd-ink-3); }
.inline-ctl select { margin-left: 6px; }

/* ------------------------------------------------------------------ 차트 */
.chart svg, .donut-wrap svg { display: block; max-width: 100%; height: auto; }

.donut-wrap { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.legend { list-style: none; margin: 0; padding: 0; flex: 1 1 150px; }
.legend li {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; padding: 5px 0;
}
.legend .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.legend .lg-name { flex: 1 1 auto; }
.legend .lg-num { font-weight: 700; font-variant-numeric: tabular-nums; }
.legend .lg-pct { color: var(--hd-ink-3); font-size: 12px; width: 34px; text-align: right; }

/* ------------------------------------------------------------- 오늘의 일정 */
.today-list { font-size: 13px; }
.today-head {
  display: flex; align-items: center; gap: 7px;
  font-weight: 700; margin: 12px 0 6px;
}
.today-head:first-child { margin-top: 0; }
.today-head .dot { width: 8px; height: 8px; border-radius: 50%; }
.today-row {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 5px 0; border-bottom: 1px dashed var(--hd-line-soft);
  cursor: pointer;
}
.today-row:hover { background: var(--hd-surface-2); }
.today-row .r-id { font-family: var(--hd-mono); font-size: 12px; }
.today-row .r-meta { color: var(--hd-ink-3); font-size: 12px; }
.today-more { color: var(--hd-ink-3); font-size: 12px; padding-top: 6px; }

/* ------------------------------------------------------------ 프로세스 */
.process {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
}
@media (max-width: 900px) { .process { grid-template-columns: 1fr 1fr; } }
.process li {
  position: relative;
  border: 1px solid var(--hd-line); border-radius: var(--hd-r);
  padding: 12px 12px 12px 14px; background: var(--hd-surface-2);
}
.process li b { display: block; font-size: 14px; margin-bottom: 4px; }
.process li .step-no {
  display: inline-grid; place-items: center;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--accent); color: var(--on-accent);
  font-size: 11px; font-weight: 700; margin-bottom: 8px;
}
.process li .step-count {
  position: absolute; top: 10px; right: 12px;
  font-size: 12px; font-weight: 700; color: var(--accent);
}
.process li p { margin: 0; font-size: 12px; color: var(--hd-ink-2); line-height: 1.6; }

/* ------------------------------------------------------------- 빠른 작업 */
.quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 900px) { .quick { grid-template-columns: 1fr 1fr; } }
.quick button {
  text-align: left; padding: 14px;
  border: 1px solid var(--hd-line); border-radius: var(--hd-r);
  background: var(--hd-surface); cursor: pointer; font: inherit;
}
.quick button:hover { border-color: var(--accent); background: var(--accent-soft); }
.quick button b { display: block; font-size: 13.5px; margin-bottom: 4px; }
.quick button span { font-size: 12px; color: var(--hd-ink-3); }

/* ------------------------------------------------------------------ 폼 */
.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 14px; }
@media (max-width: 1100px) { .form-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px)  { .form-grid { grid-template-columns: 1fr; } }
.form-grid label { display: flex; flex-direction: column; gap: 5px; }
.form-grid label.wide { grid-column: 1 / -1; }
.form-actions {
  grid-column: 1 / -1;
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.form-msg { font-size: 13px; color: var(--hd-ok); font-weight: 600; }
.form-msg.bad { color: var(--hd-bad); }

.err-list {
  margin: 12px 0 0; padding: 10px 14px 10px 30px;
  background: var(--hd-bad-soft); border: 1px solid #f3c9c1;
  border-radius: var(--hd-r); color: #8b2415; font-size: 13px;
}
.err-list li { margin: 3px 0; }

.filters {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;
  padding: 12px; margin-bottom: 12px;
  background: var(--hd-surface-2); border: 1px solid var(--hd-line-soft);
  border-radius: var(--hd-r);
}
.filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.filters input[type="search"] { min-width: 200px; }
.filters label:has(input[type="checkbox"]) { flex-direction: row; align-items: center; gap: 6px; }

.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }

/* ------------------------------------------------------------------ 표 */
.tablewrap { overflow-x: auto; }
/* 열이 많은 표(작업 요청 목록은 11열)를 폭 100%에 욱여넣으면 셀 안에서 줄이 접혀
   한 행이 세 줄 높이가 된다. 내용만큼 넓히고 넘치면 감싼 상자를 가로로 굴린다.
   공통 테마의 `table { width:100% }` 를 이기려고 `.hd.hd-app` 을 붙였다. */
.hd.hd-app .tablewrap > .tbl { width: auto; min-width: 100%; }
.tbl td.id, .tbl td.pn { font-family: var(--hd-mono); font-size: 12.5px; white-space: nowrap; }
.tbl tr.clickable { cursor: pointer; }
/* 품명이 세 줄로 접히면 표가 아니라 문단처럼 보인다.
   줄바꿈 대신 가로 스크롤(.tablewrap)에 맡긴다. */
.tbl td, .tbl th { white-space: nowrap; }
.tbl td.wrap { white-space: normal; min-width: 220px; }
.tbl .empty { color: var(--hd-ink-3); text-align: center; padding: 26px 0; }
.tbl td .btn { white-space: nowrap; }
.nowrap { white-space: nowrap; }

/* 확신도 — 색 말고 글자로도 구분되게 둔다 */
.conf-high { color: var(--hd-ok); font-weight: 700; }
.conf-medium { color: var(--hd-warn); font-weight: 700; }
.conf-low { color: var(--hd-bad); font-weight: 700; }

.hintlist {
  margin: 4px 0 0; padding-left: 16px;
  font-size: 11.5px; color: var(--hd-ink-3); white-space: normal; max-width: 460px;
}

/* 표 아래 "더 보기" — 164행을 한 번에 뿌리면 스크롤로 아무것도 못 찾는다 */
.more-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.more-row .muted { font-size: 12.5px; }

/* ------------------------------------------------------------------ 모달 */
.modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; }
.modal-back { position: absolute; inset: 0; background: rgba(15, 23, 42, .5); }
.modal-box {
  position: relative; z-index: 1;
  width: min(880px, 100%); max-height: 88vh; overflow-y: auto;
  background: var(--hd-surface); border-radius: var(--hd-r-lg);
  box-shadow: var(--hd-shadow-lg);
}
.modal-head {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid var(--hd-line);
  background: var(--hd-surface);
}
.modal-head h2 { margin: 0; font-size: 17px; }
.modal-body { padding: 18px 20px 22px; }
.modal-body h4 { margin: 18px 0 8px; }
.modal-body h4:first-child { margin-top: 0; }

.kv { display: grid; grid-template-columns: 110px 1fr 110px 1fr; gap: 6px 12px; font-size: 13px; }
@media (max-width: 640px) { .kv { grid-template-columns: 100px 1fr; } }
.kv dt { color: var(--hd-ink-3); }
.kv dd { margin: 0; font-weight: 600; }

.act-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
.act-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.act-msg { font-size: 12.5px; font-weight: 600; }
.act-msg.bad { color: var(--hd-bad); }
.act-msg.ok { color: var(--hd-ok); }

/* ------------------------------------------------------------------ 토스트 */
.toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  z-index: 80; max-width: min(560px, calc(100vw - 32px));
  background: #0f172a; color: #fff;
  padding: 11px 18px; border-radius: 999px;
  font-size: 13px; font-weight: 600;
  box-shadow: var(--hd-shadow-lg);
}
.toast.bad { background: #8b2415; }

/* ------------------------------------------------------------------ 바닥 */
.foot {
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 34px; padding-top: 16px;
  border-top: 1px solid var(--hd-line);
  font-size: 12px; color: var(--hd-ink-3);
}

/* ------------------------------------------------------------------ 좁은 화면 */
@media (max-width: 780px) {
  .shell { flex-direction: column; }
  .sidebar { width: 100%; flex: none; height: auto; position: static; }
  .side-nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px; }
  .nav-group { width: 100%; padding: 8px 4px 2px; }
  .nav-item { width: auto; }
  .nav-item.active { box-shadow: inset 0 -3px 0 #fff; }
  .side-foot { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
  .side-foot .who, .side-foot .who-switch { margin-bottom: 0; }
  .side-foot .btn { width: auto; }
  .content { padding: 0 16px 32px; }
}

/* 다크 모드 — 테마가 면·글자색을 바꾸므로 여기서는 골격 색만 맞춘다 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --side-bg: #12233d;
    --side-bg-2: #0d1a2e;
  }
  :root:not([data-theme="light"]) .demo-banner { background: #33270e; border-color: #5c4715; color: #f0dcb4; }
  :root:not([data-theme="light"]) .quick button { background: transparent; }
}
:root[data-theme="dark"] { --side-bg: #12233d; --side-bg-2: #0d1a2e; }
