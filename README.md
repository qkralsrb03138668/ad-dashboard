# 광고소재 대시보드

광고소재(크리에이티브)별 성과를 모아 보는 단일 페이지 대시보드.
[DNRB 성과 분석 대시보드](https://danarobe.github.io/dnrb-dashboard/)의 디자인·구조를 기반으로 만들었다.

- `index.html` 파일 하나가 전부 — 서버·DB 없이 동작 (Chart.js·FontAwesome은 CDN)
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

## 구조

```
index.html                        대시보드 전체 (정적 파일)
config.js                        Meta 연동 설정 ← 직접 입력 (공개 레포엔 커밋 금지)
supabase/
  migrations/0001_init.sql       DB 스키마 (캐시 + 2~4단계용 테이블)
  functions/meta-ads/index.ts    Meta API 프록시 (hierarchy·adstats·preview, 60초 캐시)
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
