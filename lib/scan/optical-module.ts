import type { Finding, ModuleAvailability } from './types';

// Real optical lens-detection via the phone's rear camera + torch.
// A camera lens concentrates reflected torch light into a tiny, very bright,
// near-circular, spectrally neutral (white) cluster that persists across frames.
// Every filter below has a documented anti-false-positive rationale.

const BRIGHTNESS_THRESHOLD = 240; // slightly relaxed from 245 for phones with warmer sensors
const MIN_CLUSTER_PX       = 3;   // at least 3 connected bright pixels
const MAX_CLUSTER_PX       = 500; // large blobs = windows / lamps, not lenses
const PERSIST_FRAMES       = 6;   // must persist 6 consecutive frames (~100ms at 60fps)
const COMPACTNESS_MIN      = 0.30; // slightly relaxed: real glints are roundish but not perfect circles
const EDGE_MARGIN_PX       = 10;
const MAX_SATURATION       = 0.30; // near-white: all channels within 30% of each other

export function opticalAvailability(): ModuleAvailability {
  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  return {
    module: 'optical',
    supported,
    permissionState: 'prompt',
    reason: supported ? undefined : 'Este navegador no permite acceso a la cámara.',
  };
}

export interface OpticalHandle {
  stream: MediaStream;
  stop: () => void;
}

export interface OpticalProgress {
  framesAnalyzed: number;
  clustersFound: number;   // bright clusters passing all filters this frame
  torchActive: boolean;
}

