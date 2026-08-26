/**
 * 접속 설정 — **여기에 본인 Supabase 정보를 넣으세요.**
 *
 * 이 저장소는 각자 자기 Supabase 프로젝트에 연결해 쓰는 것을 전제로 합니다.
 * 아래 두 값이 비어 있으면 **데모 모드**로 돌아가고(브라우저에만 저장),
 * 값을 채우고 USE_SUPABASE 를 true 로 하면 **서버 모드**가 됩니다.
 * 어느 쪽이든 화면과 규칙은 같습니다 — 저장 위치와, 규칙을 누가 막느냐만 다릅니다.
 * (데모 모드는 js/logic.js 가, 서버 모드는 거기에 더해 Postgres 제약·RLS 가 막습니다.)
 *
 * 값을 어디서 가져오나
 *   supabase.com → 본인 프로젝트 → Settings → API
 *     Project URL      → SUPABASE_URL
 *     Project API keys → anon / public  → SUPABASE_ANON_KEY
 *
 * ⚠ anon 키는 공개해도 되는 키입니다(브라우저에 그대로 들어갑니다).
 *   실제 접근 제어는 키가 아니라 supabase/schema.sql 의 RLS 정책이 합니다.
 *   **service_role 키는 절대 여기에 넣지 마세요.** 그 키는 RLS 를 통째로 우회합니다.
 */
(function (root) {
  'use strict';

  root.APP_CONFIG = {
    // 예: 'https://abcdefghijklmnop.supabase.co'
    SUPABASE_URL: '',

    // 예: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'  (anon / public 키)
    SUPABASE_ANON_KEY: '',

    /**
     * 서버 모드로 쓸지.
     *
     * 위 두 값을 채우고 supabase/schema.sql 을 SQL Editor 에서 실행한 뒤 true 로 바꾸세요.
     * 스키마를 올리기 전에 켜면 "테이블 없음" 으로 실패하고 데모 모드로 내려갑니다
     * (화면은 계속 동작합니다).
     *
     * 커밋하지 않고 잠깐 확인만 하려면 주소 뒤에 ?supabase=1 을 붙이면 됩니다.
     */
    USE_SUPABASE: false
  };

  // 주소로 임시 전환 — 스키마를 올린 직후 커밋 없이 확인할 때
  try {
    var q = String(root.location && root.location.search || '');
    if (/[?&]supabase=1\b/.test(q)) root.APP_CONFIG.USE_SUPABASE = true;
    if (/[?&]supabase=0\b/.test(q)) root.APP_CONFIG.USE_SUPABASE = false;
  } catch (e) { /* 파일로 직접 열었을 때 */ }
})(typeof self !== 'undefined' ? self : this);
