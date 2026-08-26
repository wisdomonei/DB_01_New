/**
 * 가짜 Supabase 클라이언트 — 어댑터(js/supabase-store.js) 를 시험하기 위한 것.
 *
 * PostgREST 흉내만 내는 것이 아니라 **schema.sql 의 트리거와 같은 규칙**을 건다.
 * 그래야 "브라우저는 통과시켰는데 서버가 막는" 자리를 테스트가 잡는다.
 * (RLS 는 재현하지 않는다 — 그쪽은 scripts/sqltest 가 진짜 Postgres 로 본다.)
 */
'use strict';

function makeFake(seed) {
  var t = {
    app_user: (seed.app_user || []).slice(),
    request: (seed.request || []).slice(),
    deliverable: (seed.deliverable || []).slice(),
    archive_doc: (seed.archive_doc || []).slice(),
    mail_log: [], activity_log: []
  };
  var uid = seed.uid;
  var seq = 0;
  var denied = {};        // { 'table:op': '사유' — 서버가 거절하는 상황을 만든다 }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function err(m) { return { data: null, error: { message: m } }; }
  function okData(d) { return { data: clone(d), error: null }; }

  /* ------- schema.sql 의 트리거를 그대로 옮긴 것 ------- */

  function statusFlow(oldRow, patch) {
    if (!('status' in patch) || patch.status === oldRow.status) return null;
    var from = oldRow.status, to = patch.status;
    var allowed = [['요청', '작업중'], ['작업중', '검토/수정'], ['검토/수정', '완료'],
                   ['검토/수정', '작업중'], ['완료', '검토/수정']];
    if (!allowed.some(function (p) { return p[0] === from && p[1] === to; }))
      return from + ' 에서 ' + to + ' 로 바꿀 수 없습니다 — 단계를 건너뛰거나 두 칸 되돌릴 수 없습니다';
    if (from === '요청' && !(patch.assignee_id || oldRow.assignee_id))
      return '수행자를 먼저 배정해야 착수할 수 있습니다';
    if (from === '작업중' && to === '검토/수정' &&
        !t.deliverable.some(function (d) { return d.request_id === oldRow.id; }))
      return '산출물 파일이 1개 이상 있어야 검토로 넘어갑니다';
    if ((from === '검토/수정' && to === '작업중') || (from === '완료' && to === '검토/수정')) {
      var note = patch.review_note !== undefined ? patch.review_note : oldRow.review_note;
      if (!String(note || '').trim()) return '되돌릴 때는 사유(review_note)를 적어야 합니다';
    }
    return null;
  }

  function deliverableTrigger(row) {
    var r = t.request.filter(function (x) { return x.id === row.request_id; })[0];
    if (!r) return '없는 요청입니다: ' + row.request_id;
    if (row.kind === '초안' && r.status !== '작업중')
      return '초안은 작업중 상태에서만 올릴 수 있습니다 (현재 ' + r.status + ')';
    if (row.kind === '수정본' && r.status !== '검토/수정')
      return '수정본은 검토/수정 상태에서만 올릴 수 있습니다 (현재 ' + r.status + ')';
    if (row.version == null) {
      var max = 0;
      t.deliverable.forEach(function (d) {
        if (d.request_id === row.request_id && d.kind === row.kind) max = Math.max(max, d.version || 0);
      });
      row.version = max + 1;
    } else if (t.deliverable.some(function (d) {
      return d.request_id === row.request_id && d.kind === row.kind && d.version === row.version;
    })) {
      return '같은 (요청, 종류, 버전) 이 이미 있습니다';
    }
    return null;
  }

  function revokeTrigger(oldRow, patch) {
    if (oldRow.status === '승인' && patch.status && patch.status !== '승인') {
      t.request.forEach(function (r) {
        if (r.assignee_id === oldRow.id && r.status !== '완료') r.assignee_id = null;
      });
    }
  }

  /* ------------------------- 쿼리 빌더 ------------------------- */

  function from(name) {
    var rows = t[name];
    if (!rows) throw new Error('없는 테이블: ' + name);

    return {
      select: function () {
        return Promise.resolve(okData(rows));
      },
      insert: function (list) {
        var made = [], msg = null;
        (list || []).forEach(function (r) {
          if (msg) return;
          var row = clone(r);
          if (denied[name + ':insert']) { msg = denied[name + ':insert']; return; }
          if (name === 'deliverable') { msg = deliverableTrigger(row); if (msg) return; }
          if (!row.id) row.id = name + '-' + (++seq);
          if (name === 'mail_log') row.sent_at = new Date().toISOString();
          if (name === 'activity_log') row.at = new Date().toISOString();
          // 행 단위로 바로 반영한다 — 같은 insert 안의 두 번째 행이
          // 첫 행을 보지 못하면 버전이 둘 다 v1 로 매겨진다.
          rows.push(row);
          made.push(row);
        });
        if (msg) {
          made.forEach(function (r) {
            t[name] = t[name].filter(function (x) { return x !== r; });
          });
          return thenable(err(msg));
        }
        return thenable(okData(made));
      },
      update: function (patch) {
        return {
          eq: function (col, val) {
            if (denied[name + ':update']) return Promise.resolve(err(denied[name + ':update']));
            var hit = rows.filter(function (r) { return r[col] === val; });
            for (var i = 0; i < hit.length; i++) {
              if (name === 'request') {
                var m = statusFlow(hit[i], patch);
                if (m) return Promise.resolve(err(m));
              }
              if (name === 'app_user') revokeTrigger(hit[i], patch);
              Object.keys(patch).forEach(function (k) { hit[i][k] = patch[k]; });
            }
            return Promise.resolve(okData(hit));
          }
        };
      },
      delete: function () {
        return {
          eq: function (col, val) {
            if (denied[name + ':delete']) return Promise.resolve(err(denied[name + ':delete']));
            var kept = rows.filter(function (r) { return r[col] !== val; });
            t[name] = kept;
            return Promise.resolve(okData([]));
          }
        };
      }
    };

    // .insert(...).select() 도, 그냥 await 도 되게 한다 (supabase-js 와 같은 모양)
    function thenable(res) {
      var p = Promise.resolve(res);
      p.select = function () { return Promise.resolve(res); };
      return p;
    }
  }

  return {
    _tables: t,
    _deny: function (key, msg) { denied[key] = msg; },
    _allow: function (key) { delete denied[key]; },
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: { user: { id: uid } } }, error: null });
      },
      signInWithPassword: function () {
        return Promise.resolve({ data: { user: { id: uid } }, error: null });
      }
    },
    from: from
  };
}

module.exports = { makeFake: makeFake };
