package expo.modules.lioraopticalnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class LioraOpticalNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LioraOpticalNative")

    AsyncFunction("analyzeImage") {
      uri: String,
      brightnessThreshold: Int,
      maxSaturation: Double,
      minClusterPixels: Int,
      maxClusterPixels: Int,
      maxDimension: Int,
      edgeMarginPixels: Int ->
      analyzeImage(
        uri = uri,
        brightnessThreshold = brightnessThreshold.coerceIn(0, 255),
        maxSaturation = maxSaturation.coerceIn(0.0, 1.0),
        minClusterPixels = max(1, minClusterPixels),
        maxClusterPixels = max(minClusterPixels, maxClusterPixels),
        maxDimension = max(64, maxDimension),
        edgeMarginPixels = max(0, edgeMarginPixels),
      )
    }
  }

  private fun analyzeImage(
    uri: String,
    brightnessThreshold: Int,
    maxSaturation: Double,
    minClusterPixels: Int,
    maxClusterPixels: Int,
    maxDimension: Int,
    edgeMarginPixels: Int,
  ): Map<String, Any> {
    val file = resolveLocalFile(uri)
    require(file.isFile) { "OPTICAL_FILE_NOT_FOUND" }

    val fileBytes = file.readBytes()
    require(fileBytes.isNotEmpty()) { "OPTICAL_FILE_EMPTY" }

    val sha256 = MessageDigest.getInstance("SHA-256")
      .digest(fileBytes)
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(fileBytes, 0, fileBytes.size, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "OPTICAL_IMAGE_DECODE_FAILED" }

    val sampleSize = computeSampleSize(bounds.outWidth, bounds.outHeight, maxDimension)
    val decodeOptions = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = BitmapFactory.decodeByteArray(fileBytes, 0, fileBytes.size, decodeOptions)
      ?: error("OPTICAL_IMAGE_DECODE_FAILED")

    val analyzed = scaleDownIfNeeded(decoded, maxDimension)
    if (analyzed !== decoded) decoded.recycle()

    try {
      val width = analyzed.width
      val height = analyzed.height
      require(width > 2 && height > 2) { "OPTICAL_IMAGE_TOO_SMALL" }

      val pixels = IntArray(width * height)
      analyzed.getPixels(pixels, 0, width, 0, 0, width, height)

      val luminance = DoubleArray(pixels.size)
      val saturation = DoubleArray(pixels.size)
      val candidates = BooleanArray(pixels.size)
      var brightnessSum = 0.0
      var overexposedCount = 0

      for (index in pixels.indices) {
        val pixel = pixels[index]
        val r = (pixel shr 16) and 0xff
        val g = (pixel shr 8) and 0xff
        val b = pixel and 0xff
        val luma = 0.299 * r + 0.587 * g + 0.114 * b
        val maxChannel = max(r, max(g, b)).toDouble()
        val minChannel = min(r, min(g, b)).toDouble()
        val sat = if (maxChannel <= 0.0) 0.0 else (maxChannel - minChannel) / maxChannel

        luminance[index] = luma
        saturation[index] = sat
        brightnessSum += luma
        if (luma >= 250.0) overexposedCount += 1
      }

      val safeEdge = min(edgeMarginPixels, min(width, height) / 4)
      for (y in safeEdge until height - safeEdge) {
        for (x in safeEdge until width - safeEdge) {
          val index = y * width + x
          candidates[index] = luminance[index] >= brightnessThreshold && saturation[index] <= maxSaturation
        }
      }

      val clusters = extractClusters(
        candidates = candidates,
        luminance = luminance,
        saturation = saturation,
        width = width,
        height = height,
        minClusterPixels = minClusterPixels,
        maxClusterPixels = maxClusterPixels,
      )

      return mapOf(
        "sourceWidth" to bounds.outWidth,
        "sourceHeight" to bounds.outHeight,
        "analyzedWidth" to width,
        "analyzedHeight" to height,
        "brightnessEstimate" to brightnessSum / pixels.size,
        "overexposedRatio" to overexposedCount.toDouble() / pixels.size,
        "sharpnessVariance" to computeLaplacianVariance(luminance, width, height),
        "sha256" to sha256,
        "sizeBytes" to fileBytes.size,
        "clusters" to clusters,
      )
    } finally {
      analyzed.recycle()
    }
  }

  private fun resolveLocalFile(value: String): File {
    val parsed = Uri.parse(value)
    require(parsed.scheme == null || parsed.scheme == "file") { "OPTICAL_URI_MUST_BE_LOCAL_FILE" }
    val path = if (parsed.scheme == "file") parsed.path else value
    require(!path.isNullOrBlank()) { "OPTICAL_URI_INVALID" }
    return File(path)
  }

  private fun computeSampleSize(width: Int, height: Int, maxDimension: Int): Int {
    var sample = 1
    var sampledWidth = width
    var sampledHeight = height
    while (max(sampledWidth, sampledHeight) / 2 >= maxDimension) {
      sample *= 2
      sampledWidth /= 2
      sampledHeight /= 2
    }
    return sample
  }

  private fun scaleDownIfNeeded(bitmap: Bitmap, maxDimension: Int): Bitmap {
    val largest = max(bitmap.width, bitmap.height)
    if (largest <= maxDimension) return bitmap
    val scale = maxDimension.toDouble() / largest
    val width = max(1, (bitmap.width * scale).toInt())
    val height = max(1, (bitmap.height * scale).toInt())
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun extractClusters(
    candidates: BooleanArray,
    luminance: DoubleArray,
    saturation: DoubleArray,
    width: Int,
    height: Int,
    minClusterPixels: Int,
    maxClusterPixels: Int,
  ): List<Map<String, Any>> {
    val visited = BooleanArray(candidates.size)
    val queue = IntArray(candidates.size)
    val clusters = mutableListOf<Map<String, Any>>()

    for (start in candidates.indices) {
      if (!candidates[start] || visited[start]) continue

      var head = 0
      var tail = 0
      queue[tail++] = start
      visited[start] = true

      var count = 0
      var sumX = 0.0
      var sumY = 0.0
      var sumSaturation = 0.0
      var maxBrightness = 0.0
      var perimeter = 0

      while (head < tail) {
        val index = queue[head++]
        val x = index % width
        val y = index / width
        count += 1
        sumX += x
        sumY += y
        sumSaturation += saturation[index]
        maxBrightness = max(maxBrightness, luminance[index])

        val fourNeighbors = intArrayOf(
          if (x > 0) index - 1 else -1,
          if (x + 1 < width) index + 1 else -1,
          if (y > 0) index - width else -1,
          if (y + 1 < height) index + width else -1,
        )
        for (neighbor in fourNeighbors) {
          if (neighbor < 0 || !candidates[neighbor]) perimeter += 1
        }

        for (dy in -1..1) {
          for (dx in -1..1) {
            if (dx == 0 && dy == 0) continue
            val nx = x + dx
            val ny = y + dy
            if (nx !in 0 until width || ny !in 0 until height) continue
            val neighbor = ny * width + nx
            if (candidates[neighbor] && !visited[neighbor]) {
              visited[neighbor] = true
              queue[tail++] = neighbor
            }
          }
        }
      }

      if (count < minClusterPixels || count > maxClusterPixels || perimeter <= 0) continue

      val centroidX = sumX / count
      val centroidY = sumY / count
      val compactness = (4.0 * PI * count / perimeter.toDouble().pow(2.0)).coerceIn(0.0, 1.0)
      clusters += mapOf(
        "relativeX" to if (width > 1) centroidX / (width - 1) * 100.0 else 0.0,
        "relativeY" to if (height > 1) centroidY / (height - 1) * 100.0 else 0.0,
        "clusterSizePx" to count,
        "compactness" to compactness,
        "maxBrightness" to maxBrightness,
        "saturation" to sumSaturation / count,
      )
    }

    return clusters
  }

  private fun computeLaplacianVariance(luminance: DoubleArray, width: Int, height: Int): Double {
    if (width < 3 || height < 3) return 0.0
    var count = 0
    var sum = 0.0
    var sumSquares = 0.0

    for (y in 1 until height - 1) {
      for (x in 1 until width - 1) {
        val index = y * width + x
        val laplacian = 4.0 * luminance[index] -
          luminance[index - 1] - luminance[index + 1] -
          luminance[index - width] - luminance[index + width]
        count += 1
        sum += laplacian
        sumSquares += laplacian * laplacian
      }
    }

    if (count == 0) return 0.0
    val mean = sum / count
    return max(0.0, sumSquares / count - mean * mean)
  }
}
