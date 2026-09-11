#!/bin/zsh
# 광고 업로드 탭의 등록 대기 소재 중 문구 없는 상품만 — 이 맥의 Claude Code(구독)로 문구 생성 → 상품에 고정 + 소재에 채움
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "다시 만들 상품번호가 있으면 입력 (여러 개는 띄어쓰기) · 그냥 엔터 = 문구 없는 대기 소재만:"; read -r NOS
node scripts/gen-copy.mjs ${=NOS}
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
