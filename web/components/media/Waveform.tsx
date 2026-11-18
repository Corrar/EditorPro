/* waveform compacta em SVG (barras simétricas) a partir de picos 0..1 */
export default function Waveform({ peaks, bars = 48, className }: { peaks?: number[]; bars?: number; className?: string }) {
  const src = peaks?.length ? peaks : null;
  const vals = Array.from({ length: bars }, (_, i) => {
    if (!src) return 0.15 + 0.12 * Math.abs(Math.sin(i * 1.7));
    const a = Math.floor((i * src.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / bars));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, src[j] ?? 0);
    return Math.max(0.06, m);
  });
  const w = 100 / bars;
  return (
    <svg className={className} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {vals.map((v, i) => (
        <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={20 - v * 18} height={v * 36} rx={w * 0.3} />
      ))}
    </svg>
  );
}
