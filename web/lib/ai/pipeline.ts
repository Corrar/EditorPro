/* =====================================================================
   Pipeline da IA (navegador): orquestra análise do exemplo (quadros) ->
   transcrição (Whisper local) -> pedido de edição (Claude) -> aplicação
   AO VIVO (store.applyLive). Sem chave: MODO DEMO (local, sem custo).
   ===================================================================== */
import type { CaptionSegment, Clip, Id, MediaAsset, Project, StyleProfile } from '../types';
import { clipEnd, projectDuration, type EditOp } from '../ops';
import { makeAudioClip, makeImageClip, makeVideoClip } from '../defaults';
import { useEditor } from '../store';
import { AIClientError, analyzeReference, getStatus, requestEdit, type AIStatus, type EditFrame } from './client';
import { sampleReference, silencesFor } from './analysis';
import { chatIntent, demoCaptions, demoNeeds, planFirstEdit, speechRanges, type Range } from './demo';
import { deviceProfile, framesFromThumbnails, sampleVideo } from './frames';
import { captionsMediaToTimeline } from './timemap';
import { sanitizeOps } from './validate';
import { chooseWhisper, transcribeMedia } from './whisper';

export interface AskOption { id: string; label: string }

export interface PipelineOptions {
  /** narração do que está acontecendo agora ("Transcrevendo…"), com progresso 0..1 opcional */
  onStatus?: (text: string, progress?: number) => void;
  /** etapa concluída (vira um ✓ no chat) */
  onLog?: (text: string) => void;
  /** aplica um lote de ops ao vivo; padrão = store.applyLive */
  apply?: (ops: EditOp[], opts?: { delayMs?: number }) => Promise<Id[]>;
  /** pergunta ao usuário no chat (botões); sem isso, segue sem perguntar */
  ask?: (text: string, options: AskOption[]) => Promise<string>;
  /** etapa pulável: devolve um AbortSignal (botão "Pular" no chat); null = terminou */
  skippable?: (label: string | null) => AbortSignal | undefined;
  /** usar o Whisper no navegador (padrão true) */
  whisper?: boolean;
}

export interface PipelineResult {
  reply: string;
  ops: EditOp[];
  appliedIds: Id[];
  provider: AIStatus['provider'];
  /** o pedido era "desfazer" (demo) */
  undo?: boolean;
  warnings: string[];
}

const store = () => useEditor.getState();
const defaultApply: NonNullable<PipelineOptions['apply']> = (ops, o) => store().applyLive(ops, o);

/* ---------- utilitários ---------- */

export function sourceAssets(assets: Record<Id, MediaAsset>): MediaAsset[] {
  return Object.values(assets).filter((a) => a.role === 'source');
}
export function referenceAsset(assets: Record<Id, MediaAsset>, p: Project): MediaAsset | undefined {
  return (p.referenceAssetId && assets[p.referenceAssetId]) || Object.values(assets).find((a) => a.role === 'reference' && a.kind === 'video');
}

