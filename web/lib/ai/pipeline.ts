/* =====================================================================
   Pipeline da IA (navegador): orquestra upload -> análise do exemplo ->
   transcrição -> pedido de edição -> aplicação AO VIVO (store.applyLive).
   Funciona com Gemini (rotas /api/ai/*) ou no MODO DEMO (local, sem custo).
   ===================================================================== */
import type { CaptionSegment, Clip, Id, MediaAsset, Project, StyleProfile } from '../types';
import { clipEnd, projectDuration, type EditOp } from '../ops';
import { makeAudioClip, makeImageClip, makeVideoClip } from '../defaults';
import { useEditor } from '../store';
import {
  AIClientError, analyzeReference, getStatus, requestEdit, transcribe, uploadForAI, type AIStatus,
} from './client';
import { analyzeReferenceLocal, silencesFor } from './analysis';
import { chatIntent, demoCaptions, demoNeeds, planFirstEdit, speechRanges, type Range } from './demo';
import { captionsMediaToTimeline } from './timemap';
import { sanitizeOps } from './validate';

export interface PipelineOptions {
  /** narração do que está acontecendo agora ("Transcrevendo…"), com progresso 0..1 opcional */
  onStatus?: (text: string, progress?: number) => void;
  /** etapa concluída (vira um ✓ no chat) */
  onLog?: (text: string) => void;
  /** aplica um lote de ops ao vivo; padrão = store.applyLive */
  apply?: (ops: EditOp[], opts?: { delayMs?: number }) => Promise<Id[]>;
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

/** ops que colocam o material bruto na timeline (se ainda não estiver) + brief/referência */
export function prelimOps(p: Project, assets: Record<Id, MediaAsset>, brief: string): EditOp[] {
  const ops: EditOp[] = [];
  const patch: Record<string, unknown> = {};
  if (brief && brief !== p.brief) patch.brief = brief;
  const ref = referenceAsset(assets, p);
  if (ref && p.referenceAssetId !== ref.id) patch.referenceAssetId = ref.id;
  if (Object.keys(patch).length) ops.push({ op: 'set_project', patch, explain: 'Guardando o seu pedido' });

  const used = new Set(allClips(p).map((c) => ('assetId' in c ? c.assetId : '')));
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

async function blobOf(a: MediaAsset): Promise<Blob> {
  if (!a.url) throw new AIClientError(`A mídia "${a.name}" não está carregada.`, 400, 'no_url');
  const res = await fetch(a.url);
  if (!res.ok) throw new AIClientError(`Não consegui ler "${a.name}".`, 400, 'no_blob');
  return res.blob();
}

/** garante que o asset foi enviado ao Gemini (guarda aiFileUri no store) */
async function ensureUploaded(a: MediaAsset, onProgress?: (f: number) => void, force = false): Promise<MediaAsset> {
  const cur = store().assets[a.id] ?? a;
  if (cur.aiFileUri && !force) return cur;
  const { uri, mime } = await uploadForAI(cur, await blobOf(cur), onProgress);
  store().updateAsset(cur.id, { aiFileUri: uri, aiFileMime: mime });
  return { ...cur, aiFileUri: uri, aiFileMime: mime };
}

/** chama `fn` com o asset enviado; se o arquivo expirou no provedor, reenvia uma vez */
async function withFile<T>(a: MediaAsset, fn: (a: MediaAsset) => Promise<T>, onProgress?: (f: number) => void): Promise<T> {
  const up = await ensureUploaded(a, onProgress);
  try {
    return await fn(up);
  } catch (e) {
    if (e instanceof AIClientError && (e.code === 'file_gone' || e.code === 'not_uploaded')) return fn(await ensureUploaded(a, onProgress, true));
    throw e;
  }
}

async function uploadAll(list: MediaAsset[], opts: PipelineOptions): Promise<MediaAsset[]> {
  const pending = list.filter((a) => !store().assets[a.id]?.aiFileUri);
  if (!pending.length) return list.map((a) => store().assets[a.id] ?? a);
  const prog = new Map<Id, number>();
  const report = () => {
    const f = [...prog.values()].reduce((x, y) => x + y, 0) / pending.length;
    opts.onStatus?.(`Enviando ${pending.length > 1 ? `${pending.length} arquivos` : `"${pending[0].name}"`} para a IA… ${Math.round(f * 100)}%`, f);
  };
  report();
  await Promise.all(pending.map((a) => ensureUploaded(a, (f) => { prog.set(a.id, f); report(); })));
  opts.onLog?.(pending.length > 1 ? `${pending.length} arquivos enviados` : `"${pending[0].name}" enviado`);
  return list.map((a) => store().assets[a.id] ?? a);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** transcreve (Gemini) e converte para tempos da timeline conforme os clipes atuais */
async function transcribeToTimeline(sources: MediaAsset[], language: string, opts: PipelineOptions): Promise<CaptionSegment[]> {
  const segs: CaptionSegment[] = [];
  for (const a of sources.filter((x) => x.kind !== 'image')) {
    opts.onStatus?.(sources.length > 1 ? `Transcrevendo "${a.name}"…` : 'Transcrevendo a fala…');
    const media = await withFile(a, (up) => transcribe(up, language));
    segs.push(...captionsMediaToTimeline(store().project, a.id, media));
  }
  return segs.sort((x, y) => x.start - y.start);
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

    if (status.configured) {
      const media = sources.filter((a) => a.kind !== 'image');
      let uploaded: MediaAsset[] = [];
      try {
        uploaded = await uploadAll([...media, ...(ref ? [ref] : [])], opts);
      } catch (e) {
        throw new AIClientError(`Não consegui enviar o material para a IA: ${errText(e)}`, 502, 'upload_failed');
      }

      if (ref) {
        opts.onStatus?.('Analisando seu vídeo-exemplo…');
        try {
          const style = await withFile(ref, analyzeReference);
          await apply([{ op: 'set_project', patch: { style }, explain: 'Guardando o estilo do vídeo-exemplo' }], { delayMs: 200 });
          opts.onLog?.(`Vídeo-exemplo analisado: ${style.summary}`);
        } catch (e) {
          warnings.push(`não analisei o vídeo-exemplo (${errText(e)})`);
          opts.onLog?.('Não consegui analisar o vídeo-exemplo — sigo sem ele');
        }
      }

      if (!store().project.captions.segments.length && !/sem legenda/i.test(brief)) {
        try {
          const segs = await transcribeToTimeline(media, store().project.captions.language || 'pt-BR', opts);
          if (segs.length) {
            await apply([{ op: 'set_captions', segments: segs, language: store().project.captions.language || 'pt-BR', explain: `Colocando ${segs.length} legendas sincronizadas` }], { delayMs: 300 });
            opts.onLog?.(`Fala transcrita: ${segs.length} legendas`);
          } else opts.onLog?.('Não encontrei fala para legendar');
        } catch (e) {
          warnings.push(`sem legendas (${errText(e)})`);
          opts.onLog?.('A transcrição falhou — sigo sem legendas');
        }
      }

      opts.onStatus?.('Planejando a edição…');
      const p = store().project;
      const res = await requestEdit({
        project: p, assets: store().assets, messages: store().messages, userText: brief || 'Edite este vídeo de forma profissional.',
        mode: 'first',
        media: uploaded.filter((a) => a.role === 'source' && a.aiFileUri).map((a) => ({ uri: a.aiFileUri!, mime: a.aiFileMime || a.mime })),
      });
      const { ops } = sanitizeOps(res.ops, store().project, store().assets);
      opts.onStatus?.('Editando…');
      const appliedIds = ops.length ? await apply(ops) : [];
      return { reply: res.reply, ops, appliedIds, provider: 'gemini' as const, warnings };
    }

    // ----- modo demo -----
    let style: StyleProfile | undefined = store().project.style;
    if (ref && !style) {
      opts.onStatus?.('Analisando o ritmo do seu vídeo-exemplo…');
      style = await analyzeReferenceLocal(ref, (f) => opts.onStatus?.(`Analisando o ritmo do seu vídeo-exemplo… ${Math.round(f * 100)}%`, f));
      if (style) {
        await apply([{ op: 'set_project', patch: { style }, explain: 'Guardando o estilo do vídeo-exemplo' }], { delayMs: 200 });
        opts.onLog?.(`Vídeo-exemplo analisado: ${style.summary}`);
      }
    }
    opts.onStatus?.('Ouvindo o áudio para achar as pausas…');
    const silences = await silencesFor(sources.filter((a) => a.kind !== 'image'));
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
  const sources = sourceAssets(store().assets).filter((a) => a.kind !== 'image');
  const onTimeline = new Set(allClips(store().project).map((c) => ('assetId' in c ? c.assetId : '')));
  const used = sources.filter((a) => onTimeline.has(a.id));
  if (!used.length) throw new AIClientError('Coloque o vídeo na timeline antes de gerar legendas.', 400, 'no_source');

  let segs: CaptionSegment[];
  if (status.configured) {
    await uploadAll(used, opts);
    segs = await transcribeToTimeline(used, language, opts);
  } else {
    opts.onStatus?.('Ouvindo o áudio…');
    const silences = await silencesFor(used);
    const speech: Record<Id, Range[]> = {};
    for (const a of used) speech[a.id] = speechRanges(silences[a.id] ?? [], a.duration);
    segs = demoCaptions(store().project, speech, store().project.brief);
  }
  if (!segs.length) return { reply: 'Não encontrei fala para legendar neste vídeo.', ops: [], appliedIds: [], provider: status.provider, warnings: [] };
  const ops = sanitizeOps(
    [{ op: 'set_captions', segments: segs, language, explain: `Colocando ${segs.length} legendas${status.configured ? ' sincronizadas' : ' de exemplo'}` }],
    store().project, store().assets,
  ).ops;
  const appliedIds = await apply(ops, { delayMs: 300 });
  const reply = status.configured
    ? `Pronto! Gerei ${segs.length} legendas sincronizadas com a fala. Quer mudar o estilo (ex.: "legendas estilo TikTok")?`
    : `Coloquei ${segs.length} legendas de exemplo nos trechos de fala (modo demo — conecte o Gemini para a transcrição real).`;
  return { reply, ops, appliedIds, provider: status.provider, warnings: [] };
}

/* ---------- chat ---------- */

async function demoChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {
  let silences: Record<Id, Range[]> | undefined;
  if (demoNeeds(text).silences) {
    opts.onStatus?.('Ouvindo o áudio…');
    const onTimeline = new Set(allClips(store().project).map((c) => ('assetId' in c ? c.assetId : '')));
    silences = await silencesFor(sourceAssets(store().assets).filter((a) => a.kind !== 'image' && onTimeline.has(a.id)));
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

export async function chatEdit(text: string, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  return withSingleUndo(async () => {
    // timeline vazia mas com material enviado: coloca o material antes de editar
    if (!allClips(store().project).some((c) => c.type !== 'text')) {
      const pre = prelimOps(store().project, store().assets, '');
      if (pre.length) await apply(pre, { delayMs: 260 });
    }
    return status.configured ? geminiChat(text, apply, opts) : demoChat(text, apply, opts);
  });
}

async function geminiChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {

  opts.onStatus?.('Pensando…');
  try {
    const s = store();
    const media = sourceAssets(s.assets)
      .filter((a) => a.aiFileUri && a.kind !== 'image')
      .map((a) => ({ uri: a.aiFileUri!, mime: a.aiFileMime || a.mime }));
    const res = await requestEdit({ project: s.project, assets: s.assets, messages: s.messages, userText: text, mode: 'chat', media });
    const { ops } = sanitizeOps(res.ops, store().project, store().assets);
    if (ops.length) opts.onStatus?.('Editando…');
    const appliedIds = ops.length ? await apply(ops) : [];
    return { reply: res.reply, ops, appliedIds, provider: 'gemini', warnings: [] };
  } catch (e) {
    // Gemini indisponível: tenta o intérprete local antes de desistir
    const local = chatIntent(text, { project: store().project, assets: store().assets });
    if (local.ops.length) {
      const { ops } = sanitizeOps(local.ops, store().project, store().assets);
      const appliedIds = ops.length ? await apply(ops) : [];
      return { reply: `${local.reply} (O Gemini falhou: ${errText(e)} — usei o modo local.)`, ops, appliedIds, provider: 'demo', warnings: [errText(e)] };
    }
    throw e;
  }
}

/** duração útil p/ UI */
export function timelineDuration(): number {
  return projectDuration(store().project);
}

