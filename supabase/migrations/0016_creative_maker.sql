-- 만든 사람 (2026-09-20 사용자 요청): 소재 등록할 때 누가 만든 소재인지 고른다 (dohee=김도희 · dana=다나대표).
--   화면에는 평소 표시하지 않고, 광고관리자의 '만든 사람 ▾'로 골랐을 때만 그 사람 소재를 거른다.
--   옛 행은 올린 계정으로 첫 값을 채운다 — 올린 사람 ≠ 만든 사람인 것만 '등록된 소재' 목록에서 고치면 된다.
alter table creatives add column if not exists maker text check (maker is null or maker in ('dohee','dana'));
update creatives set maker = 'dohee' where maker is null and created_by_email = '5637ehgml';
