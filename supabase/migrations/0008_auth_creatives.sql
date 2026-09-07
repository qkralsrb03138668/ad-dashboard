-- 로그인 계정 역할 + 소재 등록 (2026-09-07)
--   profiles: Supabase Auth 사용자 ↔ 역할(admin=광고 생성·예산, marketer=소재 등록). 프로필 없는 계정은 서버가 거부.
--   creatives: 소재 등록 기록 — 파일은 Meta 광고 계정 보관함에 올리고(image_hash / video_id) 여기엔 메타데이터만.
--   product_alias: 파일명 핵심 상품명 → 카페24 상품번호 (중복 상품명에서 한 번 고른 선택 기억)
create table if not exists profiles (
  user_id    uuid primary key,
  email      text not null unique,
  name       text,
  role       text not null default 'marketer' check (role in ('admin','marketer')),
  created_at timestamptz not null default now()
);
create table if not exists creatives (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_email text,
  file_name        text not null,
  kind             text not null check (kind in ('image','video')),
  core_name        text,
  product_no       int,
  product_name     text,
  url              text,
  text             jsonb,
  media            jsonb not null,
  status           text not null default 'registered' check (status in ('registered','ad_created')),
  ad_id            text,
  adset_id         text,
  ad_created_at    timestamptz,
  ad_created_by    text,
  model_ad_id      text
);
create index if not exists creatives_status_idx on creatives (status, created_at desc);
create index if not exists creatives_product_idx on creatives (product_no);
create table if not exists product_alias (
  core_name    text primary key,
  product_no   int not null,
  product_name text,
  updated_at   timestamptz not null default now()
);
-- 0002_grants와 같은 규칙: 서버(service_role)만, 브라우저 키는 접근 불가
grant select, insert, update, delete on profiles, creatives, product_alias to service_role;
revoke all on profiles, creatives, product_alias from anon, authenticated;
