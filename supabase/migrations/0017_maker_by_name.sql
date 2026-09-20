update creatives set maker = case when normalize(file_name, NFC) like '%다나%' then 'dana' else 'dohee' end where maker is null;
-- 만든 사람 빈 값 채우기 (2026-09-20 사용자 규칙): 이름에 '다나'가 들어가면 다나대표, 나머지는 전부 김도희.
--   화면(admgrMakerOf)도 같은 규칙을 마지막 순서로 쓴다 — 대시보드 밖에서 올려 등록 기록이 없는 세트용.
