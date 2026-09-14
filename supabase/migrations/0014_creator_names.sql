-- 등록자 이름 (2026-09-14): 워크스페이스(SSO) 계정은 이메일 대신 아이디(dnrb:…)라 화면에 아이디가 보였음 → 이름을 같이 저장. 옛 행은 비어 있어 화면에서 이메일로 대체
alter table creatives add column if not exists created_by_name text;
alter table creatives add column if not exists ad_created_by_name text;
alter table product_copy add column if not exists updated_by_name text;