export async function startOpticalScan(
  video: HTMLVideoElement,
  onFinding: (finding: Finding) => void,
  onProgress?: (p: OpticalProgress) => void,
): Promise<OpticalHandle> {
  // Request rear camera with torch
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  // Attach stream and wait for metadata so video.videoWidth/Height are set
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Video metadata error'));
    setTimeout(() => reject(new Error('Video metadata timeout')), 8000);
  });
  await video.play();

  // Enable torch
  let torchActive = false;
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  if (caps?.torch) {
    try {
      await track.applyConstraints({ advanced: [{ torch: true } as unknown as MediaTrackConstraintSet] });
      torchActive = true;
    } catch { /* torch not permitted — scan still works */ }
  }

  // Off-screen canvas — downscale for performance
  const W = 160, H = 120;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const hotspotHistory = new Map<string, number>();
  let stopped = false;
  let rafId = 0;
  let framesAnalyzed = 0;

  const analyzeFrame = () => {
    if (stopped) return;

    // Only analyze when the video is actually playing and has dimensions
    if (video.readyState < 2 || video.videoWidth === 0) {
      rafId = requestAnimationFrame(analyzeFrame);
      return;
    }

    ctx.drawImage(video, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    framesAnalyzed++;

    const visited = new Uint8Array(W * H);
    const clusters: {
      size: number; cx: number; cy: number; maxBrightness: number;
      minX: number; maxX: number; minY: number; maxY: number;
      sumR: number; sumG: number; sumB: number;
    }[] = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (visited[idx]) continue;
        const p = idx * 4;
        const brightness = (data[p] + data[p + 1] + data[p + 2]) / 3;
        if (brightness < BRIGHTNESS_THRESHOLD) { visited[idx] = 1; continue; }

        // Flood-fill bright region (4-connected)
        const stack: [number, number][] = [[x, y]];
        let size = 0, sumX = 0, sumY = 0, maxB = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        let sumR = 0, sumG = 0, sumB = 0;
        visited[idx] = 1;

        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          const cIdx = cy * W + cx;
          const cp = cIdx * 4;
          const b = (data[cp] + data[cp + 1] + data[cp + 2]) / 3;
          if (b < BRIGHTNESS_THRESHOLD) continue;
          size++; sumX += cx; sumY += cy;
          sumR += data[cp]; sumG += data[cp + 1]; sumB += data[cp + 2];
          maxB = Math.max(maxB, b);
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
          if (size > MAX_CLUSTER_PX * 2) break;

          for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]] as [number,number][]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nIdx = ny * W + nx;
            if (visited[nIdx]) continue;
            visited[nIdx] = 1;
            const nb = (data[nIdx*4] + data[nIdx*4+1] + data[nIdx*4+2]) / 3;
            if (nb >= BRIGHTNESS_THRESHOLD) stack.push([nx, ny]);
          }
        }

        if (size < MIN_CLUSTER_PX || size > MAX_CLUSTER_PX) continue;

        // Saturation filter: lens glint = near-white (R≈G≈B)
        const avgR = sumR/size, avgG = sumG/size, avgB = sumB/size;
        const maxCh = Math.max(avgR, avgG, avgB);
        const minCh = Math.min(avgR, avgG, avgB);
        const sat = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
        if (sat > MAX_SATURATION) continue;

        // Edge exclusion: bisel / hand glare
        if (minX <= EDGE_MARGIN_PX || maxX >= W-EDGE_MARGIN_PX ||
            minY <= EDGE_MARGIN_PX || maxY >= H-EDGE_MARGIN_PX) continue;

        // Compactness: lenses are round
        const bbArea = (maxX-minX+1) * (maxY-minY+1);
        const compactness = bbArea > 0 ? size / bbArea : 0;
        if (compactness < COMPACTNESS_MIN) continue;

        clusters.push({ size, cx: sumX/size, cy: sumY/size, maxBrightness: maxB,
          minX, maxX, minY, maxY, sumR, sumG, sumB });
      }
    }

    // Report progress every frame so the UI stays alive
    onProgress?.({ framesAnalyzed, clustersFound: clusters.length, torchActive });

    // Persistence check: cluster must appear in the same grid cell for PERSIST_FRAMES
    const seenThisFrame = new Set<string>();
    for (const cl of clusters) {
      const key = `${Math.round(cl.cx/8)}:${Math.round(cl.cy/8)}`;
      seenThisFrame.add(key);
      const count = (hotspotHistory.get(key) ?? 0) + 1;
      hotspotHistory.set(key, count);

      if (count === PERSIST_FRAMES) {
        const relX = Math.round((cl.cx / W) * 100);
        const relY = Math.round((cl.cy / H) * 100);
        const sat  = Math.max(cl.sumR,cl.sumG,cl.sumB)/cl.size;
        const sat2 = sat > 0 ? (sat - Math.min(cl.sumR,cl.sumG,cl.sumB)/cl.size) / sat : 0;
        const comp = bbCompactness(cl);
        onFinding({
          module: 'optical',
          severity: 'suspicious',
          title: 'Reflejo puntual de lente detectado',
          detail: `Punto brillante (brillo máx ${Math.round(cl.maxBrightness)}/255), compacto (${comp.toFixed(2)}), neutro (sat ${sat2.toFixed(2)}) y estable en (${relX}%, ${relY}%) durante ${PERSIST_FRAMES} frames consecutivos. Este patrón es compatible con el reflejo de una lente iluminada por el flash. Mueve el teléfono unos centímetros: un reflejo de lente real varía de intensidad con el ángulo, una luz LED fija no.`,
          evidence: { relativeX: relX, relativeY: relY, clusterSizePx: cl.size,
            compactness: Number(comp.toFixed(2)), maxBrightness: Math.round(cl.maxBrightness),
            saturation: Number(sat2.toFixed(3)), framesPersisted: count, torchWasActive: torchActive,
            source: 'optical lens-glint scan' },
        });
      }
    }

    for (const key of Array.from(hotspotHistory.keys())) {
      if (!seenThisFrame.has(key)) hotspotHistory.delete(key);
    }

    rafId = requestAnimationFrame(analyzeFrame);
  };

  rafId = requestAnimationFrame(analyzeFrame);
  return {
    stream,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      try { track.applyConstraints({ advanced: [{ torch: false } as unknown as MediaTrackConstraintSet] }); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

function bbCompactness(cl: { size: number; minX: number; maxX: number; minY: number; maxY: number }) {
  const bbArea = (cl.maxX - cl.minX + 1) * (cl.maxY - cl.minY + 1);
  return bbArea > 0 ? cl.size / bbArea : 0;
}
