type Series = { label: string; color: string; points: number[] };

export function LineChart({ series, xLabels }: { series: Series[]; xLabels: string[] }) {
  const width = 640;
  const height = 200;
  const padTop = 10;
  const padBottom = 24;
  const padLeft = 8;
  const padRight = 8;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allValues = series.flatMap((s) => s.points);
  const max = Math.max(1, ...allValues);
  const stepX = xLabels.length > 1 ? plotW / (xLabels.length - 1) : 0;

  function pointsToPath(points: number[]) {
    return points
      .map((v, i) => {
        const x = padLeft + i * stepX;
        const y = padTop + plotH - (v / max) * plotH;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Activity over time">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padLeft}
            x2={width - padRight}
            y1={padTop + plotH * (1 - f)}
            y2={padTop + plotH * (1 - f)}
            stroke="currentColor"
            className="text-vault-border"
            strokeWidth="1"
          />
        ))}
        {series.map((s) => (
          <path key={s.label} d={pointsToPath(s.points)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {series.map((s) =>
          s.points.map((v, i) => (
            <circle
              key={`${s.label}-${i}`}
              cx={padLeft + i * stepX}
              cy={padTop + plotH - (v / max) * plotH}
              r="3"
              fill={s.color}
            />
          ))
        )}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-ink-faint">
        {xLabels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}
