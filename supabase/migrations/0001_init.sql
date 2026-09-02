-- 광고관리자 이식용 DB 스키마 (danarobe/dnrb-dashboard 이식 가이드 §4 그대로)
-- Supabase SQL Editor에 붙여넣고 실행하면 된다.
-- 1단계(계층 뷰)에는 api_cache만 필요하지만, 2~3단계 대비 5개 전부 만들어 둔다.

-- 서버 결과 캐시 (Meta 호출 한도 방어선 — 필수)
create table if not exists api_cache (
  cache_key text primary key, payload jsonb, created_at timestamptz default now());

-- 테스트 소재 판정·메모·추가소재 체크 (광고 단위) — 2단계용
create table if not exists ad_test_state (
  ad_id text primary key, ad_name text not null default '',
  hidden boolean not null default false, recommend boolean not null default false,  -- recommend는 원본에서 폐기됐지만 코드 호환용
  memo text, verdict text check (verdict is null or verdict in ('meh','good')),
  asset_req_at timestamptz, asset_done_at timestamptz,
  updated_by text, updated_at timestamptz default now());

-- 베스트소재 보드 (광고세트 단위) — 3단계용
create table if not exists best_ads (
  adset_id text primary key, adset_name text not null default '',
  added_by text, created_at timestamptz default now());

-- 테스트 소재 스냅샷 — 세트명에서 test를 지워도 '테스트 종료'로 계속 보이게 — 2단계용
create table if not exists test_ad_snap (
  ad_id text primary key, name text not null default '', adset_id text not null default '',
  adset_name text not null default '', status text not null default '', effective_status text not null default '',
  reg_date text not null default '', spend numeric not null default 0, purchases numeric not null default 0,
  value numeric not null default 0, first_seen timestamptz default now(), last_seen timestamptz default now());

-- 예산 변경 기록 — 4단계(예산 쓰기)를 붙일 때만 쓰인다
create table if not exists budget_writes (
  id uuid primary key default gen_random_uuid(), kind text, object_id text, object_name text,
  old_value numeric, new_value numeric, status text, requested_by text, run_at timestamptz,
  created_at timestamptz default now());

-- 전 테이블 RLS 켜고 정책 없이 두기 — 접근은 서버(service_role)로만 (가이드 §4 마지막 줄)
alter table api_cache     enable row level security;
alter table ad_test_state enable row level security;
alter table best_ads      enable row level security;
alter table test_ad_snap  enable row level security;
alter table budget_writes enable row level security;
