/* =====================================================================
   Política de reprodução do preview (pura, testada em syncPolicy.test.ts).
   Objetivo: reprodução fluida no celular (Android/iPhone), sem tela preta.
   - O RELÓGIO segue o vídeo principal (não o contrário): o vídeo nunca é
     "puxado" com seek a cada desvio pequeno. Se ele engasga (buscando /
     sem dados / começando a tocar), o relógio espera um pouco.
   - Elementos secundários (outras trilhas, áudio) corrigem desvio pequeno com
     playbackRate (±5%) e só fazem seek com desvio grande (> 0,5 s), com
     carência logo após dar play/seek.
   - Qualidade: degraus fixos com histerese forte (sem ficar alternando).
   - Pré-carga: o próximo clipe é posicionado (pausado) antes do corte.
   ===================================================================== */
import type { Clip, Project, Seconds, Track } from '@/lib/types';

/** desvio a partir do qual um elemento secundário faz seek (s) */
export const SEEK_DRIFT = 0.5;
/** abaixo disto o desvio é ignorado (s) */
export const SOFT_DRIFT = 0.04;
/** ajuste máximo de playbackRate p/ corrigir desvio (±5%) */
export const MAX_NUDGE = 0.05;
/** carência após play()/seek antes de corrigir com seek (ms): o Android leva centenas de ms p/ começar */
export const KICK_GRACE_MS = 700;
/** quanto antes do corte o próximo clipe é pré-posicionado (s) */
export const PREROLL = 1.2;
/** espera máxima do relógio por um vídeo que engasgou (ms) */
export const MAX_HOLD_MS = 600;

export interface DriftInput {
  /** alvo - tempo atual do elemento, em segundos da MÍDIA (positivo = elemento atrasado) */
  drift: number;
  /** velocidade nominal do clipe nesse instante */
  rate: number;
  /** ms desde o último play()/seek desse elemento */
  sinceKickMs: number;
  /** elemento principal (o relógio o segue): nunca recebe ajuste de velocidade */
  lead: boolean;
}

export interface DriftDecision { seek: boolean; rate: number }

/** decide como corrigir o desvio de um elemento em reprodução */
export function driftDecision({ drift, rate, sinceKickMs, lead }: DriftInput): DriftDecision {
  const a = Math.abs(drift);
  // desvio enorme (ex.: seek do usuário / clipe trocou de ponto): seek sempre
  if (a > 2) return { seek: true, rate };
  if (a > SEEK_DRIFT && sinceKickMs >= KICK_GRACE_MS) return { seek: true, rate };
  if (lead || a <= SOFT_DRIFT) return { seek: false, rate };
  // atrasado → acelera um pouco; adiantado → desacelera (quantizado p/ não mexer a cada quadro)
  const k = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift * 0.25));
  const q = Math.round(k * 100) / 100;
  return { seek: false, rate: Math.min(16, Math.max(0.0625, rate * (1 + q))) };
}

/* ---------- relógio que segue o vídeo ---------- */

export interface LeadState {
  /** tempo de timeline que o vídeo principal está mostrando (estimado do currentTime) */
  videoT: Seconds;
  /** o vídeo principal não está avançando (buscando, sem dados, ou acabou de receber play) */
  stalled: boolean;
}

/**
 * Relógio de reprodução. Avança com o tempo de parede; quando há vídeo principal,
 * converge suavemente para o tempo dele e espera (até MAX_HOLD_MS) se ele engasgar.
 */
export class PlaybackClock {
  private t = 0;
  private wall = 0;
  private holdMs = 0;
  /** velocidade de reprodução do preview (0,5×–2×) */
  rate = 1;

  reset(t: Seconds, wall: number) {
    this.t = t;
    this.wall = wall;
    this.holdMs = 0;
  }

  get time() {
    return this.t;
  }

  /** avança até `wall` (ms) e devolve o tempo de timeline */
  tick(wall: number, lead: LeadState | null): Seconds {
    const dtMs = Math.max(0, Math.min(250, wall - this.wall));
    this.wall = wall;
    if (lead?.stalled && this.holdMs < MAX_HOLD_MS) {
      // vídeo engasgou: segura o relógio (melhor esperar 1 quadro que pular/piscar)
      this.holdMs += dtMs;
      return this.t;
    }
    if (!lead?.stalled) this.holdMs = Math.max(0, this.holdMs - dtMs * 0.5);
    this.t += (dtMs / 1000) * this.rate;
    if (lead && !lead.stalled) {
      const d = lead.videoT - this.t;
      // perto: converge 15% por tick (sem saltos); longe: não segue (o seek do elemento resolve)
      if (Math.abs(d) < SEEK_DRIFT) this.t += d * 0.15;
    }
    return this.t;
  }
}

/* ---------- qualidade com histerese ---------- */

/** degraus do fator de resolução interna (1 = 720p no celular forte; 0.75 ≈ 540p) */
export const QUALITY_STEPS = [1, 0.75, 0.5] as const;

/**
 * Governa a resolução interna durante a reprodução. Só reduz um degrau se o custo
 * médio ficar alto por um tempo (> slowMs por holdMs); só volta depois de muito
 * tempo folgado. Nunca alterna mais de uma vez a cada `minGapMs`.
 */
export class QualityGovernor {
  private level = 0;
  private ema = 0;
  private n = 0;
  private overSince = -1;
  private underSince = -1;
  private lastChange = -Infinity;
  constructor(private o = { slowMs: 30, fastMs: 12, holdMs: 1500, recoverMs: 6000, minGapMs: 4000, warmup: 12 }) {}

  get factor(): number {
    return QUALITY_STEPS[this.level];
  }

  reset() {
    this.ema = 0;
    this.n = 0;
    this.overSince = -1;
    this.underSince = -1;
  }

