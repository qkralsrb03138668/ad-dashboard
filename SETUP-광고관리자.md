# 광고관리자 (Meta) 연동 준비 — 직접 해야 하는 것들

> [danarobe/dnrb-dashboard](https://github.com/danarobe/dnrb-dashboard)의
> [광고관리자 이식 가이드](https://github.com/danarobe/dnrb-dashboard/blob/main/docs/광고관리자-이식-가이드.md)를 따라
> **1단계(읽기 전용 계층 뷰)** 가 이 프로젝트에 이식돼 있다.
> 코드는 전부 준비됐고, 아래 절차(계정·토큰 만들기)만 하면 실데이터가 나온다.
>
> ⚠ **친구의 토큰·Supabase 키는 절대 같이 쓸 수 없다** (가이드에도 명시). 반드시 내 광고계정으로 새로 만든다.

## 1. Supabase 프로젝트 (무료, ~10분)

1. [supabase.com](https://supabase.com) 가입 → **New project** (리전: Seoul 권장, Security의 'Automatically expose new tables'는 **끄기** 권장)
2. **SQL Editor** → `supabase/migrations/0001_init.sql` 내용 붙여넣고 Run → 이어서 **`0002_grants.sql`도 Run**
   (서버 역할 권한 부여 — 이걸 빼먹으면 판정 저장이 "permission denied"로 실패하고 캐시가 조용히 안 돈다)
3. **Settings → API**에서 두 값을 복사해 둔다: `Project URL`, `anon public key`

## 2. Meta 시스템 사용자 토큰 (~20분)

> 개인 계정 토큰은 잠금·만료 문제로 비권장 — 시스템 사용자 무기한 토큰을 쓴다 (가이드 §3).

1. [business.facebook.com](https://business.facebook.com) → 비즈니스 설정 → 사용자 → **시스템 사용자** → 추가
2. 만든 시스템 사용자에 **자산 할당** → 광고 계정 선택 → **광고 성과 보기(읽기)** 권한
3. **토큰 생성** → 앱 선택 → 권한에서 **ads_read** 체크 → 만료 '없음' → 생성된 토큰 복사 (한 번만 보여주니 안전한 곳에 보관)
4. 광고계정 ID 확인: 광고관리자 URL의 `act=숫자` 또는 비즈니스 설정 → 광고 계정 (**숫자만**, `act_` 제외)

## 3. Edge Function 배포 (터미널, ~10분)

```bash
brew install supabase/tap/supabase   # 최초 1회
supabase login
cd ad-creative-dashboard
supabase link --project-ref <프로젝트-ref>   # ref는 Project URL의 xxxx.supabase.co 앞부분

# 시크릿 등록 (2번에서 만든 값)
supabase secrets set META_ACCESS_TOKEN=<시스템사용자토큰>
supabase secrets set META_AD_ACCOUNT_ID=<광고계정숫자>
supabase secrets set DASH_KEY=<아무-긴-문자열>   # 대시보드 접근 암호 (선택이지만 강력 권장)

supabase functions deploy meta-ads
```

## 4. config.js 채우기

```js
window.DASH_CFG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
  DASH_KEY: "<3번에서 정한 값>",
};
```

⚠ **공개 GitHub 저장소에 올린다면 config.js는 커밋하지 말 것** (.gitignore에 추가).
값이 노출되면 누구나 내 광고 데이터를 볼 수 있다. 폰에서도 쓰려면 저장소를 private으로 만들고
GitHub Pages 대신 로컬 파일로 열거나, config.js만 따로 넣은 사본을 쓰면 된다.

## 5. 확인

대시보드 → **광고관리자** 메뉴 → **Meta 불러오기**. 캠페인/광고세트/광고 3탭이 나오면 성공.
- 반복 새로고침해도 Meta 호출은 60초에 1번만 나간다 (서버 캐시 — 호출 한도 방어선, 지우지 말 것)
- 광고 탭에서 행 클릭 = 소재 미리보기 + 기간 7종 성과

## 광고관리자 탭 구성 (2026-09-02 기준 — 이식 1~3단계 완료)

| 탭 | 내용 | 서버 액션 |
|---|---|---|
| 캠페인 / 광고세트 / 광고 | 계층 드릴다운, 체크 선택 연동, 다중 정렬, CPC 열·합계 행, **최근 변경 열**(오늘 칩 + 캠페인/세트 탭: Meta 활동 로그의 예산 변경 ↑↓ 배지, 클릭 → 오늘/최근 7일 히스토리 모달) + 오늘 예산 변경/증액/감액 필터 칩, 행 클릭 미리보기(피드/릴스/스토리 형식 전환 + 기간 7종 지출·ROAS 차트) | `hierarchy`·`budgethistory`·`preview`·`adstats` |
| 테스트 소재 | **세트명에 `test`가 든 세트의 소재 자동 수집**, 판정([애매]/[우수], OFF·검토중은 Meta 상태로 자동), 추가소재 요청/제작완료 체크, 메모, 목록에서 제거/복원, 테스트 종료(세트명에서 test 제거 후 60일 보관), 엑셀 추출 | `testads`·`state_list`·`state_save` |
| 기존광고 중 OFF | 기간 내 OFF로 바뀐 광고세트(테스트 세트 제외) + 등록 이후 누적 성과. 세트를 직접 끈 것 기준(캠페인 통째 OFF는 안 잡힘) | `offsets` |
| 베스트소재 | 광고세트 탭에서 세트 체크 → '베스트소재로' → 소재 썸네일 격자, 타일 클릭 미리보기 | `creatives`·`best_list`·`best_add`·`best_del` |

운영 규칙 (안 지키면 기능이 빈다): **테스트 소재는 광고세트명에 `test`를 넣어야 자동으로 잡힌다.** 테스트 끝 = 세트명에서 test 제거.

## 다음 단계 (원하면)

- **4단계** 예산 변경 — ⚠ **실돈이 움직이는 기능.** 원본은 서버 5중 안전장치(관리자+허용 id+PIN+일예산 상한+전 기록)를
  달았고, 가이드도 그대로 가져가라고 강력 권장. 별도 쓰기 토큰(ads_management)도 필요. 붙이고 싶어지면 그때 같이 하자.
