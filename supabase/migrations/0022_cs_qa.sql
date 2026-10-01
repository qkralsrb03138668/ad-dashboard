-- CS 상담 데이터 (2026-10-01): 카카오·네이버 상담의 "고객 질문 → 직원 답변" 쌍. 답변 패널의 '비슷한 과거 상담' 검색용.
--   전화번호·주소·계좌는 모으는 쪽(cs-tracker.user.js)에서 가린 뒤 저장. 보관 1년 (cs-lookup 함수 qa-add가 오래된 줄 삭제).
--   쓰기·읽기는 cs-lookup 함수(service_role)만. anon/authenticated 접근 없음.
create table if not exists cs_qa (
  id         bigserial primary key,
  src        text not null check (src in ('kakao','naver')),
  ref        text not null,          -- 카카오 채팅방 id / 네이버 문의번호
  asked_at   timestamptz not null,   -- 그 질문 묶음의 첫 고객 메시지 시각
  q          text not null,          -- 고객 질문 (가림 처리 후)
  a          text not null,          -- 직원 답변 (가림 처리 후)
  fav        text,                   -- 답변이 자주 쓰는 답변과 거의 같으면 그 이름
  created_at timestamptz not null default now(),
  unique (src, ref, asked_at)
);
create index if not exists cs_qa_asked on cs_qa (asked_at desc);
revoke all on cs_qa from anon, authenticated;
grant select, insert, update, delete on cs_qa to service_role;
grant usage, select on sequence cs_qa_id_seq to service_role;
