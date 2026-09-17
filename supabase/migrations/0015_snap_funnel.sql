-- 테스트 종료 보관분(test_ad_snap)에도 퍼널 숫자를 남긴다 (2026-09-17) — 리포트에서 우수 소재의 CTR·3초 재생 중앙값이 비던 것
alter table test_ad_snap
  add column if not exists imp numeric not null default 0, add column if not exists reach numeric not null default 0,
  add column if not exists freq numeric not null default 0, add column if not exists clicks numeric not null default 0,
  add column if not exists v3 numeric not null default 0, add column if not exists thru numeric not null default 0,
  add column if not exists lpv numeric not null default 0, add column if not exists atc numeric not null default 0,
  add column if not exists funnel_at timestamptz;   -- 퍼널 값을 마지막으로 받은 시각 (null = 옛 보관분, 값 없음)
