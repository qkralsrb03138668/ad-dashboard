-- 하루 시작 예산 스냅샷 (매일 00:10 KST에 meta-budget?action=snapshot 이 기록) — 23:55 원복(run_reset)의 기준값
create table if not exists budget_daystart (
  day date not null,
  adset_id text not null,
  name text not null default '',
  budget numeric not null,
  taken_at timestamptz not null default now(),
  primary key (day, adset_id)
);
alter table budget_daystart enable row level security;   -- 정책 없음 → 서버(service_role)만
grant select, insert, update, delete on budget_daystart to service_role;
revoke all on budget_daystart from anon, authenticated;
