-- ============================================================================
-- hd-project12 — PCT(부품원가계산서) 작업관리
-- Supabase(Postgres) 운영 스키마 + RLS 정책
--
--  실행 위치 : Supabase Dashboard → SQL Editor
--  재실행    : 안전합니다 (IF NOT EXISTS / DROP ... IF EXISTS 선행)
--  로컬 검증 : ./scripts/sqltest/run.sh  (임시 PostgreSQL 에 실제로 적용해 봅니다)
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--
--  방침 — 화면이 막는 것을 서버가 한 번 더 막는다.
--    js/logic.js 의 판정(단계 건너뛰기 금지, 산출물 없이 제출 금지, 초안·수정본
--    버전 분리, 희망완료일 ≥ 요청일)은 브라우저에서만 도는 코드입니다.
--    누구든 REST 를 직접 부르면 그 판정을 지나칠 수 있으므로,
--    같은 규칙을 여기 제약(check)·트리거·RLS 로 다시 적어 둡니다.
--
--  ⚠ 파일 본문은 이 데이터베이스에 넣지 않습니다.
--    부품원가계산서 한 건이 수 MB 이고 품번마다 여러 버전이 쌓입니다.
--    표에는 이름·크기·버전·올린 사람과 원본 위치(link)만 남기고,
--    실제 파일은 Teams 공유 폴더나 Supabase Storage 에 둡니다 (README 「용량과 권한」).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 사용자. id 는 auth.users.id 와 같은 값을 넣습니다(가입 직후 본인이 한 줄 만듭니다).
create table if not exists public.app_user (
  id          uuid primary key,
  name        text not null check (btrim(name) <> ''),
  email       text not null unique,
  org         text,
  -- 역할을 자유 문자열로 두면 '작업수행자'·'수행자' 같은 표기가 섞여 권한이 조용히 새어 나간다
  role        text not null check (role in ('작업 요청자', '작업 수행자', '관리자')),
  -- 외부 인원은 가입만으로는 아무것도 못 한다. 관리자가 '승인' 으로 바꿔야 열린다.
  status      text not null default '승인대기' check (status in ('승인대기', '승인', '거절')),
  joined_at   date not null default current_date,
  decided_at  date,
  decided_by  uuid references public.app_user(id),
  created_at  timestamptz not null default now()
);

