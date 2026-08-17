import ExpoModulesCore
import UIKit
import CryptoKit

public class LioraOpticalNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LioraOpticalNative")

    AsyncFunction("analyzeImage") { (
      uri: String,
      brightnessThreshold: Int,
      maxSaturation: Double,
      minClusterPixels: Int,
      maxClusterPixels: Int,
      maxDimension: Int,
      edgeMarginPixels: Int
    ) -> [String: Any] in
      return try self.analyzeImage(
        uri: uri,
        brightnessThreshold: min(255, max(0, brightnessThreshold)),
        maxSaturation: min(1.0, max(0.0, maxSaturation)),
        minClusterPixels: max(1, minClusterPixels),
        maxClusterPixels: max(minClusterPixels, maxClusterPixels),
        maxDimension: max(64, maxDimension),
        edgeMarginPixels: max(0, edgeMarginPixels)
      )
    }
  }

  private func analyzeImage(
    uri: String,
    brightnessThreshold: Int,
    maxSaturation: Double,
    minClusterPixels: Int,
    maxClusterPixels: Int,
    maxDimension: Int,
    edgeMarginPixels: Int
  ) throws -> [String: Any] {
    guard let url = URL(string: uri), url.isFileURL else {
      throw OpticalNativeError.invalidLocalUri
    }

    let data = try Data(contentsOf: url, options: [.mappedIfSafe])
    guard !data.isEmpty else { throw OpticalNativeError.emptyFile }
    guard let sourceImage = UIImage(data: data) else { throw OpticalNativeError.decodeFailed }

    let sourceWidth = Int(sourceImage.size.width * sourceImage.scale)
    let sourceHeight = Int(sourceImage.size.height * sourceImage.scale)
    guard sourceWidth > 0, sourceHeight > 0 else { throw OpticalNativeError.decodeFailed }

    let targetSize = scaledSize(width: sourceWidth, height: sourceHeight, maxDimension: maxDimension)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(
      size: CGSize(width: targetSize.width, height: targetSize.height),
      format: format
    )
    let rendered = renderer.image { _ in
      sourceImage.draw(in: CGRect(x: 0, y: 0, width: targetSize.width, height: targetSize.height))
    }
    guard let cgImage = rendered.cgImage else { throw OpticalNativeError.decodeFailed }

    let width = cgImage.width
    let height = cgImage.height
    guard width > 2, height > 2 else { throw OpticalNativeError.imageTooSmall }

    var rgba = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
      data: &rgba,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    ) else {
      throw OpticalNativeError.decodeFailed
    }
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    let pixelCount = width * height
    var luminance = [Double](repeating: 0, count: pixelCount)
    var saturations = [Double](repeating: 0, count: pixelCount)
    var candidates = [Bool](repeating: false, count: pixelCount)
    var brightnessSum = 0.0
    var overexposedCount = 0

    for index in 0..<pixelCount {
      let offset = index * 4
      let r = Double(rgba[offset])
      let g = Double(rgba[offset + 1])
      let b = Double(rgba[offset + 2])
      let luma = 0.299 * r + 0.587 * g + 0.114 * b
      let maxChannel = max(r, max(g, b))
      let minChannel = min(r, min(g, b))
      let saturation = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel

      luminance[index] = luma
      saturations[index] = saturation
      brightnessSum += luma
      if luma >= 250 { overexposedCount += 1 }
    }

    let safeEdge = min(edgeMarginPixels, min(width, height) / 4)
    if width > safeEdge * 2, height > safeEdge * 2 {
      for y in safeEdge..<(height - safeEdge) {
        for x in safeEdge..<(width - safeEdge) {
          let index = y * width + x
          candidates[index] = luminance[index] >= Double(brightnessThreshold) && saturations[index] <= maxSaturation
        }
      }
    }

    let clusters = extractClusters(
      candidates: candidates,
      luminance: luminance,
      saturations: saturations,
      width: width,
      height: height,
      minClusterPixels: minClusterPixels,
      maxClusterPixels: maxClusterPixels
    )

    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()

    return [
      "sourceWidth": sourceWidth,
      "sourceHeight": sourceHeight,
      "analyzedWidth": width,
      "analyzedHeight": height,
      "brightnessEstimate": brightnessSum / Double(pixelCount),
      "overexposedRatio": Double(overexposedCount) / Double(pixelCount),
      "sharpnessVariance": laplacianVariance(luminance: luminance, width: width, height: height),
      "sha256": digest,
      "sizeBytes": data.count,
      "clusters": clusters,
    ]
  }

  private func scaledSize(width: Int, height: Int, maxDimension: Int) -> (width: Int, height: Int) {
    let largest = max(width, height)
    guard largest > maxDimension else { return (width, height) }
    let scale = Double(maxDimension) / Double(largest)
    return (
      max(1, Int(Double(width) * scale)),
      max(1, Int(Double(height) * scale))
    )
  }

  private func extractClusters(
    candidates: [Bool],
    luminance: [Double],
    saturations: [Double],
    width: Int,
    height: Int,
    minClusterPixels: Int,
    maxClusterPixels: Int
  ) -> [[String: Any]] {
    var visited = [Bool](repeating: false, count: candidates.count)
    var queue = [Int](repeating: 0, count: candidates.count)
    var clusters: [[String: Any]] = []

    for start in candidates.indices {
      if !candidates[start] || visited[start] { continue }

      var head = 0
      var tail = 0
      queue[tail] = start
      tail += 1
      visited[start] = true

      var count = 0
      var sumX = 0.0
      var sumY = 0.0
      var sumSaturation = 0.0
      var maxBrightness = 0.0
      var perimeter = 0

      while head < tail {
        let index = queue[head]
        head += 1
        let x = index % width
        let y = index / width
        count += 1
        sumX += Double(x)
        sumY += Double(y)
        sumSaturation += saturations[index]
        maxBrightness = max(maxBrightness, luminance[index])

        let neighbors4 = [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ]
        for neighbor in neighbors4 where neighbor < 0 || !candidates[neighbor] {
          perimeter += 1
        }

        for dy in -1...1 {
          for dx in -1...1 {
            if dx == 0 && dy == 0 { continue }
            let nx = x + dx
            let ny = y + dy
            if nx < 0 || nx >= width || ny < 0 || ny >= height { continue }
            let neighbor = ny * width + nx
            if candidates[neighbor] && !visited[neighbor] {
              visited[neighbor] = true
              queue[tail] = neighbor
              tail += 1
            }
          }
        }
      }

      if count < minClusterPixels || count > maxClusterPixels || perimeter <= 0 { continue }

      let centroidX = sumX / Double(count)
      let centroidY = sumY / Double(count)
      let compactness = min(1.0, max(0.0, 4.0 * Double.pi * Double(count) / pow(Double(perimeter), 2.0)))
      clusters.append([
        "relativeX": width > 1 ? centroidX / Double(width - 1) * 100.0 : 0.0,
        "relativeY": height > 1 ? centroidY / Double(height - 1) * 100.0 : 0.0,
        "clusterSizePx": count,
        "compactness": compactness,
        "maxBrightness": maxBrightness,
        "saturation": sumSaturation / Double(count),
      ])
    }

    return clusters
  }

  private func laplacianVariance(luminance: [Double], width: Int, height: Int) -> Double {
    guard width >= 3, height >= 3 else { return 0 }
    var count = 0
    var sum = 0.0
    var sumSquares = 0.0

    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let index = y * width + x
        let laplacian = 4.0 * luminance[index]
          - luminance[index - 1]
          - luminance[index + 1]
          - luminance[index - width]
          - luminance[index + width]
        count += 1
        sum += laplacian
        sumSquares += laplacian * laplacian
      }
    }

    guard count > 0 else { return 0 }
    let mean = sum / Double(count)
    return max(0, sumSquares / Double(count) - mean * mean)
  }
}

private enum OpticalNativeError: Error {
  case invalidLocalUri
  case emptyFile
  case decodeFailed
  case imageTooSmall
}
