-- 출장촬영 보드 (shoot-board.html) — 코디·릴스·제품컷 일정 + 사진 저장소
-- 실행: ~/.local/bin/supabase db query --project-ref pydxcqfztjogmztvayux -f supabase/migrations/0004_shoot_board.sql
-- 접근은 Edge Function shoot-board(초대코드 SHOOT_CODE 검증 뒤 service_role)로만. 광고 데이터 테이블과는 분리.

create table if not exists shoot_trips (
  id text primary key,
  name text not null default '',
  start_date date,
  days int not null default 4,
  models jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- 코디(outfit)·릴스(reel)·제품컷 일정(schedule)을 한 표에 — 화면이 쓰는 JSON을 data에 그대로 보관
create table if not exists shoot_items (
  id text primary key,
  trip_id text not null,
  kind text not null check (kind in ('outfit','reel','schedule')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false          -- 삭제는 표시만(다른 폰이 동기화로 지우게)
);
create index if not exists shoot_items_trip_upd on shoot_items (trip_id, updated_at);

alter table shoot_trips enable row level security;   -- 정책 없음 → 서버(service_role)만
alter table shoot_items enable row level security;
grant select, insert, update, delete on shoot_trips, shoot_items to service_role;
revoke all on shoot_trips, shoot_items from anon, authenticated;

-- 사진 저장소: 공개 읽기 버킷 (URL을 아는 사람만 볼 수 있는 옷 사진 — 업로드는 서버만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shoot-photos', 'shoot-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