-- 작업 요청 (품번 1건 = 1행)
create table if not exists public.request (
  id              text primary key,                      -- 'REQ-001'
  -- 엑셀에서 복사해 온 전각 문자·공백은 화면에서 정규화하고, 여기서 형식을 못 박는다
  part_no         text not null check (part_no ~ '^[0-9]{6}-[0-9]{6}$'),
  part_name       text not null check (btrim(part_name) <> ''),
  model           text not null check (btrim(model) <> ''),
  requester_id    uuid not null references public.app_user(id),
  requester_email text not null check (requester_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  assignee_id     uuid references public.app_user(id),
  requested_at    date not null,
  due_date        date not null,
  eta             date,
  status          text not null default '요청'
                  check (status in ('요청', '작업중', '검토/수정', '완료')),
  submitted_at    date,
  closed_at       date,
  note            text not null default '',
  review_note     text not null default '',
  created_at      timestamptz not null default now(),

  -- 엑셀 열이 한 칸 밀리면 실제로 들어오던 값이다. 통과시키면 이후 지연 집계가 전부 음수가 된다.
  constraint request_due_after_requested check (due_date >= requested_at),
  constraint request_eta_after_requested check (eta is null or eta >= requested_at),
  constraint request_closed_needs_done   check (closed_at is null or status = '완료')
);

create index if not exists request_status_idx   on public.request (status);
create index if not exists request_assignee_idx on public.request (assignee_id);
create index if not exists request_part_no_idx  on public.request (part_no);

-- 산출물. (요청, 종류, 버전) 이 유일하다 — 수정본이 초안을 덮어쓸 수 없는 근거.
create table if not exists public.deliverable (
  id          uuid primary key default gen_random_uuid(),
  request_id  text not null references public.request(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  size_bytes  bigint not null default 0 check (size_bytes >= 0),
  kind        text not null check (kind in ('초안', '수정본')),
  version     integer check (version >= 1),
  uploader_id uuid references public.app_user(id),
  uploaded_at date not null default current_date,
  link        text,
  created_at  timestamptz not null default now(),
  constraint deliverable_version_unique unique (request_id, kind, version)
);

create index if not exists deliverable_request_idx on public.deliverable (request_id);

-- Database 관리 — 개인 폴더·공유 폴더에 흩어져 있던 옛 원가계산서
create table if not exists public.archive_doc (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (btrim(name) <> ''),
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  part_no       text check (part_no is null or part_no ~ '^[0-9]{6}-[0-9]{6}$'),
  model         text,
  doc_date      date,
  doc_month     text check (doc_month is null or doc_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  version       integer,
  title         text,
  confidence    text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  source        text,
  registered_at date not null default current_date,
  confirmed     boolean not null default false,
  created_at    timestamptz not null default now(),

  -- 아무것도 못 읽은 자료를 '확인됨' 으로 표시하면 검색에서 영영 못 찾는다.
  -- 최소한 품번이나 일자 하나는 채워야 확인 처리할 수 있다.
  constraint archive_confirmed_needs_key
    check (not confirmed or part_no is not null or doc_date is not null or doc_month is not null)
);

create index if not exists archive_doc_date_idx on public.archive_doc (doc_date);

-- 기록성 테이블 — 사후 조작을 막기 위해 UPDATE/DELETE 정책을 두지 않는다
create table if not exists public.mail_log (
  id         uuid primary key default gen_random_uuid(),
  request_id text references public.request(id) on delete set null,
  kind       text not null default '산출물 제출',
  to_addr    text not null,
  subject    text not null,
  sent_by    uuid references public.app_user(id),
  sent_at    timestamptz not null default now()
);

create table if not exists public.activity_log (
  id       uuid primary key default gen_random_uuid(),
  actor_id uuid references public.app_user(id),
  action   text not null,
  target   text,
  detail   text,
  at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 판정 함수
--    RLS 정책 식에서 쓰므로 security definer 로 두고 search_path 를 고정한다.
--    (고정하지 않으면 호출자가 search_path 를 바꿔 다른 app_user 를 보게 만들 수 있다)
-- ----------------------------------------------------------------------------

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select u.role from public.app_user u where u.id = auth.uid() and u.status = '승인';
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = '관리자';
$$;

-- 요청자와 관리자를 한 묶음으로 본다. 검토/수정·배정·보관자료 정리가 이 묶음의 일이다.
create or replace function public.is_owner_side()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('작업 요청자', '관리자');
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null;
$$;

-- ----------------------------------------------------------------------------
-- 3. 트리거 — 화면과 같은 규칙을 서버에서 다시 막는다
-- ----------------------------------------------------------------------------

/*
 * 상태는 한 칸씩만 움직인다.
 *
 * 공유 엑셀에서는 '요청' 이던 줄이 다음 주에 '완료' 로 바뀌어 있고 그 사이가
 * 남지 않았다. 여기서는 건너뛸 수 없고, 되돌릴 때는 사유를 받는다.
 */
create or replace function public.enforce_status_flow()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
       (old.status = '요청'      and new.status = '작업중')
    or (old.status = '작업중'    and new.status = '검토/수정')
    or (old.status = '검토/수정' and new.status = '완료')
    or (old.status = '검토/수정' and new.status = '작업중')     -- 재작업 반려
    or (old.status = '완료'      and new.status = '검토/수정')  -- 완료 건 재개
  ) then
    raise exception '% 에서 % 로 바꿀 수 없습니다 — 단계를 건너뛰거나 두 칸 되돌릴 수 없습니다',
      old.status, new.status;
  end if;

  if old.status = '요청' and new.assignee_id is null then
    raise exception '수행자를 먼저 배정해야 착수할 수 있습니다';
  end if;

  -- 이 프로젝트의 이유. 파일 없이 "제출했다" 고 적힌 줄이 실제로 있었다.
  if old.status = '작업중' and new.status = '검토/수정'
     and not exists (select 1 from public.deliverable d where d.request_id = new.id) then
    raise exception '산출물 파일이 1개 이상 있어야 검토로 넘어갑니다';
  end if;

  if (old.status = '검토/수정' and new.status = '작업중')
     or (old.status = '완료' and new.status = '검토/수정') then
    if coalesce(btrim(new.review_note), '') = '' then
      raise exception '되돌릴 때는 사유(review_note)를 적어야 합니다';
    end if;
  end if;

  -- 날짜는 사람이 적는 값이 아니라 상태가 바뀐 사실에서 나온다
  if new.status = '검토/수정' and old.status = '작업중' then
    new.submitted_at := coalesce(new.submitted_at, current_date);
  end if;
  if new.status = '완료' then
    new.closed_at := coalesce(new.closed_at, current_date);
  else
    new.closed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists request_status_flow on public.request;
create trigger request_status_flow
  before update on public.request
  for each row execute function public.enforce_status_flow();

/*
 * 산출물 버전은 서버가 매긴다.
 *
 * 브라우저가 계산해 보내면 두 사람이 동시에 올릴 때 같은 번호가 두 번 나온다.
 * 종류(초안/수정본)마다 따로 세므로 요청자의 수정본이 수행자 초안을 덮지 않는다.
 */
create or replace function public.assign_deliverable_version()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  select r.status into v_status from public.request r where r.id = new.request_id;
  if v_status is null then
    raise exception '없는 요청입니다: %', new.request_id;
  end if;

  if new.kind = '초안' and v_status <> '작업중' then
    raise exception '초안은 작업중 상태에서만 올릴 수 있습니다 (현재 %)', v_status;
  end if;
  if new.kind = '수정본' and v_status <> '검토/수정' then
    raise exception '수정본은 검토/수정 상태에서만 올릴 수 있습니다 (현재 %)', v_status;
  end if;

  if new.version is null then
    select coalesce(max(d.version), 0) + 1 into new.version
      from public.deliverable d
     where d.request_id = new.request_id and d.kind = new.kind;
  end if;
  return new;
end;
$$;

drop trigger if exists deliverable_version on public.deliverable;
create trigger deliverable_version
  before insert on public.deliverable
  for each row execute function public.assign_deliverable_version();

/*
 * 승인을 거두면 그 사람에게 배정된 진행 중 건도 함께 비운다.
 * 그대로 두면 "볼 수 없는 사람에게 배정된 요청" 이 남아 아무도 손대지 않는다.
 */
create or replace function public.release_on_revoke()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = '승인' and new.status <> '승인' then
    update public.request
       set assignee_id = null
     where assignee_id = new.id and status <> '완료';
  end if;
  return new;
end;
$$;

drop trigger if exists app_user_revoke on public.app_user;
create trigger app_user_revoke
  after update of status on public.app_user
  for each row execute function public.release_on_revoke();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.app_user     enable row level security;
alter table public.request      enable row level security;
alter table public.deliverable  enable row level security;
alter table public.archive_doc  enable row level security;
alter table public.mail_log     enable row level security;
alter table public.activity_log enable row level security;

-- 사용자 ------------------------------------------------------------------
drop policy if exists app_user_read   on public.app_user;
drop policy if exists app_user_signup on public.app_user;
drop policy if exists app_user_admin  on public.app_user;
drop policy if exists app_user_del    on public.app_user;

create policy app_user_read on public.app_user
  for select to authenticated using (true);

-- 가입은 본인 한 줄만, 항상 '승인대기' 로. 스스로 관리자가 될 수 없다.
create policy app_user_signup on public.app_user
  for insert to authenticated
  with check (id = auth.uid() and status = '승인대기' and role <> '관리자');

create policy app_user_admin on public.app_user
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy app_user_del on public.app_user
  for delete to authenticated using (public.is_admin());

-- 요청 --------------------------------------------------------------------
drop policy if exists request_read   on public.request;
drop policy if exists request_insert on public.request;
drop policy if exists request_update on public.request;
drop policy if exists request_delete on public.request;

-- 외부 수행자는 자기에게 배정된 건만 보인다. 화면이 아니라 여기서 좁혀진다.
create policy request_read on public.request
  for select to authenticated
  using (public.is_owner_side() or (public.is_approved() and assignee_id = auth.uid()));

create policy request_insert on public.request
  for insert to authenticated
  with check (public.is_owner_side() and requester_id = auth.uid());

create policy request_update on public.request
  for update to authenticated
  using (public.is_owner_side() or (public.is_approved() and assignee_id = auth.uid()))
  with check (public.is_owner_side() or (public.is_approved() and assignee_id = auth.uid()));

create policy request_delete on public.request
  for delete to authenticated using (public.is_admin());

-- 산출물 ------------------------------------------------------------------
drop policy if exists deliverable_read   on public.deliverable;
drop policy if exists deliverable_insert on public.deliverable;
drop policy if exists deliverable_delete on public.deliverable;

create policy deliverable_read on public.deliverable
  for select to authenticated
  using (exists (
    select 1 from public.request r
     where r.id = deliverable.request_id
       and (public.is_owner_side() or (public.is_approved() and r.assignee_id = auth.uid()))));

-- 초안은 배정된 수행자가, 수정본은 요청자가. 상태 검사는 트리거가 한 번 더 한다.
create policy deliverable_insert on public.deliverable
  for insert to authenticated
  with check (
    public.is_approved() and exists (
      select 1 from public.request r
       where r.id = deliverable.request_id
         and ( (deliverable.kind = '초안'   and (r.assignee_id = auth.uid() or public.is_owner_side()))
            or (deliverable.kind = '수정본' and public.is_owner_side()) )));

create policy deliverable_delete on public.deliverable
  for delete to authenticated
  using (uploader_id = auth.uid() or public.is_admin());

-- 보관 자료 ---------------------------------------------------------------
drop policy if exists archive_read   on public.archive_doc;
drop policy if exists archive_write  on public.archive_doc;
drop policy if exists archive_update on public.archive_doc;
drop policy if exists archive_delete on public.archive_doc;

create policy archive_read on public.archive_doc
  for select to authenticated using (public.is_approved());
create policy archive_write on public.archive_doc
  for insert to authenticated with check (public.is_owner_side());
create policy archive_update on public.archive_doc
  for update to authenticated
  using (public.is_owner_side()) with check (public.is_owner_side());
create policy archive_delete on public.archive_doc
  for delete to authenticated using (public.is_owner_side());

-- 기록성 ------------------------------------------------------------------
-- 남기고 읽을 수만 있다. 고치거나 지우는 정책을 두지 않는 것이 곧 감사 이력이다.
drop policy if exists mail_log_read      on public.mail_log;
drop policy if exists mail_log_write     on public.mail_log;
drop policy if exists activity_log_read  on public.activity_log;
drop policy if exists activity_log_write on public.activity_log;

create policy mail_log_read  on public.mail_log  for select to authenticated using (public.is_approved());
create policy mail_log_write on public.mail_log  for insert to authenticated with check (public.is_approved());
create policy activity_log_read  on public.activity_log for select to authenticated using (public.is_approved());
create policy activity_log_write on public.activity_log for insert to authenticated with check (public.is_approved());

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--    Supabase 는 신규 함수마다 ALTER DEFAULT PRIVILEGES 로 anon 에 EXECUTE 를 붙인다.
--    PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
-- ----------------------------------------------------------------------------

do $grants$
declare v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not like '\_assert%'
  loop
    execute format('revoke all on function %s from public', v_fn.sig);
    begin
      execute format('revoke all on function %s from anon', v_fn.sig);
    exception when undefined_object then null;   -- 로컬 검증 환경에는 anon 이 없을 수 있다
    end;
    begin
      execute format('grant execute on function %s to authenticated', v_fn.sig);
    exception when undefined_object then null;
    end;
  end loop;
end;
$grants$;

-- ----------------------------------------------------------------------------
-- 6. 첫 관리자 심기 (선택)
--
--   Supabase Auth 로 본인 계정을 만든 뒤, 그 사용자의 uuid 로 아래를 한 번 실행하면
--   관리자가 됩니다. uuid 는 Dashboard → Authentication → Users 에서 복사합니다.
--
--   insert into public.app_user (id, name, email, org, role, status)
--   values ('<auth.users.id>', '홍길동', 'me@example.com', '원가기획팀', '관리자', '승인')
--   on conflict (id) do update set role = '관리자', status = '승인';
-- ----------------------------------------------------------------------------
