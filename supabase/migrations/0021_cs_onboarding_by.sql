-- CS 온보딩 체크리스트 (2026-09-30 2차): 누가 체크했는지 구분 — 운영진(manager) / 직원 본인(staff).
--   같은 이름·날짜라도 운영진 기록과 본인 기록은 따로 남는다.
alter table cs_onboarding_checks add column if not exists "by" text not null default 'manager';
alter table cs_onboarding_checks drop constraint if exists cs_onboarding_checks_name_checked_on_key;
alter table cs_onboarding_checks drop constraint if exists cs_onboarding_checks_name_checked_on_by_key;
alter table cs_onboarding_checks add constraint cs_onboarding_checks_name_checked_on_by_key unique (name, checked_on, "by");
