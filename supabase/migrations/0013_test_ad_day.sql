-- 테스트 소재 일별 누적 스냅샷 (2026-09-12) — 주간 리포트의 "기간 증분·전주 대비"용.
--   testads 조회(화면) 또는 sync(pg_cron, 하루 첫 실행)마다 그날 행을 덮어쓴다 → 하루 1행, 값 = 그 시점까지의 누적.
--   기간 성과 = 오늘 누적 − 기간 시작일 행. 30개 소재 × 365일 ≈ 1만 행이라 정리 불필요.
create table if not exists test_ad_day (
  ad_id text not null, day text not null,
  spend numeric not null default 0, purchases numeric not null default 0, value numeric not null default 0,
  status text not null default '', effective_status text not null default '',
  snap_at timestamptz not null default now(),
  primary key (ad_id, day));
alter table test_ad_day enable row level security;
grant select, insert, update, delete on test_ad_day to service_role;
revoke all on test_ad_day from anon, authenticated;
