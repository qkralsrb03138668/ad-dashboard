# 광고소재 대시보드

광고소재(크리에이티브)별 성과를 모아 보는 단일 페이지 대시보드.
[DNRB 성과 분석 대시보드](https://danarobe.github.io/dnrb-dashboard/)의 디자인·구조를 기반으로 만들었다.

- 정적 파일만 (`index.html` + `js/` + `css/`) — 빌드 없음, 브라우저로 열면 동작 (Chart.js·FontAwesome은 CDN)
- 데이터는 브라우저(localStorage)에 저장, JSON 백업/복원 지원

## 기능

| 메뉴 | 내용 |
|---|---|
| 대시보드 | 기간별 KPI 6타일(지출·노출·클릭·구매·전환값·ROAS) + 일별 지출·ROAS 차트 + 지출 TOP 소재 |
| 광고소재 대시보드 | 상품 × 소재유형(스토리·썸네일릴스·릴스 …) 체크보드 — 칸 클릭으로 제작완료→진행중 기록, 진행률 요약, 유형 열 추가 가능 |
| 소재 목록 | 인스타식 정사각 격자 / 표 보기, 채널·상태 필터, 검색, 열 정렬, 썸네일 |
| 소재 비교 | 소재 2~6개 선택 → 지표별 일별 추이 차트 + 합계 비교표 |
| 테스트 소재 | 판정 워크플로(평가중 → 우수/애매/OFF), 우수 소재 추가소재 요청·제작완료 체크 |
| 데이터 관리 | Meta 광고관리자 CSV 업로드, 성과 직접 입력, 기록 관리, JSON 백업/복원, 샘플 데이터 |
| 광고관리자 (Meta) | **API 실시간 연동** (dnrb-dashboard 이식 1단계) — 캠페인/광고세트/광고 3계층 탭, 선택 드릴다운, 소재 미리보기 + 기간 7종 성과. 연동 전엔 데모 모드. **셋업: [SETUP-광고관리자.md](SETUP-광고관리자.md)** |
| 로그인 · 소재 등록 | **Supabase Auth 계정 + 역할(관리자/마케터)**. 마케터가 파일 드롭 → 파일명으로 카페24 상품 자동 매칭(중복 상품은 선택, 선택 기억) → URL 자동 → 문구 → Meta 보관함 업로드 + 서버 기록 → 체크보드 스토리/릴스 자동, 광고 업로드 탭에 자동 채움. **셋업: [SETUP-로그인-소재등록.md](SETUP-로그인-소재등록.md)** |
| 광고 업로드 (Meta) | **Ads Uploader 대체 v1** — 모델 광고 1개 선택(세트 설정·페이지·강화옵션 복사) → 파일 N개 → 파일당 새 광고세트(예산만 입력)+광고 1개, 문구 직접 기입(일괄/행별), 일시중지·바로 활성 선택, 연결 진단(validate_only). 영상은 4MB 조각 재개 업로드. **셋업: [SETUP-광고업로드.md](SETUP-광고업로드.md)** |
| 판매 성과 (카페24) | **카페24 API 실시간** (dnrb-dashboard 판매 성과 이식) — 기간별 상품 판매 표(결제·환불·순판매·판매합계·공급가·마진율), 순반품률(배송완료일 기준) 우수/주의/위험 판정·옵션별, 상품명 클릭 → 반품 사유 TOP5, 오늘 조회 시 어제 대비 순위 등락, 결과 저장 → 기간별 비교, 직전 3개월 월별 추이. **셋업: [SETUP-판매성과.md](SETUP-판매성과.md)** |

## 출장촬영 보드 (`shoot-board.html`)

MD·포토·모델이 현장에서 폰으로 같이 보는 촬영 계획판. 대시보드 사이드바 **현장 > 출장촬영 보드**, 또는
`https://qkralsrb03138668.github.io/ad-dashboard/shoot-board.html` 로 바로 연다 (Claude·GitHub 계정 불필요).

- 처음 한 번 **이름 + 초대코드** 입력 → 이 폰에 기억. 링크와 초대코드를 같이 쓸 사람에게 보내면 끝.
- 탭: **오버뷰**(오늘 코디·릴스 체크) / **코디**(일차·모델별 사진, ＋로 폰 카메라 업로드) / **릴스**(레퍼런스 링크·참고 컷·메모·연결 코디) / **제품컷**(일정·착 수) / **더보기**(출장 만들기·복제, 내보내기, 오프라인 상태)
- **오프라인**: 인터넷 있을 때 한 번 열면 데이터·사진이 폰에 저장(서비스워커). 끊겨도 보고 체크 가능, 재연결 시 자동 전송. 홈 화면에 추가하면 앱처럼 열린다.
- 데이터: Supabase `shoot_trips`·`shoot_items` + 사진 버킷 `shoot-photos`. 접근은 Edge Function `shoot-board`(초대코드 검증)로만 — 광고 데이터와 분리.
- 서버 배포/초대코드 변경: `./deploy-shoot-board.sh <초대코드>` (최초 1회 `~/.local/bin/supabase login`)

## 구조

```
index.html                        대시보드 화면(HTML)만 — 스크립트는 js/, 스타일은 css/ (2026-09-08 분리)
css/style.css                     대시보드 스타일
js/core.js                        공통: 유틸·저장소(localStorage)·기간·집계·메뉴·차트·토스트(오류 알림)·초기화
js/auth.js                        로그인·사용자 관리
js/home.js                        대시보드 탭
js/creatives.js                   소재 목록·비교·테스트 소재·소재 등록/수정·상세
js/checkboard.js                  광고소재 대시보드(체크보드)
js/register.js                    소재 등록 (파일 → 카페24 상품 매칭 → Meta 보관함)
js/upload.js                      광고 업로드 (Meta)
js/admgr.js                       광고관리자: 상태·정렬·계층 3탭·오늘의 판정
js/admgr-budget.js                광고관리자: 예산 변경·23:55 예약/원복·PIN·열 표시/너비·최근 변경
js/admgr-tabs.js                  광고관리자: 테스트 소재·OFF·베스트소재 탭·미리보기·데모
js/data.js                        데이터 관리: 성과 기록·Meta CSV·JSON 백업/복원·샘플
js/perf.js                        판매 성과 (카페24)
test/run.mjs                      자동 검사 — `node test/run.mjs` (CSV 업로드·소재 매칭·판매 성과 계산). 기능을 고친 뒤 꼭 한 번 돌릴 것
shoot-board.html                 출장촬영 보드 (+ shoot-sw.js 오프라인, shoot-board.webmanifest, shoot-icon-*.png)
deploy-shoot-board.sh            촬영 보드 서버 배포 스크립트
deploy-cafe24-perf.sh            판매 성과(카페24) 서버 배포 스크립트
config.js                        Meta 연동 설정 ← 직접 입력 (공개 레포엔 커밋 금지)
supabase/
  migrations/0001_init.sql       DB 스키마 (캐시 + 2~4단계용 테이블)
  migrations/0004_shoot_board.sql 촬영 보드 테이블 + 사진 버킷
  functions/shoot-board/index.ts 촬영 보드 API (초대코드 인증)
  functions/meta-ads/index.ts    Meta API 프록시 (hierarchy·adstats·preview, 60초 캐시)
  functions/cafe24-oauth/index.ts 카페24 OAuth 최초 인증·토큰 저장
  functions/cafe24-perf/index.ts  카페24 판매 성과 (performance·netreturns·returnreasons + 저장 기록 archive_*, 10분 캐시)
  migrations/0006_cafe24_perf.sql 카페24 토큰·판매 성과 저장 테이블
  functions/_shared/util.ts      CORS·캐시·DASH_KEY 인증
```

## 쓰는 법

1. `index.html`을 브라우저로 열면 끝. (더블클릭으로도 열리지만, 배포해 두면 폰에서도 접속 가능)
2. 처음엔 **샘플 데이터 넣어보기**로 화면을 구경해 보고, **전체 초기화** 후 실제 데이터를 넣으면 된다.
3. Meta 성과 넣기: 광고관리자 → 보고서 → 내보내기(CSV, **일별 분할** 권장) → 데이터 관리에서 업로드.
   - `광고 이름 / 일(날짜) / 지출 금액 / 노출 / 링크 클릭 / 구매 / 구매 전환값` 열을 자동 인식 (영문 헤더도 지원)
   - 같은 소재·같은 날짜는 덮어써서 중복 없이 다시 올릴 수 있다.
4. 소재 등록 시 광고명 앞에 등록일 `YYMMDD`를 붙이는 관례(예: `260901 클레르 블라우스 영상A`)를 추천 —
   CSV로 자동 생성된 소재와 이름이 정확히 일치해야 성과가 연결된다.

## GitHub Pages로 배포하기

```bash
cd ad-creative-dashboard
git init && git add . && git commit -m "광고소재 대시보드"
# github.com에서 새 공개 저장소(예: ad-dashboard)를 만든 뒤:
git remote add origin https://github.com/<내계정>/ad-dashboard.git
git push -u origin main
```

저장소 → Settings → Pages → Branch를 `main`으로 지정하면
`https://<내계정>.github.io/ad-dashboard/`로 접속할 수 있다 (반영 30~60초).

## 주의

- localStorage는 **브라우저·기기별로 따로** 저장된다. 폰↔컴퓨터 공유가 필요하면 JSON 백업을 옮기거나,
  다음 단계로 Supabase 연동(DNRB 대시보드 방식)을 붙이면 된다.
- 브라우저 데이터를 지우면 함께 사라지니 **JSON 백업을 주기적으로** 내려받아 둘 것.
