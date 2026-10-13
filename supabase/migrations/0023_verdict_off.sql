-- 테스트 소재 판정에 'off' 추가 (2026-10-13) — 판정만 기록, 광고 끄기는 따로(자동으로 안 꺼짐)
alter table ad_test_state drop constraint if exists ad_test_state_verdict_check;
alter table ad_test_state add constraint ad_test_state_verdict_check check (verdict is null or verdict in ('meh','good','off'));
