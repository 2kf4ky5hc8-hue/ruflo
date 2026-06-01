// Tiny inline-SVG sparkline. Server-renderable, no client JS, no deps.
// Renders a primary series as a filled area + line, plus an optional overlay
// (e.g. the HWM ribbon) as a dashed line.

interface Point { ts: Date; value: number; }

interface Props {
  series: Point[];
  overlay?: Point[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}

export function Sparkline({ series, overlay, width = 720, height = 120, ariaLabel }: Props) {
  if (series.length === 0) {
    return <svg width={width} height={height} role="img" aria-label={ariaLabel ?? 'No data.'} />;
  }

  const padX = 4;
  const padY = 8;

  const combined = [...series, ...(overlay ?? [])];
  const xs = combined.map((p) => p.ts.getTime());
  const ys = combined.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = Math.max(1, xMax - xMin);
  const yRange = Math.max(1, yMax - yMin);

  const px = (t: number): number => padX + ((t - xMin) / xRange) * (width - 2 * padX);
  const py = (v: number): number => height - padY - ((v - yMin) / yRange) * (height - 2 * padY);

  const pathFor = (pts: Point[]): string => {
    if (pts.length === 0) return '';
    if (pts.length === 1) {
      const p = pts[0]!;
      return `M ${px(p.ts.getTime())} ${py(p.value)} L ${px(p.ts.getTime()) + 1} ${py(p.value)}`;
    }
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.ts.getTime()).toFixed(2)} ${py(p.value).toFixed(2)}`).join(' ');
  };

  const seriesPath = pathFor(series);
  const areaPath = series.length > 0
    ? `${seriesPath} L ${px(series[series.length - 1]!.ts.getTime()).toFixed(2)} ${(height - padY).toFixed(2)} L ${px(series[0]!.ts.getTime()).toFixed(2)} ${(height - padY).toFixed(2)} Z`
    : '';
  const overlayPath = overlay ? pathFor(overlay) : '';

  const last = series[series.length - 1]!;
  const first = series[0]!;
  const change = last.value - first.value;
  const positive = change >= 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
         role="img" aria-label={ariaLabel ?? 'Portfolio market value over time'}
         className="w-full">
      <path d={areaPath} fill={positive ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.10)'} />
      <path d={seriesPath} fill="none" strokeWidth="2"
            stroke={positive ? '#16a34a' : '#dc2626'} />
      {overlayPath && (
        <path d={overlayPath} fill="none" strokeWidth="1" strokeDasharray="3 3" stroke="#6b7280" />
      )}
      <circle cx={px(last.ts.getTime())} cy={py(last.value)} r={3}
              fill={positive ? '#16a34a' : '#dc2626'} />
    </svg>
  );
}
