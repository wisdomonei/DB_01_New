-- ============================================================================
-- 로컬 검증 전용 — hd-project12 규칙이 서버에서도 막히는지 확인한다.
--
-- js/logic.js 의 판정과 **같은 규칙**을 여기서 다시 확인한다.
-- 브라우저 코드만 믿으면 REST 를 직접 부르는 순간 전부 통과해 버린다.
--
-- ⚠ 운영에서 실행할 수 없습니다(가드 내장).
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] 준비 — 사용자·요청 심기'; end $t$;

truncate public.activity_log, public.mail_log, public.deliverable,
         public.archive_doc, public.request, public.app_user cascade;

insert into public.app_user (id, name, email, org, role, status) values
  ('00000000-0000-0000-0000-000000000001', '한지혜', 'req@example.com',   '원가기획팀', '작업 요청자', '승인'),
  ('00000000-0000-0000-0000-000000000002', '정민수', 'w1@example.com',    '다원기술',   '작업 수행자', '승인'),
  ('00000000-0000-0000-0000-000000000003', '임현우', 'w2@example.com',    '성진ENG',    '작업 수행자', '승인대기'),
  ('00000000-0000-0000-0000-000000000009', '관리자', 'admin@example.com', '원가기획팀', '관리자',     '승인');

insert into public.request
  (id, part_no, part_name, model, requester_id, requester_email, requested_at, due_date)
values
  ('REQ-001', '123456-100001', '붐 실린더 브라켓', 'HX220L',
   '00000000-0000-0000-0000-000000000001', 'req@example.com', current_date - 10, current_date + 4);

-- ---------------------------------------------------------------- 입력 제약
do $t$ begin raise notice '[프로젝트] ① 입력 제약'; end $t$;

-- 엑셀 열이 밀리면 실제로 들어오던 값
do $t$
begin
  begin
    insert into public.request (id, part_no, part_name, model, requester_id, requester_email,
                                requested_at, due_date)
    values ('REQ-BAD1', '123456-100002', '버킷 링크', 'HL955',
            '00000000-0000-0000-0000-000000000001', 'req@example.com',
            current_date, current_date - 1);
    perform public._assert(false, '희망완료일 < 요청일 이 막힌다');
  exception when check_violation then
    perform public._assert(true, '희망완료일 < 요청일 이 막힌다');
  end;
end $t$;

do $t$
begin
  begin
    insert into public.request (id, part_no, part_name, model, requester_id, requester_email,
                                requested_at, due_date)
    values ('REQ-BAD2', '12345-1001', '버킷 링크', 'HL955',
            '00000000-0000-0000-0000-000000000001', 'req@example.com',
            current_date, current_date + 3);
    perform public._assert(false, '품번 형식(6자리-6자리)이 아니면 막힌다');
  exception when check_violation then
    perform public._assert(true, '품번 형식(6자리-6자리)이 아니면 막힌다');
  end;
end $t$;

do $t$
begin
  begin
    insert into public.request (id, part_no, part_name, model, requester_id, requester_email,
                                requested_at, due_date)
    values ('REQ-BAD3', '123456-100003', '버킷 링크', 'HL955',
            '00000000-0000-0000-0000-000000000001', 'req(at)example.com',
            current_date, current_date + 3);
    perform public._assert(false, '메일 형식이 아니면 막힌다');
  exception when check_violation then
    perform public._assert(true, '메일 형식이 아니면 막힌다');
  end;
end $t$;

-- ---------------------------------------------------------------- 상태 전이
do $t$ begin raise notice '[프로젝트] ② 상태 전이 — 건너뛸 수 없다'; end $t$;

do $t$
begin
  begin
    update public.request set status = '완료' where id = 'REQ-001';
    perform public._assert(false, '요청 → 완료 건너뛰기가 막힌다');
  exception when others then
    perform public._assert(sqlerrm like '%건너뛰거나%', '요청 → 완료 건너뛰기가 막힌다');
  end;
end $t$;

do $t$
begin
  begin
    update public.request set status = '검토/수정' where id = 'REQ-001';
    perform public._assert(false, '요청 → 검토/수정 건너뛰기가 막힌다');
  exception when others then
    perform public._assert(sqlerrm like '%건너뛰거나%', '요청 → 검토/수정 건너뛰기가 막힌다');
  end;
end $t$;

