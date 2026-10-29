-- 시각 지정 예약 (2026-10-29 주말 모드: 금 17시 감액 · 일 15시 원복) — mode='timed' 행의 반영 시각.
-- meta-ads sync(5분 cron)가 meta-budget run_timed를 불러 apply_at이 지난 pending을 반영한다.
-- old_budget = 반영 직전 기대 예산 — 그 사이 누가 예산을 바꿨으면 건너뜀(canceled)
alter table budget_writes add column if not exists apply_at timestamptz;
create index if not exists budget_writes_timed_due on budget_writes (apply_at) where status = 'pending' and mode = 'timed';
