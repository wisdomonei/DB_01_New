/**
 * 파일 본문 보관소 — **이 브라우저 안에만** 둔다.
 *
 * 서버(또는 localStorage 문서)에는 파일 본문을 넣지 않는다.
 * 부품원가계산서 한 건이 수 MB 이고 품번마다 여러 버전이 쌓이므로,
 * 본문을 끌어안는 설계는 몇 달 안에 반드시 막힌다 (README 「용량과 권한」).
 *
 * 그렇다고 본문을 아무 데도 두지 않으면 **올린 파일에 다시 닿을 방법이 없다.**
 * 그래서 사본만 IndexedDB 에 둔다.
 *   · localStorage 가 아니라 IndexedDB 인 이유 — localStorage 는 5MB 안팎이고
 *     문자열만 담는다. 수 MB 짜리 엑셀을 base64 로 부풀려 넣으면 몇 개 만에 꽉 찬다.
 *     IndexedDB 는 Blob 을 그대로 담고 용량도 훨씬 넉넉하다.
 *   · 사본은 올린 사람의 브라우저에만 있다. 남에게 전달되지 않는다.
 *     팀이 함께 받아야 하면 원본 위치(link)를 등록하거나 Supabase Storage 를 붙인다.
 *
 * IndexedDB 가 없거나(node, 사생활 보호 모드) 막혀 있으면 조용히 꺼진다 —
 * 그때는 화면이 [사본 없음] 으로 정직하게 표시하고, 나머지 기능은 그대로 돈다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.FileStore = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DB_NAME = 'pct_file_copies';
  var STORE = 'blobs';
  var VERSION = 1;

  var dbPromise = null;
  var broken = false;      // 한 번 실패하면 매번 다시 시도하지 않는다

  function idb() {
    try { return root.indexedDB || null; } catch (e) { return null; }
  }

  /** 이 환경에서 사본을 둘 수 있는가. */
  function available() { return !!idb() && !broken; }

  function open() {
    if (!available()) return Promise.reject(new Error('IndexedDB 를 쓸 수 없습니다'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = idb().open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { broken = true; reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB 가 다른 탭에 잠겨 있습니다')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out;
        try { out = fn(store, resolve, reject); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('보관 작업이 취소되었습니다')); };
      });
    });
  }

  /** 사본을 넣는다. 실패해도 예외를 던지지 않는다 — 사본이 없을 뿐 업무는 계속된다. */
  function put(id, blob) {
    if (!available() || !blob) return Promise.resolve(false);
    return tx('readwrite', function (store) {
      store.put({ blob: blob, size: blob.size, at: new Date().toISOString() }, String(id));
      return true;
    }).catch(function (e) {
      // 용량 초과(QuotaExceededError)가 대부분이다. 조용히 넘기지 않고 알린다.
      if (typeof root.PCT_TOAST === 'function') {
        root.PCT_TOAST('사본을 브라우저에 두지 못했습니다: ' + (e && e.name || e), true);
      }
      return false;
    });
  }

  /** 사본을 꺼낸다. 없으면 null. */
  function get(id) {
    if (!available()) return Promise.resolve(null);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(String(id));
        req.onsuccess = function () { resolve(req.result ? req.result.blob : null); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return null; });
  }

  /** 어떤 파일들의 사본이 있는지 — 목록을 그릴 때 한 번에 묻는다. */
  function has(ids) {
    if (!available() || !ids || !ids.length) return Promise.resolve({});
    return open().then(function (db) {
      var store = db.transaction(STORE, 'readonly').objectStore(STORE);
      return Promise.all(ids.map(function (id) {
        return new Promise(function (resolve) {
          var req = store.getKey ? store.getKey(String(id)) : store.get(String(id));
          req.onsuccess = function () { resolve([id, req.result !== undefined && req.result !== null]); };
          req.onerror = function () { resolve([id, false]); };
        });
      })).then(function (pairs) {
        var out = {};
        pairs.forEach(function (p) { out[p[0]] = p[1]; });
        return out;
      });
    }).catch(function () { return {}; });
  }

  function remove(id) {
    if (!available()) return Promise.resolve(false);
    return tx('readwrite', function (store) { store.delete(String(id)); return true; })
      .catch(function () { return false; });
  }

  /** 지금 이 브라우저가 들고 있는 사본의 개수와 크기. */
  function usage() {
    if (!available()) return Promise.resolve({ count: 0, bytes: 0, on: false });
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var count = 0, bytes = 0;
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) { resolve({ count: count, bytes: bytes, on: true }); return; }
          count++; bytes += (c.value && c.value.size) || 0;
          c.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return { count: 0, bytes: 0, on: false }; });
  }

  function clear() {
    if (!available()) return Promise.resolve(false);
    return tx('readwrite', function (store) { store.clear(); return true; })
      .catch(function () { return false; });
  }

  /**
   * 이 브라우저가 우리 자료를 **함부로 지우지 않도록** 표시를 걸어 둔다.
   *
   * 기본값(best-effort)에서는 디스크가 빠듯해지면 브라우저가 IndexedDB 를
   * 조용히 비울 수 있다. 로컬에서만 쓰는 이 시스템에서는 그것이 곧 자료 유실이다.
   * persist() 를 받아 두면 사용자가 직접 지우기 전에는 남는다.
   *
   * 브라우저가 거절할 수도 있다(설치되지 않은 사이트, 방문 이력이 적을 때).
   * 거절되어도 동작은 그대로고, 화면이 그 사실을 표시한다.
   */
  function requestPersist() {
    try {
      var st = root.navigator && root.navigator.storage;
      if (!st || !st.persist) return Promise.resolve(false);
      return st.persisted().then(function (already) {
        return already ? true : st.persist();
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  /** 브라우저가 이 사이트에 허용한 전체 용량과 지금 쓴 양. */
  function estimate() {
    try {
      var st = root.navigator && root.navigator.storage;
      if (!st || !st.estimate) return Promise.resolve({ usage: null, quota: null, persisted: false });
      return Promise.all([
        st.estimate(),
        st.persisted ? st.persisted().catch(function () { return false; }) : Promise.resolve(false)
      ]).then(function (r) {
        return { usage: r[0].usage, quota: r[0].quota, persisted: !!r[1] };
      }).catch(function () { return { usage: null, quota: null, persisted: false }; });
    } catch (e) { return Promise.resolve({ usage: null, quota: null, persisted: false }); }
  }

  /** 브라우저에 파일로 저장시킨다. */
  function saveAs(blob, name) {
    var url = root.URL.createObjectURL(blob);
    var a = root.document.createElement('a');
    a.href = url;
    a.download = name || 'download';
    root.document.body.appendChild(a);
    a.click();
    a.remove();
    // 바로 지우면 브라우저가 저장을 시작하기 전에 주소가 사라질 수 있다
    setTimeout(function () { root.URL.revokeObjectURL(url); }, 60000);
  }

  return {
    available: available, put: put, get: get, has: has,
    remove: remove, usage: usage, clear: clear, saveAs: saveAs,
    requestPersist: requestPersist, estimate: estimate
  };
});
