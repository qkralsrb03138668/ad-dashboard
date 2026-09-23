-- CS 주문조회 비공개 자산 (2026-09-23): 셀메이트 화면 위에 띄우는 북마크용 스크립트 본문.
--   공개 저장소에 올리지 않기로 해서 DB에 두고 cs-lookup 함수가 ?action=overlay&code=<초대코드> 로 내려준다.
--   쓰기는 deploy-cs-lookup.sh(관리자 CLI)만. anon/authenticated 접근 없음.
create table if not exists cs_assets (
  key        text primary key,      -- 'overlay'
  body       text not null,
  updated_at timestamptz not null default now()
);
revoke all on cs_assets from anon, authenticated;
grant select, insert, update on cs_assets to service_role;
