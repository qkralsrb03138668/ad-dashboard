-- CS 온보딩 체크리스트 기록 (2026-09-30): cs-onboarding.html이 저장 버튼으로 남기는 습득도 기록.
--   한 사람·한 날짜에 한 건 (같은 날 다시 저장하면 덮어씀). 접근은 Edge Function cs-onboarding(초대코드)로만.
create table if not exists cs_onboarding_checks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                 -- 신입 이름
  checked_on date not null,                 -- 체크한 날짜
  day        int  not null default 1,       -- 몇 일차
  st         jsonb not null default '{}',   -- {항목id: 0|1|2}  0 아직 / 1 도움 받아 / 2 혼자
  quiz       jsonb not null default '{}',   -- {질문id: true}
  memo       text not null default '',
  solo       int  not null default 0,       -- 혼자 할 수 있는 업무 수 (목록용)
  updated_at timestamptz not null default now(),
  unique (name, checked_on)
);
revoke all on cs_onboarding_checks from anon, authenticated;
grant select, insert, update, delete on cs_onboarding_checks to service_role;
