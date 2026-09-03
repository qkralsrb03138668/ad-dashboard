-- 출장 일차별 촬영 장소 (shoot-board 더보기 > 출장 정보 / 현장 탭 장소 입력)
alter table shoot_trips add column if not exists locations jsonb not null default '{}'::jsonb;
