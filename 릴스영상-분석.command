#!/bin/zsh
# 리포트에 뜬 릴스 광고 영상을 프레임으로 뽑아 분석 → 훅·장면 구성·자막·컷 전환 태그 저장 (이 맥의 Claude Code 구독, 결제 없음)
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "분석할 영상 개수 (그냥 엔터 = 20개):"; read -r N
node scripts/video-tags.mjs ${N:-20}
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
