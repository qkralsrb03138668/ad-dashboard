-- 광고 업로드 탭에서 '문구 다시 생성' 표시 (2026-09-11): 문구생성.command가 이 표시가 있는 소재의 상품만 새로 만든다
alter table creatives add column if not exists regen boolean not null default false;
