// CS 답변 문구 점검 — `node test/cs-reply.test.mjs` (cs-reply.js: CS 주문조회·카카오/네이버 패널 공용)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const CSR = createRequire(import.meta.url)('../cs-reply.js');

const it = (name, status, extra = {}) => ({ product_no: 1, product_name: name, option: '', status, status_text: '', carrier: '우체국택배', tracking: '', ...extra });
const order = { order_id: '20261001-0000001', order_date: '2026-10-01 10:00:00', items: [
  it('골지 팬츠', 'N30', { tracking: '123' }), it('(자체제작) 에센셜 원피스 (2 colors)', 'N20', { product_no: 2, option: '컬러=블랙' }) ] };
const delays = { articles: [{ title: '출고일 안내', product_no: null, text: '에센셜 원피스 | 블랙 | 10/6 출고' }] };

// 하나만: 단락 하나, 게시판 날짜 + 사과
const one = CSR.summary(order, delays, null, [1]).reply;
assert.match(one, /10\/6 출고 예정/);
assert.match(one, /늦어져 정말 죄송합니다/);
assert.doesNotMatch(one, /· /);

// 여러 개: 한 줄씩 + 안내 문장 한 번씩, 인사 한 번
const all = CSR.summary(order, delays, null).reply;
assert.match(all, /· 골지 팬츠 → 우체국택배 발송 완료 \(송장 123\)/);
assert.match(all, /· 에센셜 원피스 \(블랙\) → 10\/6 출고 예정/);
assert.equal(all.match(/안녕하세요/g).length, 1);
assert.equal(all.match(/1~2일/g).length, 1);

// 셀메이트: 출고가능이면 게시판보다 우선 → 준비 중 문장
const sm = [{ order_id: order.order_id, name: '(자체제작) 에센셜 원피스 (2 colors)', opt: '컬러=블랙', possible: 1 }];
assert.match(CSR.summary(order, delays, sm, [1]).reply, /출고 준비 중/);
console.log('cs-reply: 통과');
