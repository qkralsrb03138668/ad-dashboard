// 상세 이미지 속 글자 읽기 (맥 내장 Vision — 설치·구독 사용량 없음, 2026-11-26)
//   사용: ocr <이미지경로> [<이미지경로> …]   → 표준출력에 이미지마다 읽은 줄 (위→아래 순서)
//   다나로브 상세는 가로 1200 × 세로 1만 px 넘는 긴 이미지라, 통째로 넣으면 Vision이 줄여서 작은 글을 놓친다 → 세로 2,000px씩 겹쳐 잘라 읽는다
import Foundation
import ImageIO
import Vision

let TILE = 2000, OVERLAP = 120
var seen = Set<String>()   // 겹친 구간에서 같은 줄이 두 번 나오지 않게

func readTile(_ img: CGImage) -> [String] {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ko-KR", "en-US"]
  req.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  let obs = (req.results ?? []).sorted { $0.boundingBox.minY > $1.boundingBox.minY }   // Vision 좌표는 아래가 0 → 위에서부터
  return obs.compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
}

for path in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }   // 움직이는 gif는 첫 장만
  var lines: [String] = []
  var y = 0
  while y < img.height {
    let h = min(TILE, img.height - y)
    if let tile = img.cropping(to: CGRect(x: 0, y: y, width: img.width, height: h)) {
      for l in readTile(tile) where !seen.contains(l) { seen.insert(l); lines.append(l) }
    }
    if y + h >= img.height { break }
    y += TILE - OVERLAP
  }
  if !lines.isEmpty { print(lines.joined(separator: "\n")) }
}
