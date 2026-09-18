// 영상에서 지정 시각의 프레임을 JPEG로 뽑는다 (맥 내장 AVFoundation — ffmpeg·홈브루 설치 불필요, 2026-09-18)
//   사용: frames <영상경로> <저장폴더> <초,초,초…>   → 표준출력에 "duration=16.383" 그리고 뽑은 파일 경로들
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 4 else {
  FileHandle.standardError.write("usage: frames <video> <outdir> <t1,t2,...>\n".data(using: .utf8)!)
  exit(2)
}
let videoURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let times = args[3].split(separator: ",").compactMap { Double($0) }
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: videoURL)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true          // 세로 영상 회전 반영
gen.requestedTimeToleranceBefore = .zero           // 지정 시각 그대로 (훅 구간 0.5초 간격이라 정확도 필요)
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 540, height: 960)   // 모델이 보기 충분한 크기로 축소 (토큰·시간 절약)

func writeJPEG(_ image: CGImage, to url: URL) -> Bool {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.6] as CFDictionary)
  return CGImageDestinationFinalize(dest)
}

let sem = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0
Task {
  var duration = 0.0
  if let d = try? await asset.load(.duration) { duration = CMTimeGetSeconds(d) }
  print("duration=\(String(format: "%.3f", duration))")
  var wrote = 0
  for (i, t) in times.enumerated() {
    if duration > 0, t > duration - 0.05 { continue }               // 길이를 넘는 시각은 건너뜀
    let time = CMTime(seconds: t, preferredTimescale: 600)
    do {
      let (img, actual) = try await gen.image(at: time)
      let name = String(format: "f%02d_%05dms.jpg", i, Int(CMTimeGetSeconds(actual) * 1000))
      let out = outDir.appendingPathComponent(name)
      if writeJPEG(img, to: out) { print(out.path); wrote += 1 }
    } catch {
      FileHandle.standardError.write("frame \(t)s 실패: \(error.localizedDescription)\n".data(using: .utf8)!)
    }
  }
  if wrote == 0 { exitCode = 1 }
  sem.signal()
}
sem.wait()
exit(exitCode)
