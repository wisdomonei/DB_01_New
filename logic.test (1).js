# supabase/ — 서버 모드

이 폴더의 `schema.sql` 하나면 됩니다. Supabase Dashboard → **SQL Editor** 에 붙여 넣고
실행하세요. 여러 번 실행해도 안전합니다(`IF NOT EXISTS` / `DROP ... IF EXISTS` 선행).

처음이라면 계정 만들기부터 단계별로 적어 둔 [`../SUPABASE-설정.md`](../SUPABASE-설정.md) 를 보세요.

## 무엇이 들어 있나

| 표 | 담는 것 |
|---|---|
| `app_user` | 사용자. `id` 는 `auth.users.id` 와 같은 값 |
| `request` | 작업 요청 (품번 1건 = 1행) |
| `deliverable` | 산출물 **메타데이터**. 파일 본문은 담지 않습니다 |
| `archive_doc` | 옛 부품원가계산서 (Database 관리) |
| `mail_log` | 메일 발송 이력 — 기록성 |
| `activity_log` | 활동 이력 — 기록성 |

기록성 표(`%log`)에는 **UPDATE / DELETE 정책을 두지 않았습니다.**
남기고 읽을 수만 있는 것이 곧 감사 이력입니다.

## 화면과 같은 규칙을 서버가 다시 막습니다

`js/logic.js` 의 판정은 브라우저에서만 돕니다. anon 키는 공개 키라
누구든 REST 를 직접 부르면 그 판정을 지나갈 수 있습니다. 그래서 같은 규칙을
제약·트리거·RLS 로 한 번 더 적었습니다.

| 규칙 | 어디서 |
|---|---|
| 상태는 한 칸씩만, 되돌릴 때는 사유 필수 | `enforce_status_flow` 트리거 |
| 산출물 0건이면 검토로 못 넘어감 | 같은 트리거 |
| 초안 v2 를 수정본 v1 이 덮지 않음 | `unique (request_id, kind, version)` |
| 버전은 서버가 매김 | `assign_deliverable_version` 트리거 |
| 희망완료일 ≥ 요청일 | `check (due_date >= requested_at)` |
| 품번은 `123456-100001` 형식 | `check (part_no ~ '^[0-9]{6}-[0-9]{6}$')` |
| 아무것도 못 읽은 자료를 '확인됨'으로 못 둠 | `archive_confirmed_needs_key` |
| 수행자는 배정된 건만 | `request_read` 정책 |
| 검토/수정 수정본은 요청자만 | `deliverable_insert` 정책 |
| 스스로 관리자로 가입 못 함 | `app_user_signup` 정책 |
| 승인 취소 시 진행 중 배정 해제 | `release_on_revoke` 트리거 |

## 로컬에서 먼저 검증하기

운영에서 처음 돌리지 않기 위한 장치입니다.

```bash
./scripts/sqltest/run.sh
```

임시 PostgreSQL 클러스터를 만들어 `schema.sql` 을 실제로 적용하고,
재실행 안전성 · RLS · 함수 권한 · 위 규칙들을 전부 확인한 뒤 클러스터를 지웁니다.
기존 PostgreSQL 설치에 영향이 없고, 운영 데이터베이스에서는 실행되지 않도록
가드가 들어 있습니다.

## 첫 관리자 만들기

스키마만 올리면 `app_user` 가 비어 있어 아무도 로그인하지 못합니다.

1. Dashboard → **Authentication → Users → Add user** 로 본인 계정을 만듭니다.
2. 그 사용자의 `uuid` 를 복사합니다.
3. SQL Editor 에서:

```sql
insert into public.app_user (id, name, email, org, role, status)
values ('<복사한 uuid>', '홍길동', 'me@example.com', '원가기획팀', '관리자', '승인')
on conflict (id) do update set role = '관리자', status = '승인';
```

이후 다른 사람은 각자 Auth 로 가입한 뒤 `app_user` 에 본인 한 줄을 넣고
(항상 `승인대기` 로 들어갑니다), 관리자가 화면에서 승인하면 됩니다.

## 접두사를 붙이지 않은 이유

이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
프로젝트가 본인 것이라 `pct_` 같은 접두사를 붙이지 않았습니다.
여러 앱을 한 프로젝트에 몰아 쓸 계획이면 이름 충돌을 먼저 확인하세요.
(`scripts/sqltest` 가 PostgreSQL 예약어와 겹치는지는 검사합니다.)