do $t$
begin
  begin
    update public.request set status = '작업중' where id = 'REQ-001';
    perform public._assert(false, '수행자 없이 착수할 수 없다');
  exception when others then
    perform public._assert(sqlerrm like '%수행자를 먼저 배정%', '수행자 없이 착수할 수 없다');
  end;
end $t$;

update public.request
   set assignee_id = '00000000-0000-0000-0000-000000000002', status = '작업중'
 where id = 'REQ-001';
do $t$ begin perform public._assert(
  (select status from public.request where id = 'REQ-001') = '작업중',
  '수행자를 배정하면 작업중으로 넘어간다'); end $t$;

-- 이 프로젝트의 이유 — 파일 없이 "제출했다" 고 적히지 않게
do $t$
begin
  begin
    update public.request set status = '검토/수정' where id = 'REQ-001';
    perform public._assert(false, '산출물 0건이면 검토로 못 넘어간다');
  exception when others then
    perform public._assert(sqlerrm like '%산출물 파일이 1개 이상%', '산출물 0건이면 검토로 못 넘어간다');
  end;
end $t$;

-- ---------------------------------------------------------------- 산출물
do $t$ begin raise notice '[프로젝트] ③ 산출물 — 초안과 수정본은 서로 덮지 않는다'; end $t$;

insert into public.deliverable (request_id, name, kind, uploader_id, size_bytes)
values ('REQ-001', 'PCT_123456-100001_v1.xlsx', '초안',
        '00000000-0000-0000-0000-000000000002', 512000);
insert into public.deliverable (request_id, name, kind, uploader_id, size_bytes)
values ('REQ-001', 'PCT_123456-100001_v2.xlsx', '초안',
        '00000000-0000-0000-0000-000000000002', 530000);

do $t$ begin perform public._assert_eq(
  (select max(version) from public.deliverable where request_id = 'REQ-001' and kind = '초안'),
  2, '초안 버전이 서버에서 1, 2로 자동 부여된다'); end $t$;

-- 검토 단계가 아닌데 수정본을 올리려 하면
do $t$
begin
  begin
    insert into public.deliverable (request_id, name, kind, uploader_id)
    values ('REQ-001', '수정본.xlsx', '수정본', '00000000-0000-0000-0000-000000000001');
    perform public._assert(false, '작업중 상태에는 수정본을 올릴 수 없다');
  exception when others then
    perform public._assert(sqlerrm like '%수정본은 검토/수정 상태%', '작업중 상태에는 수정본을 올릴 수 없다');
  end;
end $t$;

update public.request set status = '검토/수정' where id = 'REQ-001';
do $t$ begin perform public._assert_eq(
  (select submitted_at from public.request where id = 'REQ-001'), current_date,
  '검토로 넘어가면 제출일이 자동으로 찍힌다'); end $t$;

insert into public.deliverable (request_id, name, kind, uploader_id)
values ('REQ-001', '수정본_v1.xlsx', '수정본', '00000000-0000-0000-0000-000000000001');

do $t$ begin perform public._assert_eq(
  (select version from public.deliverable where request_id = 'REQ-001' and kind = '수정본'),
  1, '수정본 버전은 따로 센다 — 초안 v2를 덮지 않는다'); end $t$;
do $t$ begin perform public._assert_eq(
  (select count(*)::int from public.deliverable where request_id = 'REQ-001'),
  3, '초안 2건 + 수정본 1건이 모두 남는다'); end $t$;

do $t$
begin
  begin
    insert into public.deliverable (request_id, name, kind, version, uploader_id)
    values ('REQ-001', '중복.xlsx', '수정본', 1, '00000000-0000-0000-0000-000000000001');
    perform public._assert(false, '같은 (요청, 종류, 버전) 은 두 번 들어가지 않는다');
  exception when unique_violation then
    perform public._assert(true, '같은 (요청, 종류, 버전) 은 두 번 들어가지 않는다');
  end;
end $t$;

-- ---------------------------------------------------------------- 되돌리기
do $t$ begin raise notice '[프로젝트] ④ 되돌릴 때는 사유가 필요하다'; end $t$;

do $t$
begin
  begin
    update public.request set status = '작업중', review_note = '' where id = 'REQ-001';
    perform public._assert(false, '사유 없이 재작업으로 되돌릴 수 없다');
  exception when others then
    perform public._assert(sqlerrm like '%사유%', '사유 없이 재작업으로 되돌릴 수 없다');
  end;
