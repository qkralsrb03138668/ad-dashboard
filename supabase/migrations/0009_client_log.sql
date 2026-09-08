-- 3단계 운영 (2026-09-08): 브라우저 오류 수집 + 브라우저 데이터(localStorage) 서버 자동 백업
--   client_errors : 화면에서 난 오류(전역 핸들러·실패 알림)를 누가·언제·어디서 겪었는지 기록. 최근 5,000건만 유지(함수가 정리).
--   client_backups: 로그인 사용자별 하루 1회 localStorage 스냅샷(소재·기록·체크보드·임시저장). 최근 30일만 유지.
create table if not exists client_errors (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_email text,
  url        text,
  message    text not null,
  stack      text,
  ua         text
);
create index if not exists client_errors_created_idx on client_errors (created_at desc);

create table if not exists client_backups (
  user_key   text not null,          -- 로그인 이메일 (접근키 사용자는 'dash-key')
  day        date not null,
  payload    jsonb not null,
  bytes      int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_key, day)
);
-- 0002_grants와 같은 규칙: 서버(service_role)만, 브라우저 키는 접근 불가
grant select, insert, update, delete on client_errors, client_backups to service_role;
grant usage, select on sequence client_errors_id_seq to service_role;
revoke all on client_errors, client_backups from anon, authenticated;