function allClips(p: Project): Clip[] {
  return p.tracks.flatMap((t) => t.clips);
}
function onTimeline(p: Project): Set<Id> {
  return new Set(allClips(p).map((c) => ('assetId' in c ? c.assetId : '')));
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** ops que colocam o material bruto na timeline (se ainda não estiver) + brief/referência */
export function prelimOps(p: Project, assets: Record<Id, MediaAsset>, brief: string): EditOp[] {
  const ops: EditOp[] = [];
  const patch: Record<string, unknown> = {};
  if (brief && brief !== p.brief) patch.brief = brief;
  const ref = referenceAsset(assets, p);
  if (ref && p.referenceAssetId !== ref.id) patch.referenceAssetId = ref.id;
  if (Object.keys(patch).length) ops.push({ op: 'set_project', patch, explain: 'Guardando o seu pedido' });

  const used = onTimeline(p);
  const videoTrack = p.tracks.find((t) => t.kind === 'video')?.id ?? 'track_video_1';
  const audioTrack = p.tracks.find((t) => t.kind === 'audio')?.id ?? 'track_audio_1';
  let vEnd = Math.max(0, ...(p.tracks.find((t) => t.id === videoTrack)?.clips.map(clipEnd) ?? [0]));
  for (const a of sourceAssets(assets)) {
    if (used.has(a.id)) continue;
    if (a.kind === 'video' && a.duration > 0) {
      ops.push({ op: 'add_clip', trackId: videoTrack, clip: makeVideoClip(a, vEnd), explain: `Colocando "${a.name}" na timeline` });
      vEnd += a.duration;
    } else if (a.kind === 'image') {
      ops.push({ op: 'add_clip', trackId: videoTrack, clip: makeImageClip(a, vEnd, 3), explain: `Colocando a imagem "${a.name}"` });
      vEnd += 3;
    } else if (a.kind === 'audio' && a.duration > 0) {
      ops.push({ op: 'add_clip', trackId: audioTrack, clip: makeAudioClip(a, 0), explain: `Colocando o áudio "${a.name}"` });
    }
  }
  return ops;
}

/** executa `fn` e junta tudo o que ela aplicou num ÚNICO passo de desfazer */
export async function withSingleUndo<T>(fn: () => Promise<T>): Promise<T> {
  const s0 = store();
  const pastBefore = s0.past;
  const projectBefore = s0.project;
  try {
    return await fn();
  } finally {
    const s = store();
    if (s.project !== projectBefore && s.past.length >= pastBefore.length + 2) {
      useEditor.setState({ past: [...pastBefore, projectBefore].slice(-100), future: [] });
    }
  }
}

/* ---------- miniaturas do material (p/ o Claude "ver") ---------- */

const frameCache = new Map<string, EditFrame[]>();

/** poucas miniaturas pequenas por fonte: usa asset.thumbnails (shell) ou amostra o vídeo */
export async function sourceFrames(sources: MediaAsset[], allowSampling: boolean, max = 10): Promise<EditFrame[]> {
  const vids = sources.filter((a) => a.kind === 'video' || a.kind === 'image');
  if (!vids.length) return [];
  const per = Math.max(2, Math.floor(max / vids.length));
  const out: EditFrame[] = [];
  for (const a of vids) {
    const key = `${a.id}|${a.url}|${per}`;
    let fr = frameCache.get(key);
    if (!fr) {
      const thumbs = framesFromThumbnails(a.thumbnails, a.duration, per).map((f) => ({ ...f, assetId: a.id }));
      if (thumbs.length) fr = thumbs;
      else if (allowSampling && a.kind === 'video' && a.url) {
        try {
          const s = await sampleVideo(a.url, { noDiffs: true, maxFrames: per, maxSide: 384, quality: 0.6, budgetBytes: 900_000 });
          fr = s.frames.map((f) => ({ ...f, assetId: a.id }));
        } catch {
          fr = [];
        }
      } else fr = [];
      frameCache.set(key, fr);
    }
    out.push(...fr);
  }
  return out.slice(0, max);
}

/* ---------- transcrição (Whisper no navegador) ---------- */

/** transcreve as fontes com Whisper e converte p/ tempos da timeline. null = pulada/falhou/desligada. */
async function whisperCaptions(sources: MediaAsset[], language: string, opts: PipelineOptions, warnings: string[]): Promise<CaptionSegment[] | null> {
  const media = sources.filter((a) => (a.kind === 'video' || a.kind === 'audio') && a.url);
  if (!media.length || opts.whisper === false) return null;
  const dev = deviceProfile();
  const total = media.reduce((n, a) => n + (a.duration || 0), 0);
  const choice = await chooseWhisper();
  // aparelho fraco ou áudio longo no celular: pergunta antes de baixar/processar
  if (opts.ask && (dev.weak || (dev.mobile && total > 600))) {
    const pick = await opts.ask(
      `Para legendar, transcrevo a fala aqui no aparelho (${choice.label}, ~${choice.sizeMB} MB na 1ª vez${total > 120 ? `, ${Math.round(total / 60)} min de áudio` : ''}). Neste aparelho pode demorar.`,
      [{ id: 'go', label: `Transcrever (~${choice.sizeMB} MB)` }, { id: 'skip', label: 'Pular legendas' }],
    );
    if (pick !== 'go') {
      opts.onLog?.('Transcrição pulada');
      return null;
    }
  }
  const signal = opts.skippable?.('Pular transcrição');
  try {
    const segs: CaptionSegment[] = [];
    for (const a of media) {
      const mediaSegs = await transcribeMedia(a, { language, choice, signal, onStatus: (t, f) => opts.onStatus?.(media.length > 1 ? `${t} ("${a.name}")` : t, f) });
      segs.push(...captionsMediaToTimeline(store().project, a.id, mediaSegs));
    }
    return segs.sort((x, y) => x.start - y.start);
  } catch (e) {
    if (isAbort(e)) {
      opts.onLog?.('Transcrição pulada');
      return null;
    }
    warnings.push(`sem transcrição (${errText(e)})`);
    opts.onLog?.(`A transcrição falhou neste navegador (${errText(e)})`);
    return null;
  } finally {
    opts.skippable?.(null);
  }
}

/* ---------- 1ª edição ---------- */

export async function runFirstEdit(opts: PipelineOptions & { brief: string }): Promise<PipelineResult> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  const warnings: string[] = [];
  const brief = opts.brief.trim();

  return withSingleUndo(async () => {
    const { assets } = store();
    const sources = sourceAssets(assets).filter((a) => a.kind === 'video' || a.kind === 'audio' || a.kind === 'image');
    if (!sources.length) throw new AIClientError('Envie o material bruto (vídeo) antes de pedir a edição.', 400, 'no_source');
    const ref = referenceAsset(assets, store().project);

    opts.onStatus?.('Preparando o material…');
    const pre = prelimOps(store().project, assets, brief);
    if (pre.length) await apply(pre, { delayMs: 260 });

    // 1) vídeo-exemplo: quadros + cortes medidos aqui; o Claude descreve o estilo
    let style: StyleProfile | undefined = store().project.style;
    if (ref && !style) {
      opts.onStatus?.('Analisando seu vídeo-exemplo…');
      const sample = await sampleReference(ref, (f) => opts.onStatus?.(`Analisando seu vídeo-exemplo… ${Math.round(f * 100)}%`, f), status.configured);
      if (sample) {
        style = sample.localStyle;
        if (status.configured) {
          try {
            opts.onStatus?.('A IA está estudando o estilo do exemplo…');
            style = await analyzeReference(sample);
          } catch (e) {
            warnings.push(`análise do exemplo pela IA falhou (${errText(e)})`);
          }
        }
        await apply([{ op: 'set_project', patch: { style }, explain: 'Guardando o estilo do vídeo-exemplo' }], { delayMs: 200 });
        opts.onLog?.(`Vídeo-exemplo analisado: ${style.summary}`);
      } else opts.onLog?.('Não consegui ler o vídeo-exemplo — sigo sem ele');
    }

    // 2) legendas reais (Whisper local, grátis)
    const media = sources.filter((a) => a.kind !== 'image');
    if (!store().project.captions.segments.length && !/sem legenda/i.test(brief)) {
      const lang = store().project.captions.language || 'pt-BR';
      const segs = await whisperCaptions(media, lang, opts, warnings);
      if (segs?.length) {
        await apply([{ op: 'set_captions', segments: segs, language: lang, explain: `Colocando ${segs.length} legendas sincronizadas` }], { delayMs: 300 });
        opts.onLog?.(`Fala transcrita: ${segs.length} legendas`);
      } else if (segs) opts.onLog?.('Não encontrei fala para legendar');
    }

    if (status.configured) {
      opts.onStatus?.('Planejando a edição…');
      const frames = await sourceFrames(sources, true, 10);
      const res = await requestEdit({
        project: store().project, assets: store().assets, messages: store().messages, mode: 'first', frames,
        userText: brief || 'Edite este vídeo de forma profissional.',
      });
      const { ops } = sanitizeOps(res.ops, store().project, store().assets);
      opts.onStatus?.('Editando…');
      const appliedIds = ops.length ? await apply(ops) : [];
      return { reply: res.reply, ops, appliedIds, provider: 'anthropic' as const, warnings };
    }

    // ----- modo demo -----
    opts.onStatus?.('Ouvindo o áudio para achar as pausas…');
    const silences = await silencesFor(media);
    const nSil = Object.values(silences).reduce((n, r) => n + r.length, 0);
    opts.onLog?.(nSil ? `Áudio analisado: ${nSil} pausa${nSil > 1 ? 's' : ''} encontrada${nSil > 1 ? 's' : ''}` : 'Áudio analisado');
    opts.onStatus?.('Planejando a edição…');
    const plan = planFirstEdit({ project: store().project, assets: store().assets, brief, silencesByAsset: silences, style });
    const { ops } = sanitizeOps(plan.ops, store().project, store().assets);
    opts.onStatus?.('Editando…');
    const appliedIds = ops.length ? await apply(ops) : [];
    return { reply: plan.reply, ops, appliedIds, provider: 'demo' as const, warnings };
  });
}

