-- 판매 성과(카페24) — 이식 패키지 sql/schema.sql에서 api_cache(0001에 이미 있음)를 뺀 것
-- 권한: 0002_grants.sql의 default privileges로 service_role에 자동 부여, anon/authenticated는 자동 회수

-- 카페24 OAuth 토큰 (cafe24-oauth가 저장, cafe24-perf가 읽고 갱신)
create table if not exists api_tokens (
  provider            text primary key,     -- 'cafe24'
  access_token        text,
  refresh_token       text,
  expires_at          timestamptz,          -- access_token 만료 (카페24: 2시간)
  refresh_expires_at  timestamptz,          -- refresh_token 만료 (카페24: 2주 — 2주 동안 한 번도 안 부르면 재인증 필요)
  updated_at          timestamptz default now()
);
alter table api_tokens enable row level security;

-- 판매 성과 결과 저장 (기간별 비교용 스냅샷 — 요약 수치만)
create table if not exists perf_archive (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  period_start     text default '',
  period_end       text default '',
  overall_rr       numeric,                 -- 전체 취소·반품률(%) — 취소수량 ÷ 결제수량
  avg_margin       numeric,                 -- 전체 평균 마진율(%) — 순판매량 가중, 공급가×1.1 기준
  avg_cost_rate    numeric,                 -- 전체 평균 원가율(%)
  total_paid_qty   integer default 0,
  total_cancel_qty integer default 0,
  product_count    integer default 0,
  mapped_count     integer default 0,
  memo             text default '',
  created_at       timestamptz default now()
);
alter table perf_archive enable row level security;
