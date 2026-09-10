-- 상품별 광고 문구 고정 (2026-09-10): 한 번 생성/기입한 문구는 그 상품에 저장돼 다음 소재 등록 때 바로 재사용
create table if not exists product_copy (
  product_no   int primary key,
  product_name text,
  text         jsonb not null,            -- { message, title, description, cta }
  source       text not null default 'ai' check (source in ('ai','manual')),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
grant select, insert, update, delete on product_copy to service_role;
revoke all on product_copy from anon, authenticated;