  /** registra o custo de um quadro (ms); devolve o novo fator se mudou, senão null */
  push(costMs: number, now: number): number | null {
    if (++this.n <= this.o.warmup) return null;
    this.ema = this.ema ? this.ema * 0.9 + costMs * 0.1 : costMs;
    if (now - this.lastChange < this.o.minGapMs) return null;
    // 2º degrau (0,5) só com custo MUITO alto (ex.: correção de cor no canvas em aparelho fraco)
    const limit = this.level === 0 ? this.o.slowMs : this.o.slowMs * 2;
    if (this.ema > limit && this.level < QUALITY_STEPS.length - 1) {
      if (this.overSince < 0) this.overSince = now;
      this.underSince = -1;
      if (now - this.overSince >= this.o.holdMs) return this.change(this.level + 1, now);
    } else if (this.ema < this.o.fastMs && this.level > 0) {
      if (this.underSince < 0) this.underSince = now;
      this.overSince = -1;
      if (now - this.underSince >= this.o.recoverMs) return this.change(this.level - 1, now);
    } else {
      this.overSince = -1;
      this.underSince = -1;
    }
    return null;
  }

  private change(level: number, now: number) {
    this.level = level;
    this.lastChange = now;
    this.overSince = -1;
    this.underSince = -1;
    this.ema = 0;
    this.n = 0;
    return this.factor;
  }
}

/* ---------- pré-carga ---------- */

export interface PlanItem { clip: Clip; track: Track }

/**
 * Clipes de vídeo/áudio que começam em até `horizon` segundos (e ainda não estão
 * ativos): devem ganhar um elemento próprio já pausado no ponto de entrada, p/ o
 * corte trocar de elemento sem seek.
 */
export function prerollPlan(p: Project, t: Seconds, horizon = PREROLL): PlanItem[] {
  const out: PlanItem[] = [];
  for (const track of p.tracks) {
    if (track.hidden && track.kind !== 'audio') continue;
    if (track.kind !== 'video' && track.kind !== 'overlay' && track.kind !== 'audio') continue;
    for (const c of track.clips) {
      if (c.type !== 'video' && c.type !== 'audio') continue;
      if (track.kind === 'audio' && c.type !== 'audio') continue;
      if (c.start > t && c.start - t <= horizon) out.push({ clip: c, track });
    }
  }
  return out.sort((a, b) => a.clip.start - b.clip.start);
}

/** quanto antes do corte o próximo clipe já começa a tocar (mudo) — o play() do Android demora */
export const WARM_START = 0.35;

/**
 * Onde deixar o elemento do PRÓXIMO clipe, faltando `until` segundos p/ ele entrar:
 * antes da partida, pausado em (entrada − WARM_START·rate); na janela de partida,
 * tocando, de modo a chegar exatamente na entrada no corte. Reverso/entrada perto
 * do 0: só pausado na entrada.
 */
export function warmPosition(at: Seconds, until: Seconds, rate: number, reverse: boolean): { at: Seconds; play: boolean } {
  const lead = WARM_START * rate;
  if (reverse || at < lead) return { at, play: false };
  if (until > WARM_START) return { at: at - lead, play: false };
  return { at: at - Math.max(0, until) * rate, play: true };
}

/** quadro do elemento é desenhável para o alvo? (sem dados ou buscando longe → não) */
/** confirmação de quadro pelo requestVideoFrameCallback (quando o navegador tem a API) */
export interface FrameProof {
  /** mediaTime do último quadro realmente apresentado (rVFC); undefined = nenhum ainda */
  presented?: number;
  /** ms desde o último 'seeked'/'loadeddata' (rede de segurança se o rVFC não vier) */
  sinceSettleMs: number;
}

/** espera máxima pelo rVFC depois de um seek antes de confiar só no readyState */
export const RVFC_GRACE_MS = 400;

/**
 * Quadro do elemento é desenhável/exibível para o alvo?
 * - sem dados ou buscando longe → não
 * - com rVFC (Android: 'seeked' chega ANTES do quadro estar pronto p/ o canvas): só depois
 *   que um quadro perto do alvo foi apresentado, ou passada a carência pós-seek
 */
export function frameReady(el: { readyState: number; seeking: boolean; currentTime: number }, target: Seconds, proof?: FrameProof): boolean {
  if (el.readyState < 2) return false;
  if (el.seeking && Math.abs(el.currentTime - target) > 0.3) return false;
  if (!proof) return true;
  if (proof.presented !== undefined && Math.abs(proof.presented - target) <= 0.35) return true;
  return proof.sinceSettleMs >= RVFC_GRACE_MS;
}

/** intervalo mínimo entre quadros desenhados p/ o fps do projeto (com folga de vsync) */
export function frameInterval(fps: number | undefined): number {
  const f = Math.min(60, Math.max(12, fps || 30));
  return 1000 / f - 4;
}

/**
 * Elementos livres que não servem mais (mídia removida ou fonte trocada — ex.: o proxy
 * ficou pronto): devem ser destruídos para liberar o decodificador (escasso no Android).
 */
export function staleIdle<T extends { url: string }>(list: T[], currentUrl: string | null): T[] {
  if (currentUrl === null) return list.slice();
  return list.filter((e) => e.url !== currentUrl);
}

/**
 * Tempo a MOSTRAR com o vídeo parado: no fim da timeline (playhead = duração) nenhum clipe
 * está ativo (intervalos [início, fim)), então mostra o último quadro em vez de tela preta.
 */
export function stillTime(t: Seconds, duration: Seconds, fps: number | undefined): Seconds {
  if (duration > 0 && t >= duration - 1e-6) return Math.max(0, duration - 1 / (fps || 30));
  return t;
}
