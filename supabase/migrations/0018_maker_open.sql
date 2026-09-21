alter table creatives drop constraint if exists creatives_maker_check;
-- 만든 사람이 두 명 고정에서 목록 관리로 바뀜 (2026-09-21): 컨텐츠마케터가 더 늘 예정이라 허용값 check를 없앤다.
--   목록은 shared_state 'maker_list' { items: [{ key, name, off? }] } — 데이터 관리 › 컨텐츠마케터 목록에서 관리. 서버는 키 형식만 검사.
