#!/bin/zsh
# 소재 등록용 PIN(UPLOAD_PIN) 설정 — 마케터가 파일을 Meta 보관함에 올릴 때 쓰는 PIN. 광고 생성 PIN(WRITE_PIN)과 별개.
#   더블클릭 → PIN 입력(화면에 안 보임) → Supabase secret 등록 → meta-upload 재배포
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
echo -n "등록용 PIN (숫자 4~8자리): "; read -s PIN; echo
if ! [[ "$PIN" =~ ^[0-9]{4,8}$ ]]; then echo "❌ 숫자 4~8자리여야 합니다"; read -k1; exit 1; fi
$SB secrets set UPLOAD_PIN="$PIN" --project-ref $REF
$SB functions deploy meta-upload --project-ref $REF
echo "✅ 완료 — 마케터에게 이 PIN을 전달하세요 (광고 생성 PIN은 알려주지 마세요)."
read -k1
