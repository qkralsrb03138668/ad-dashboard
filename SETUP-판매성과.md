# 판매 성과 (카페24) 연동 준비 — 직접 해야 하는 것들

> 친구(danarobe)의 [판매 성과 이식 패키지](https://github.com/danarobe/dnrb-dashboard/tree/main/docs/이식/판매성과)를
> 이 대시보드에 이식했다. 코드·테이블·함수는 준비됐고(2026-09-04 배포 완료), **카페24 앱 등록과 인증 1회**만 하면 실데이터가 나온다.
>
> 원리: 브라우저 → Supabase 함수 `cafe24-perf`(DASH_KEY 인증, 10분 캐시) → 카페24 API. 카페24 키는 서버에만 있다.
> 계산 정의·카페24 함정 목록은 패키지 README §1·§5 참고 (코드 주석에도 있음 — 지우지 말 것).

## 1. 카페24 개발자센터에 앱 만들기 (~10분)

1. [developers.cafe24.com](https://developers.cafe24.com) → 로그인(몰 관리자 계정) → **앱 만들기** (비공개 앱, 이름은 아무거나 예: `판매성과 대시보드`)
2. **권한(Scope)** 4개 체크: `mall.read_order`(주문), `mall.read_analytics`(애널리틱스), `mall.read_product`(상품), `mall.read_category`(분류)
3. **Redirect URI**에 정확히 이 주소 등록:
   ```
   https://pydxcqfztjogmztvayux.supabase.co/functions/v1/cafe24-oauth
   ```
4. 앱 상세에서 **클라이언트 ID · 클라이언트 시크릿** 복사 (시크릿은 한 번만 보여줌)
5. **몰 아이디** = 관리자 주소 `https://<몰아이디>.cafe24.com`의 앞부분
6. 애널리틱스 API는 몰에서 **카페24 애널리틱스 서비스 사용 중**이어야 한다. `/products/sales`가 403이면 애널리틱스 이용 신청부터.

## 2. 서버에 등록 + 배포 (터미널, ~3분)

```bash
cd ~/Desktop/클ㄹ드/ad-creative-dashboard
./deploy-cafe24-perf.sh <몰아이디> <클라이언트ID> <클라이언트시크릿>
```

이 스크립트가 하는 일: 테이블 2개(`api_tokens`·`perf_archive`) 생성 → 시크릿 3개 등록 → 함수 2개(`cafe24-oauth`·`cafe24-perf`) 배포.
(테이블·함수는 이미 한 번 배포돼 있어서, 시크릿만 등록하려면 `supabase secrets set ...` 줄만 따로 실행해도 된다.)

## 3. 카페24 인증 1회 (브라우저)

```
https://pydxcqfztjogmztvayux.supabase.co/functions/v1/cafe24-oauth?action=start
```

를 열면 카페24 로그인·동의 화면 → 동의하면 "✅ 카페24 연동 완료!" 문구. 확인은

```
https://pydxcqfztjogmztvayux.supabase.co/functions/v1/cafe24-oauth?action=status
```

가 `{"connected":true,...}`이면 끝.

- 토큰은 서버가 자동 갱신한다. 단 **2주 동안 한 번도 조회하지 않으면** refresh 토큰이 만료돼 위 `?action=start`를 다시 열어야 한다.

## 4. 확인

대시보드 → **판매 성과** 메뉴 → 기간 선택 → **카페24 불러오기**.
- 한 달치 첫 조회는 **수십 초** 걸리는 게 정상(주문 전체 스캔). 같은 기간 두 번째부터는 즉시(서버 10분 캐시).
- 상품명 클릭 → 반품 사유 TOP5. '오늘' 조회 시 어제 대비 순위 등락. 결과 저장 → 기간별 비교. 월별 추이는 [추이 불러오기](처음 1~2분).
- 기준이 맞는지 한 번은 대조: 카페24 관리자 "전체주문조회 → 배송완료일 검색"의 수량과 화면 요약의 "배송완료 N개"가 같은 기간에 맞으면 OK.

## 5. 배포판(GitHub Pages)에서는

config.js가 공개 레포에 없으므로 배포판 판매 성과 메뉴는 "config.js를 채우면…" 안내만 뜬다 (광고관리자와 동일). 실데이터는 로컬 파일로 연다.
매출 금액이 나가는 메뉴이므로 **DASH_KEY 없이 운영하지 말 것** (이미 설정돼 있음).

## 문제 생기면

| 증상 | 원인 · 조치 |
|---|---|
| "카페24 미연동: 먼저 cafe24-oauth?action=start" | §3 인증을 아직 안 했거나 2주 만료 → 다시 인증 |
| 인증 화면에서 redirect_uri 오류 | §1-3 주소가 글자 하나까지 같은지 확인 |
| 403 on /products/sales | 애널리틱스 권한 미체크 또는 애널리틱스 서비스 미사용 |
| 429 Too much requests | 다른 메뉴·다른 탭에서 동시에 조회 중 — 잠시 후 재시도(서버가 자동 대기·재시도함) |
| 저장 실패 permission denied | `0002_grants.sql`이 적용된 프로젝트라 정상이면 안 남. 나면 그 파일을 SQL Editor에서 다시 실행 |
