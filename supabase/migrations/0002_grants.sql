-- 서버(service_role) 권한 부여 — 0001_init.sql 다음에 실행
--
-- 왜 필요한가: 프로젝트 생성 시 Security 옵션 'Automatically expose new tables'를 끄면(권장 설정)
-- 새 테이블에 Data API 역할 권한이 자동으로 붙지 않는다. 그 상태에서는 Edge Function(service_role)이
-- api_cache·ad_test_state·best_ads·test_ad_snap에 쓰려 할 때 "permission denied (42501)"가 난다.
-- (실사례 2026-09-02: 판정 저장 500, 캐시·스냅샷은 try/catch에 가려 조용히 실패)
--
-- anon에는 아무 권한도 주지 않는다 — 접근은 오직 서버(DASH_KEY 인증 뒤 service_role)로만.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
-- 앞으로 만드는 테이블도 같은 규칙으로
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

-- 브라우저 키(anon)·로그인 사용자(authenticated)는 테이블 직접 접근 불가 — RLS(정책 없음)에 더해 권한 자체도 회수 (이중 잠금)
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
