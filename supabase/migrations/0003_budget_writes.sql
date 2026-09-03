-- 예산 변경 기록 테이블 — 원본 meta-budget 함수가 실제로 쓰는 컬럼 구조로 교체
-- (0001의 budget_writes는 이식 가이드 요약본 스키마라 컬럼이 달랐음. 아직 빈 테이블이라 재생성)
drop table if exists budget_writes;
create table budget_writes (
  id bigserial primary key,
  object_id text not null,
  object_name text not null default '',
  level text not null,                 -- campaign | adset
  old_budget numeric,
  new_budget numeric not null,
  mode text not null,                  -- now(즉시) | midnight(자정 예약)
  apply_date date,                     -- midnight 예약의 적용일 (KST)
  status text not null,                -- applied | pending | canceled | failed
  requested_by text,
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  error text
);
alter table budget_writes enable row level security;   -- 정책 없음 → 서버(service_role)만 접근
grant select, insert, update, delete on budget_writes to service_role;
grant usage, select on sequence budget_writes_id_seq to service_role;
revoke all on budget_writes from anon, authenticated;

-- 자정 예약 실행용 확장 (pg_cron: 스케줄, pg_net: HTTP 호출). 잡 등록은 CRON_SECRET이 필요해 SETUP 문서의 SQL로 별도 실행.
create extension if not exists pg_cron;
create extension if not exists pg_net;