/* ---------- legendas ---------- */

export async function generateCaptions(opts: PipelineOptions & { language?: string } = {}): Promise<PipelineResult> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  const language = opts.language || store().project.captions.language || 'pt-BR';
  const used = sourceAssets(store().assets).filter((a) => a.kind !== 'image' && onTimeline(store().project).has(a.id));
  if (!used.length) throw new AIClientError('Coloque o vídeo na timeline antes de gerar legendas.', 400, 'no_source');
  const warnings: string[] = [];

  let segs = await whisperCaptions(used, language, opts, warnings);
  let real = !!segs;
  if (!segs) {
    // sem transcrição: no demo, legendas de exemplo nos trechos de fala
    if (status.configured && warnings.length) throw new AIClientError(warnings[0], 500, 'transcribe_failed');
    opts.onStatus?.('Ouvindo o áudio…');
    const silences = await silencesFor(used);
    const speech: Record<Id, Range[]> = {};
    for (const a of used) speech[a.id] = speechRanges(silences[a.id] ?? [], a.duration);
    segs = demoCaptions(store().project, speech, store().project.brief);
    real = false;
  }
  if (!segs.length) return { reply: 'Não encontrei fala para legendar neste vídeo.', ops: [], appliedIds: [], provider: status.provider, warnings };
  const ops = sanitizeOps(
    [{ op: 'set_captions', segments: segs, language, explain: `Colocando ${segs.length} legendas${real ? ' sincronizadas' : ' de exemplo'}` }],
    store().project, store().assets,
  ).ops;
  const appliedIds = await apply(ops, { delayMs: 300 });
  const reply = real
    ? `Pronto! Gerei ${segs.length} legendas sincronizadas com a fala. Quer mudar o estilo (ex.: "legendas estilo TikTok")?`
    : `Coloquei ${segs.length} legendas de exemplo nos trechos de fala (sem transcrição desta vez).`;
  return { reply, ops, appliedIds, provider: status.provider, warnings };
}

