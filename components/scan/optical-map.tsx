'use client';

import type { Finding } from '@/lib/scan/types';

interface OpticalMapProps {
  findings: Finding[];
  width?: number;
  height?: number;
}

/**
 * Mejora 2: 2D frame map for optical findings.
 * Renders a scaled-down representation of the camera frame with markers
 * showing where each lens-glint cluster was detected.
 * Coordinates come from the evidence.relativeX / relativeY fields (0-100%).
 */
export function OpticalMap({ findings, width = 220, height = 165 }: OpticalMapProps) {
  const opticalFindings = findings.filter(
    (f) =>
      f.module === 'optical' &&
      (f.severity === 'suspicious' || f.severity === 'high') &&
      typeof f.evidence.relativeX === 'number' &&
      typeof f.evidence.relativeY === 'number',
  );

  if (opticalFindings.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Mapa de posición — reflejo detectado
      </p>
      <div
        className="relative overflow-hidden rounded-xl border border-cyan-500/30 bg-black/60"
        style={{ width, height }}
        aria-label="Mapa de posición del reflejo óptico"
      >
        {/* Grid lines for reference */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* Grid */}
          {[25, 50, 75].map((v) => (
            <g key={v}>
              <line x1={v} y1="0" x2={v} y2="100" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
              <line x1="0" y1={v} x2="100" y2={v} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
            </g>
          ))}
          {/* Center crosshair */}
          <line x1="50" y1="45" x2="50" y2="55" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
          <line x1="45" y1="50" x2="55" y2="50" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
        </svg>

        {/* Frame label corners */}
        <span className="absolute left-1.5 top-1 text-[9px] text-white/20">↑ arriba</span>
        <span className="absolute bottom-1 left-1.5 text-[9px] text-white/20">↓ abajo</span>

        {/* Glint markers */}
        {opticalFindings.map((f, i) => {
          const x = f.evidence.relativeX as number;
          const y = f.evidence.relativeY as number;
          const compact = f.evidence.compactness as number | undefined;
          const size = f.evidence.clusterSizePx as number | undefined;
          // Scale dot size by cluster size (4-400 px → 6-14 screen px)
          const dotPx = size ? Math.round(6 + Math.min(size / 50, 1) * 8) : 10;

          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `calc(${x}% - ${dotPx / 2}px)`,
                top: `calc(${y}% - ${dotPx / 2}px)`,
              }}
              title={`Reflejo #${i + 1} — compacidad: ${compact?.toFixed(2) ?? '?'}, tamaño: ${size ?? '?'}px`}
            >
              {/* Pulsing glow ring */}
              <span
                className="absolute inset-0 animate-ping rounded-full bg-cyan-400/40"
                style={{ borderRadius: '50%' }}
                aria-hidden
              />
              {/* Solid center dot */}
              <span
                className="relative block rounded-full bg-cyan-300 shadow-[0_0_6px_2px_rgba(34,211,238,0.7)]"
                style={{ width: dotPx, height: dotPx }}
                aria-hidden
              />
            </div>
          );
        })}

        {/* Legend */}
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5">
          <span className="size-2 rounded-full bg-cyan-300" aria-hidden />
          <span className="text-[9px] text-cyan-300">
            {opticalFindings.length} reflejo{opticalFindings.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        El punto azul marca la posición relativa del reflejo dentro del encuadre de la cámara.
        Apunta ahí para confirmar.
      </p>
    </div>
  );
}