end $t$;

update public.request set status = '작업중', review_note = '재질 단가 누락' where id = 'REQ-001';
do $t$ begin perform public._assert(
  (select status from public.request where id = 'REQ-001') = '작업중',
  '사유가 있으면 재작업으로 되돌아간다'); end $t$;

update public.request set status = '검토/수정' where id = 'REQ-001';
update public.request set status = '완료' where id = 'REQ-001';
do $t$ begin perform public._assert_eq(
  (select closed_at from public.request where id = 'REQ-001'), current_date,
  '완료로 바뀌면 완료일이 자동으로 찍힌다'); end $t$;

update public.request set status = '검토/수정', review_note = '설계 변경' where id = 'REQ-001';
do $t$ begin perform public._assert(
  (select closed_at from public.request where id = 'REQ-001') is null,
  '재개하면 완료일이 지워진다 — 완료 건수가 부풀지 않는다'); end $t$;

-- ---------------------------------------------------------------- 권한 회수
do $t$ begin raise notice '[프로젝트] ⑤ 승인을 거두면 배정도 비워진다'; end $t$;

insert into public.request
  (id, part_no, part_name, model, requester_id, requester_email, requested_at, due_date, assignee_id)
values
  ('REQ-002', '123456-100002', '버킷 링크', 'HL955',
   '00000000-0000-0000-0000-000000000001', 'req@example.com',
   current_date - 3, current_date + 7, '00000000-0000-0000-0000-000000000002');

update public.app_user set status = '거절'
 where id = '00000000-0000-0000-0000-000000000002';

do $t$ begin perform public._assert(
  (select assignee_id from public.request where id = 'REQ-002') is null,
  '승인이 취소되면 진행 중 건의 배정이 비워진다'); end $t$;

-- ---------------------------------------------------------------- 보관 자료
do $t$ begin raise notice '[프로젝트] ⑥ 보관 자료 — 빈 값을 확인됨으로 둘 수 없다'; end $t$;

insert into public.archive_doc (name, part_no, doc_date, confidence, confirmed)
values ('부품원가계산서_20150103.xlsx', null, date '2015-01-03', 'medium', true);
do $t$ begin perform public._assert(true, '일자만 있어도 확인 처리할 수 있다'); end $t$;

do $t$
begin
  begin
    insert into public.archive_doc (name, confidence, confirmed)
    values ('스캔본.pdf', 'low', true);
    perform public._assert(false, '품번도 일자도 없는 자료는 확인됨으로 둘 수 없다');
  exception when check_violation then
    perform public._assert(true, '품번도 일자도 없는 자료는 확인됨으로 둘 수 없다');
  end;
end $t$;

do $t$
begin
  begin
    insert into public.archive_doc (name, doc_month, confidence)
    values ('원가계산서_201513.xlsx', '2015-13', 'low');
    perform public._assert(false, '13월 같은 값은 doc_month 로 들어가지 않는다');
  exception when check_violation then
    perform public._assert(true, '13월 같은 값은 doc_month 로 들어가지 않는다');
  end;
end $t$;

-- ---------------------------------------------------------------- 정책 확인
do $t$ begin raise notice '[프로젝트] ⑦ 정책이 의도대로 붙어 있는가'; end $t$;

do $t$
declare v int;
begin
  select count(*) into v from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'request' and p.polcmd = 'r';
  perform public._assert(v = 1, 'request 에 SELECT 정책이 하나 있다');
end $t$;

do $t$
declare v text;
begin
  select pg_get_expr(p.polqual, p.polrelid) into v
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'request' and p.polname = 'request_read';
  perform public._assert(v like '%assignee_id%',
    '수행자는 배정된 건만 보도록 SELECT 정책에 assignee 조건이 들어 있다');
end $t$;

do $t$
declare v text;
begin
  select string_agg(p.polname, ', ') into v
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'app_user' and p.polcmd = 'a';
  perform public._assert(v is not null, 'app_user 에 INSERT(가입) 정책이 있다');
end $t$;

do $t$
declare v text;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'app_user' and p.polname = 'app_user_signup';
  perform public._assert(v like '%승인대기%' and v like '%관리자%',
    '스스로 관리자·승인 상태로 가입할 수 없다');
end $t$;

do $t$ begin raise notice '[프로젝트] 통과'; end $t$;
