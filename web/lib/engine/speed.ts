/* =====================================================================
   Velocidade: constante, curvas (speedCurve / speedPreset) e reverso.
   Mapeia tempo de TIMELINE -> tempo da FONTE integrando a curva (puro).
   Curva: pontos {t 0..1 relativo à duração do clipe, speed}, interpolação
   linear entre pontos; fora do intervalo segura a ponta.
   ===================================================================== */
import type { Clip, Seconds, SpeedPoint, SpeedPreset } from '../types';

export const SPEED_PRESETS: Record<SpeedPreset, SpeedPoint[]> = {
  montage: [{ t: 0, speed: 1 }, { t: 0.25, speed: 2.5 }, { t: 0.5, speed: 0.6 }, { t: 0.75, speed: 2.5 }, { t: 1, speed: 1 }],
  hero: [{ t: 0, speed: 1.6 }, { t: 0.38, speed: 1.6 }, { t: 0.5, speed: 0.25 }, { t: 0.62, speed: 1.6 }, { t: 1, speed: 1.6 }],
  bullet: [{ t: 0, speed: 2 }, { t: 0.35, speed: 0.2 }, { t: 0.65, speed: 0.2 }, { t: 1, speed: 2 }],
  'jump-cut': [{ t: 0, speed: 1 }, { t: 0.45, speed: 1 }, { t: 0.5, speed: 5 }, { t: 0.55, speed: 1 }, { t: 1, speed: 1 }],
  'flash-in': [{ t: 0, speed: 4 }, { t: 0.4, speed: 1 }, { t: 1, speed: 1 }],
  'flash-out': [{ t: 0, speed: 1 }, { t: 0.6, speed: 1 }, { t: 1, speed: 4 }],
};

export const SPEED_PRESET_LABELS: Record<SpeedPreset, string> = {
  montage: 'Montagem', hero: 'Herói', bullet: 'Bala', 'jump-cut': 'Jump cut', 'flash-in': 'Flash in', 'flash-out': 'Flash out',
};

type Speedy = Partial<Pick<Extract<Clip, { type: 'video' }>, 'speed' | 'speedCurve' | 'speedPreset' | 'reverse' | 'in'>> & {
  type: Clip['type']; start: Seconds; duration: Seconds;
};

const MIN_SPEED = 0.05;

/** curva efetiva do clipe (speedCurve tem prioridade sobre o preset) ou null p/ velocidade constante */
export function curveOf(c: Speedy): SpeedPoint[] | null {
  if (c.type !== 'video' && c.type !== 'audio') return null;
  const raw = c.speedCurve && c.speedCurve.length >= 2 ? c.speedCurve : c.speedPreset ? SPEED_PRESETS[c.speedPreset] : null;
  if (!raw) return null;
  return [...raw]
    .map((p) => ({ t: Math.min(1, Math.max(0, p.t)), speed: Math.max(MIN_SPEED, p.speed) }))
    .sort((a, b) => a.t - b.t);
}

/** velocidade da curva no ponto normalizado u */
export function curveSpeedAt(curve: SpeedPoint[], u: number): number {
  if (u <= curve[0].t) return curve[0].speed;
  const last = curve[curve.length - 1];
  if (u >= last.t) return last.speed;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (u >= a.t && u <= b.t) {
      const span = b.t - a.t;
      return span <= 0 ? b.speed : a.speed + (b.speed - a.speed) * ((u - a.t) / span);
    }
  }
  return last.speed;
}

/** ∫0^x speed(u) du (x normalizado; aceita x<0 e x>1 extrapolando as pontas) — exato p/ trechos lineares */
export function curveIntegral(curve: SpeedPoint[], x: number): number {
  if (x <= 0) return x * curve[0].speed;
  let acc = 0;
  let prevT = 0;
  let prevS = curveSpeedAt(curve, 0);
  const knots = curve.map((p) => p.t).filter((t) => t > 0 && t < 1);
  for (const k of [...knots, 1]) {
    const end = Math.min(k, x);
    if (end > prevT) {
      const s = curveSpeedAt(curve, end);
      acc += ((prevS + s) / 2) * (end - prevT);
      prevT = end;
      prevS = s;
    }
    if (x <= k) return acc;
  }
  return acc + (x - 1) * curve[curve.length - 1].speed;
}

/** quanto da fonte (s) é consumido até `local` segundos de timeline após o início do clipe */
export function sourceOffset(c: Speedy, local: Seconds): Seconds {
  const curve = curveOf(c);
  if (curve) {
    const d = c.duration > 0 ? c.duration : 1;
    return d * curveIntegral(curve, local / d);
  }
  const sp = (c.type === 'video' || c.type === 'audio') && c.speed && c.speed > 0 ? c.speed : 1;
  return local * sp;
}

/** duração total consumida da fonte pelo clipe inteiro */
export function sourceSpan(c: Speedy): Seconds {
  return sourceOffset(c, c.duration);
}

/** velocidade instantânea (p/ playbackRate do preview) */
export function rateAt(c: Speedy, local: Seconds): number {
  const curve = curveOf(c);
  if (curve) return curveSpeedAt(curve, c.duration > 0 ? local / c.duration : 0);
  return (c.type === 'video' || c.type === 'audio') && c.speed && c.speed > 0 ? c.speed : 1;
}

/** tempo na fonte para o tempo de timeline t (considera in, velocidade/curva e reverso) */
export function mapSourceTime(c: Speedy, t: Seconds): Seconds {
  const inPt = (c.type === 'video' || c.type === 'audio') && c.in ? c.in : 0;
  const local = t - c.start;
  const off = sourceOffset(c, Math.max(0, local));
  if (c.reverse && (c.type === 'video' || c.type === 'audio')) {
    return Math.max(inPt, inPt + sourceSpan(c) - off);
  }
  return Math.max(0, inPt + off);
}

/** amostras (tempo de timeline, velocidade) p/ automação de playbackRate no export */
export function rateEnvelope(c: Speedy, step = 1 / 30): { t: Seconds; rate: number }[] {
  const curve = curveOf(c);
  if (!curve) return [{ t: c.start, rate: rateAt(c, 0) }];
  const pts: { t: Seconds; rate: number }[] = [];
  const knots = new Set<number>([0, 1, ...curve.map((p) => p.t)]);
  for (let u = 0; u < 1; u += step / Math.max(c.duration, 1e-3)) knots.add(u);
  [...knots].sort((a, b) => a - b).forEach((u) => pts.push({ t: c.start + u * c.duration, rate: curveSpeedAt(curve, u) }));
  return pts;
}