/* ---------- chat ---------- */

async function demoChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {
  let silences: Record<Id, Range[]> | undefined;
  if (demoNeeds(text).silences) {
    opts.onStatus?.('Ouvindo o áudio…');
    const used = onTimeline(store().project);
    silences = await silencesFor(sourceAssets(store().assets).filter((a) => a.kind !== 'image' && used.has(a.id)));
  }
  const r = chatIntent(text, { project: store().project, assets: store().assets, silencesByAsset: silences });
  if (r.undo) {
    store().undo();
    return { reply: r.reply, ops: [], appliedIds: [], provider: 'demo', undo: true, warnings: [] };
  }
  const { ops } = sanitizeOps(r.ops, store().project, store().assets);
  const appliedIds = ops.length ? await apply(ops) : [];
  return { reply: r.reply, ops, appliedIds, provider: 'demo', warnings: [] };
}

async function claudeChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {
  opts.onStatus?.('Pensando…');
  try {
    const s = store();
    const frames = await sourceFrames(sourceAssets(s.assets), false, 6);
    const res = await requestEdit({ project: s.project, assets: s.assets, messages: s.messages, userText: text, mode: 'chat', frames });
    const { ops } = sanitizeOps(res.ops, store().project, store().assets);
    if (ops.length) opts.onStatus?.('Editando…');
    const appliedIds = ops.length ? await apply(ops) : [];
    return { reply: res.reply, ops, appliedIds, provider: 'anthropic', warnings: [] };
  } catch (e) {
    // IA indisponível: tenta o intérprete local antes de desistir
    const local = chatIntent(text, { project: store().project, assets: store().assets });
    if (local.ops.length) {
      const { ops } = sanitizeOps(local.ops, store().project, store().assets);
      const appliedIds = ops.length ? await apply(ops) : [];
      return { reply: `${local.reply} (A IA falhou: ${errText(e)} — usei o modo local.)`, ops, appliedIds, provider: 'demo', warnings: [errText(e)] };
    }
    throw e;
  }
}

export async function chatEdit(text: string, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  return withSingleUndo(async () => {
    // timeline vazia mas com material enviado: coloca o material antes de editar
    if (!allClips(store().project).some((c) => c.type !== 'text')) {
      const pre = prelimOps(store().project, store().assets, '');
      if (pre.length) await apply(pre, { delayMs: 260 });
    }
    return status.configured ? claudeChat(text, apply, opts) : demoChat(text, apply, opts);
  });
}

/** duração útil p/ UI */
export function timelineDuration(): number {
  return projectDuration(store().project);
}
