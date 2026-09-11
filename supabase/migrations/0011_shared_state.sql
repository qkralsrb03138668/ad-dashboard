-- 계정 공유 상태 (2026-09-11): 체크보드(key='pt')처럼 관리자·마케터 모든 계정이 같은 값을 봐야 하는 작은 JSON.
--   접근은 서버 함수 client-log의 state_get / state_set 로만. ver = 서버가 만든 저장 버전 문자열 — 저장 전 비교해 다른 사람이 먼저 바꿨으면 거부(덮어쓰기 방지).
create table if not exists shared_state (
  key        text primary key,
  data       jsonb not null,
  ver        text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on shared_state to service_role;
revoke all on shared_state from anon, authenticated;
