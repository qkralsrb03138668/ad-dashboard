-- 테스트 소재 판정일 — 주간 리포트의 "이번 기간 판정" 필터용 (2026-09-11)
-- 메모만 고쳐도 updated_at은 바뀌므로 판정 시각을 따로 둔다. 기존 판정은 updated_at으로 채움.
alter table ad_test_state add column if not exists verdict_at timestamptz;
update ad_test_state set verdict_at = updated_at where verdict is not null and verdict_at is null;
