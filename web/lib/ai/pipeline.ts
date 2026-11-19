/* =====================================================================
   Pipeline da IA (navegador): orquestra análise do exemplo (quadros) ->
   transcrição (Whisper local) -> pedido de edição (Claude) -> aplicação
   AO VIVO (store.applyLive). Sem chave: MODO DEMO (local, sem custo).
   ===================================================================== */
import type { CaptionSegment, ChatContext, Clip, ColorGrade, Id, MediaAsset, Project, StyleProfile } from '../types';
import { applyOps, clipEnd, projectDuration, type EditOp } from '../ops';
import { makeAudioClip, makeImageClip, makeVideoClip } from '../defaults';
import { useEditor } from '../store';
import { AIClientError, analyzeReference, getStatus, requestEdit, translateSegments, type AIStatus, type EditFrame } from './client';
import { beatsOf, colorStatsOf, sampleReference, silencesFor } from './analysis';
import { colorGradeOps, matchColorGrade } from './colormatch';
import { CAPTION_ADD, canonVerbs, chatIntent, demoNeeds, planFirstEdit, silenceCutOps, silenceOptsFromText, speechRanges, type Range } from './demo';
import { deviceProfile, framesFromThumbnails, sampleVideo } from './frames';
import { captionsMediaToTimeline } from './timemap';
import { sanitizeOps } from './validate';
import { chooseWhisper, transcribeMedia, type TranscribeInfo } from './whisper';
import { captionsNeedTranscription } from './legacyCaptions';
import { beatSyncOps, emphasisZoomOps, fillerOps, reframeOps } from './features';
import { trackSubject } from './reframe';
import { distributeWords } from './sanitize';
import { describeStyle, modelRequestText, styleOps, styleScopeFromText, type StyleScope } from './model';
import { materializeSfx, sanitizeSfxRequests, type SfxRequest } from './library';
import { asOwn, isAbort as isRunAbort } from './runGuard';
import { finalizeClaude, type FinalizeDeps, type Finalized } from './finalize';
import { runScript } from './script/run';
import { createGraphicAsset, updateGraphicAsset } from './svg';
import { isVisualChange, renderResultFrames, reviewEnabled, reviewTimes } from './review';
import type { EditResponse } from './client';
import { backgroundMusicClips, catalogIdOf, catalogMusicOps, catalogMusicOpsById, chatMusicRequest, needsCatalogMusic, userMusic } from './catalogMusic';

/** acrescenta às ops os AudioClips dos efeitos sonoros pedidos (gera o WAV no aparelho) */
async function withSfx(ops: EditOp[], sfx: SfxRequest[] | undefined, onStatus?: (s: string) => void): Promise<EditOp[]> {
  const all = sanitizeSfxRequests(sfx, Math.max(projectDuration(store().project), 1) + 600);
  const musicReq = all.find((r) => r.sfxId.startsWith('music:'));
  const reqs = all.filter((r) => !r.sfxId.startsWith('music:'));
  // faixa do catálogo escolhida pela IA (add_music): só se o usuário não mandou música nem há trilha
  if (musicReq) {
    const sim = applyOps(store().project, ops).project;
    if (!userMusic(store().assets).length && !backgroundMusicClips(sim, store().assets).length) {
      const m = await catalogMusicOpsById(musicReq.sfxId.slice(6), sim, { onStatus });
      if (m) ops = [...ops, ...sanitizeOps(m.ops, sim, store().assets).ops];
    }
  }
  if (!reqs.length) return ops;
  onStatus?.('Gerando efeitos sonoros…');
  try {
    const after = applyOps(store().project, ops).project;
    return [...ops, ...(await materializeSfx(reqs, after, (p, o) => applyOps(p, o).project))];
  } catch {
    return ops; // sem WebAudio (ex.: navegador antigo): segue sem os sons
  }
}

/* ---------- resposta do Claude: conserto, adiados, conferência ---------- */

export const finalizeDeps: FinalizeDeps = {
  request: (r) => requestEdit(r),
  runScript: (code, p, a) => runScript(code, p, a),
  createGraphic: (svg, name, p) => createGraphicAsset(svg, name, p),
  updateGraphic: (id, svg, p) => updateGraphicAsset(id, svg, p),
};

/** valida + executa script/gráficos + 1 rodada de conserto; devolve as ops prontas (com SFX) */
async function claudeOps(res: EditResponse, userText: string, opts: PipelineOptions): Promise<Finalized> {
  const f = await finalizeClaude(res, store().project, {
    ...finalizeDeps, userText, getAssets: () => store().assets, messages: store().messages, context: opts.context, signal: opts.signal, onStatus: (t) => opts.onStatus?.(t),
  });
  return { ...f, ops: await withSfx(f.ops, f.sfx, opts.onStatus) };
}

/** depois de aplicar: legendas pedidas pela IA, erros que sobraram e a conferência visual */
async function afterClaude(f: Finalized, before: Project, userText: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions, warnings: string[]): Promise<string> {
  const notes: string[] = [];
  if (f.captions && captionsNeedTranscription(store().project)) {
    try {
      const r = await generateCaptions({ ...opts, apply, language: f.captions.language });
      if (r.ops.length) notes.push(r.reply);
    } catch (e) { if (isRunAbort(e)) throw e; warnings.push(`legendas: ${errText(e)}`); }
  }
  if (f.errors.length) {
    warnings.push(...f.errors);
    notes.push(`Algumas partes não deram certo${f.repaired ? ' nem depois do conserto' : ''}: ${f.errors.slice(0, 3).join('; ')}`);
  }
  const reviewed = await reviewPass(before, userText, apply, opts);
  if (reviewed) notes.push(reviewed);
  return notes.length ? `\n${notes.join('\n')}` : '';
}

/** "Conferindo o resultado…": renderiza quadros do resultado e deixa o Claude ajustar (1 rodada) */
async function reviewPass(before: Project, userText: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<string | null> {
  const after = store().project;
  if (!reviewEnabled() || !isVisualChange(before, after)) return null;
  try {
    opts.onStatus?.('Conferindo o resultado…');
    const frames = await renderResultFrames(after, store().assets, reviewTimes(before, after));
    if (!frames.length) return null;
    const s = store();
    const res = await requestEdit({ project: s.project, assets: s.assets, messages: s.messages, userText, mode: 'review', frames, context: opts.context, signal: opts.signal });
    if (res.ok || (!res.ops.length && !res.deferred?.length)) return null;
    const f = await finalizeClaude(res, store().project, {
      ...finalizeDeps, userText, getAssets: () => store().assets, messages: store().messages, context: opts.context, signal: opts.signal, onStatus: (t) => opts.onStatus?.(t), repair: false,
    });
    const ops = await withSfx(f.ops, f.sfx, opts.onStatus);
    if (!ops.length) return null;
    opts.onStatus?.('Ajustando…');
    await apply(ops);
    return `Conferi o resultado e ajustei: ${res.reply}`;
  } catch (e) {
    if (isRunAbort(e)) throw e;
    console.warn('[ai] conferência do resultado falhou:', e);
    return null;
  }
}

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
  /** para onde o usuário apontou (clipe, trecho, ponto, legenda) */
  context?: ChatContext;
  /** execução interrompida (Parar, desfazer, edição manual, projeto trocado) */
  signal?: AbortSignal;
}

export interface PipelineResult {
  reply: string;
  ops: EditOp[];
  appliedIds: Id[];
  provider: AIStatus['provider'];
  /** o pedido era "desfazer" (demo) */
  undo?: boolean;
  warnings: string[];
  /** botões oferecidos depois da resposta (ex.: "Tentar transcrever de novo") — id tratado pelo chat */
  actions?: AskOption[];
}

/** "coloque legenda" deve transcrever? sem legenda, legenda antiga de exemplo ou texto que não é a fala (exceto tradução) */
function captionsWantTranscription(p: Project): boolean {
  return captionsNeedTranscription(p) || (!!p.captions.source && p.captions.source !== 'transcription' && p.captions.source !== 'translation');
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
  return new Set(allClips(p).map((c) => ('assetId' in c && c.assetId ? c.assetId : '')));
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
    // ponto de corte pela identidade (funciona com o histórico no limite de 100 passos);
    // projeto trocado no meio: não mexe no histórico do outro
    const i = s.past.lastIndexOf(projectBefore);
    if (s.project !== projectBefore && s.project.id === projectBefore.id) {
      if (i >= 0 && i < s.past.length - 1) useEditor.setState({ past: s.past.slice(0, i + 1), future: [] });
      else if (i < 0 && s.past.length >= pastBefore.length + 2) useEditor.setState({ past: [...pastBefore, projectBefore].slice(-100), future: [] });
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

/* ---------- transcrição (Whisper no navegador / servidor) ---------- */

/** mídias já transcritas nesta sessão (tempos DA MÍDIA): refazer a edição reaproveita, sem pular a legenda.
 *  Falha NÃO entra aqui: a próxima tentativa transcreve de novo. */
const transcribed = new Map<string, { segs: CaptionSegment[]; info?: TranscribeInfo }>();
const triedTranscription = { delete: (k: string) => transcribed.delete(k) };

/** por que não saiu legenda (a resposta do chat diz o motivo REAL e oferece o botão certo) */
export type CaptionMissReason = 'skipped' | 'failed' | 'cc-off' | 'no-speech' | 'no-media';

/** o que a transcrição produziu além das legendas: quem transcreveu e, se falhou, por quê */
export interface CaptionRun { info?: TranscribeInfo; reason?: CaptionMissReason; error?: string }

/** "Legendas: alta precisão (Groq)…" — de onde veio a legenda, dito no chat */
export function providerLine(info: TranscribeInfo | undefined): string | null {
  if (!info || info.label === 'sem fala') return null;
  if (info.mode === 'server') return `Legendas em alta precisão (${info.label}) — o áudio foi enviado para transcrição.`;
  if (info.mode === 'mixed') return `Legendas em alta precisão (${info.label.split(' + ')[0]}); ${info.localPieces} trecho${(info.localPieces ?? 0) > 1 ? 's' : ''} feito${(info.localPieces ?? 0) > 1 ? 's' : ''} no aparelho.`;
  return `Legendas transcritas no aparelho (${info.label}, menos preciso que a transcrição no servidor).`;
}

/** op de legendas vindas da FALA (origem e modelo gravados no projeto) */
function speechCaptionsOp(segs: CaptionSegment[], language: string, run: CaptionRun, explain: string): EditOp {
  return { op: 'set_captions', segments: segs, language, source: 'transcription', ...(run.info?.label && run.info.label !== 'sem fala' ? { model: run.info.label } : {}), explain };
}

/** transcreve as fontes com Whisper e converte p/ tempos da timeline. null = pulada/falhou/desligada (motivo em `run`). */
async function whisperCaptions(sources: MediaAsset[], language: string, opts: PipelineOptions, warnings: string[], run: CaptionRun = {}): Promise<CaptionSegment[] | null> {
  const all = sources.filter((a) => (a.kind === 'video' || a.kind === 'audio') && a.url);
  if (!all.length) { run.reason = 'no-media'; return null; }
  const key = (a: MediaAsset) => `${a.id}|${a.url}`;
  // já transcritas: só remapeia para a timeline atual (cortes/velocidade podem ter mudado)
  const cached = all.filter((a) => transcribed.has(key(a)));
  const media = all.filter((a) => !transcribed.has(key(a)));
  const fromCache = () => cached.flatMap((a) => { const c = transcribed.get(key(a))!; if (c.info) run.info = c.info; return captionsMediaToTimeline(store().project, a.id, c.segs); });
  if (!media.length) {
    const segs = fromCache().sort((x, y) => x.start - y.start);
    if (!segs.length) run.reason = 'no-speech';
    return segs;
  }
  const server = !!(await getStatus()).transcribe; // Whisper large no servidor: não baixa nada no aparelho
  if (!server && opts.whisper === false) {
    run.reason = 'cc-off';
    warnings.push('sem transcrição (a transcrição no aparelho está desligada no botão CC)');
    opts.onLog?.('Transcrição desligada no botão CC');
    return null;
  }
  const dev = deviceProfile();
  const total = media.reduce((n, a) => n + (a.duration || 0), 0);
  const choice = await chooseWhisper();
  // aparelho fraco ou áudio longo no celular: pergunta antes de baixar/processar
  if (!server && opts.ask && (dev.weak || (dev.mobile && total > 600))) {
    const pick = await opts.ask(
      `Para legendar, transcrevo a fala aqui no aparelho (${choice.label}, ~${choice.sizeMB} MB na 1ª vez${total > 120 ? `, ${Math.round(total / 60)} min de áudio` : ''}). Neste aparelho pode demorar.`,
      [{ id: 'go', label: `Transcrever (~${choice.sizeMB} MB)` }, { id: 'skip', label: 'Pular legendas' }],
    );
    if (pick !== 'go') {
      run.reason = 'skipped';
      opts.onLog?.('Transcrição pulada (você escolheu "Pular legendas")');
      return null;
    }
  }
  const signal = opts.skippable?.('Pular transcrição');
  try {
    const segs: CaptionSegment[] = fromCache();
    for (const a of media) {
      let info: TranscribeInfo | undefined;
      const mediaSegs = await transcribeMedia(a, { language, choice, signal, onInfo: (i) => { info = i; }, onStatus: (t, f) => opts.onStatus?.(media.length > 1 ? `${t} ("${a.name}")` : t, f) });
      transcribed.set(key(a), { segs: mediaSegs, info });
      if (info && info.label !== 'sem fala') run.info = info;
      segs.push(...captionsMediaToTimeline(store().project, a.id, mediaSegs));
    }
    const line = providerLine(run.info);
    if (line && segs.length) opts.onLog?.(line);
    if (!segs.length) run.reason = 'no-speech';
    return segs.sort((x, y) => x.start - y.start);
  } catch (e) {
    if (isAbort(e)) {
      if (opts.signal?.aborted) throw e; // Parar/desfazer: a execução inteira para
      run.reason = 'skipped';
      opts.onLog?.('Transcrição pulada (você tocou em "Pular transcrição")');
      return null;
    }
    run.reason = 'failed';
    run.error = errText(e);
    warnings.push(`sem transcrição (${errText(e)})`);
    opts.onLog?.(`A transcrição falhou (${errText(e)})`);
    return null;
  } finally {
    opts.skippable?.(null);
  }
}

/** texto e botões honestos quando não saiu legenda */
export function captionMissReply(run: CaptionRun): { text: string; actions: AskOption[] } {
  const retry = { id: 'captions:retry', label: 'Tentar transcrever de novo' };
  const manual = { id: 'captions:manual', label: 'Escrever manualmente' };
  switch (run.reason) {
    case 'cc-off':
      return { text: 'Não coloquei legendas porque a transcrição no aparelho está desligada (botão CC). Legenda inventada não serve: ela tem que ser a sua fala.', actions: [{ id: 'captions:cc', label: 'Ligar CC e transcrever' }, manual] };
    case 'skipped':
      return { text: 'A transcrição foi pulada, então não coloquei legendas.', actions: [retry, manual] };
    case 'no-speech':
      return { text: 'Não encontrei fala para legendar neste vídeo (só silêncio, música ou ruído).', actions: [retry, manual] };
    case 'no-media':
      return { text: 'Não há áudio/vídeo carregado na timeline para transcrever.', actions: [manual] };
    default:
      return { text: `Não consegui transcrever a fala${run.error ? ` (${run.error})` : ''}, então não coloquei legendas — legenda inventada não serve.`, actions: [retry, manual] };
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

    // 2) legendas reais: a FALA transcrita (servidor ou Whisper no aparelho) — legenda antiga de exemplo também é refeita
    const media = sources.filter((a) => a.kind !== 'image');
    let capRun: CaptionRun | null = null;
    if (captionsNeedTranscription(store().project) && !/sem legenda/i.test(brief)) {
      const lang = store().project.captions.language || 'pt-BR';
      capRun = {};
      const segs = await whisperCaptions(media, lang, opts, warnings, capRun);
      if (segs?.length) {
        await apply([speechCaptionsOp(segs, lang, capRun, `Colocando ${segs.length} legendas no ritmo da fala`)], { delayMs: 300 });
        opts.onLog?.(`Fala transcrita: ${segs.length} frases`);
      } else if (segs) opts.onLog?.('Não encontrei fala para legendar');
    }
    const capNote = () => {
      if (!capRun || store().project.captions.segments.length) return '';
      const miss = captionMissReply(capRun);
      return `\n${miss.text}`;
    };
    const capActions = () => (capRun && !store().project.captions.segments.length ? captionMissReply(capRun).actions : undefined);

    // batidas da música (p/ cortes na batida), se houver música
    if (Object.values(store().assets).some((a) => a.role === 'music')) {
      const music = Object.values(store().assets).filter((a) => a.role === 'music' && !a.beats?.length && a.url);
      for (const a of music) {
        opts.onStatus?.(`Ouvindo as batidas de "${a.name}"…`);
        const beats = await beatsOf(a);
        if (beats.length) { store().updateAsset(a.id, { beats }); opts.onLog?.(`Música analisada: ${beats.length} batidas`); }
      }
    }

    if (status.configured) {
      opts.onStatus?.('Planejando a edição…');
      const frames = await sourceFrames(sources, true, 10);
      const res = await requestEdit({
        project: store().project, assets: store().assets, messages: store().messages, mode: 'first', frames, signal: opts.signal,
        userText: brief || 'Edite este vídeo de forma profissional.',
      });
      const userText = brief || 'Edite este vídeo de forma profissional.';
      const fin = await claudeOps(res, userText, opts);
      let ops = fin.ops;
      let reply = fin.reply;
      const before = store().project;
      // pediu música e não mandou arquivo: faixa do catálogo gerado por código
      const simC = applyOps(store().project, ops).project;
      if (needsCatalogMusic(brief, simC, store().assets)) {
        const m = await catalogMusicOps(brief, simC, { onStatus: opts.onStatus });
        if (m) {
          const r = sanitizeOps(m.ops, simC, store().assets);
          if (r.ops.length) { ops = [...ops, ...r.ops]; reply = `${reply}\nColoquei a música “${m.name}” do catálogo de músicas livres (sem direitos autorais). Para trocar, diga "troca a música" ou escolha outra em Áudio → Músicas livres.`; }
        }
      }
      opts.onStatus?.('Editando…');
      const appliedIds = ops.length ? await apply(ops) : [];
      reply += await afterClaude(fin, before, userText, apply, opts, warnings);
      return { reply: reply + capNote(), ops, appliedIds, provider: 'anthropic' as const, warnings, actions: capActions() };
    }

    // ----- modo demo -----
    opts.onStatus?.('Ouvindo o áudio para achar as pausas…');
    const silences = await silencesFor(media, silenceOptsFromText(brief));
    const nSil = Object.values(silences).reduce((n, r) => n + r.length, 0);
    opts.onLog?.(nSil ? `Áudio analisado: ${nSil} pausa${nSil > 1 ? 's' : ''} encontrada${nSil > 1 ? 's' : ''}` : 'Áudio analisado');
    opts.onStatus?.('Planejando a edição…');
    const plan = planFirstEdit({ project: store().project, assets: store().assets, brief, silencesByAsset: silences, style });
    const first = sanitizeOps(plan.ops, store().project, store().assets);
    let ops = first.ops;
    let reply = plan.reply;
    // estilo CapCut: vícios de linguagem (pelas palavras) e cortes na batida, quando fizer sentido
    const b = norm(brief);
    const fast = /dinamic|rapid|tiktok|reels|shorts|viral/.test(b) || style?.pacing === 'fast' || style?.pacing === 'very-fast';
    let sim = first.project;
    // pediu música e não mandou arquivo: faixa do catálogo (antes do "na batida", que usa as batidas dela)
    if (needsCatalogMusic(brief, sim, store().assets)) {
      const m = await catalogMusicOps(brief, sim, { onStatus: opts.onStatus });
      if (m) {
        const r = sanitizeOps(m.ops, sim, store().assets);
        if (r.ops.length) {
          ops = [...ops, ...r.ops]; sim = r.project;
          reply = reply.replace(/\s*Você pediu música, mas não recebi nenhuma trilha[^\n]*?(abaixando na fala\.)/, '').replace(/\nObs\.:\s*$/, '');
          reply = `${reply}\nColoquei a música “${m.name}” do catálogo de músicas livres (sem direitos autorais).`;
        }
      }
    }
    if ((fast || /vicio|muleta|limp/.test(b)) && !/sem cort/.test(b)) {
      const f = fillerOps(sim);
      if (f.ops.length) {
        const r = sanitizeOps(f.ops, sim, store().assets);
        ops = [...ops, ...r.ops]; sim = r.project;
        reply = reply.replace('Pronto! Editei no modo demonstração: ', `Pronto! Editei no modo demonstração: cortei ${f.count} vício${f.count > 1 ? 's' : ''} de linguagem, `);
      }
    }
    if (/batida|beat|ritmo da musica|no ritmo/.test(b)) {
      const bs = beatSyncOps(sim, store().assets, fast ? 0.6 : 1);
      if (bs.ops.length) {
        const r = sanitizeOps(bs.ops, sim, store().assets);
        ops = [...ops, ...r.ops]; sim = r.project;
        reply = reply.replace('Pronto! Editei no modo demonstração: ', `Pronto! Editei no modo demonstração: ${bs.cuts} cortes na batida, `);
      }
    }
    opts.onStatus?.('Editando…');
    const appliedIds = ops.length ? await apply(ops) : [];
    return { reply: reply + capNote(), ops, appliedIds, provider: 'demo' as const, warnings, actions: capActions() };
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
  // pedido explícito do usuário: pode tentar de novo
  for (const a of used) triedTranscription.delete(`${a.id}|${a.url}`);

  const run: CaptionRun = {};
  const segs = await whisperCaptions(used, language, opts, warnings, run);
  if (!segs?.length) {
    // legenda é SEMPRE a fala de verdade: sem transcrição, explica o motivo real em vez de inventar texto
    const miss = captionMissReply(run);
    return { reply: miss.text, ops: [], appliedIds: [], provider: status.provider, warnings, actions: miss.actions };
  }
  const replaced = store().project.captions.segments.length > 0;
  const ops = sanitizeOps([speechCaptionsOp(segs, language, run, `Colocando ${segs.length} legendas no ritmo da fala`)], store().project, store().assets).ops;
  const appliedIds = await apply(ops, { delayMs: 300 });
  const reply = `Pronto! ${replaced ? 'Refiz as legendas pela fala' : 'Gerei as legendas com a fala'}: ${segs.length} frases, cada palavra no tempo em que é dita. Quer mudar o estilo (ex.: "legendas estilo TikTok")?`;
  return { reply, ops, appliedIds, provider: status.provider, warnings };
}

/* ---------- chat ---------- */

async function demoChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {
  // "reedite seguindo o estilo do vídeo modelo" (+ "só as legendas/ritmo/cores")
  const st = store().project.style;
  if (st && /(estilo|ritmo|cores|legendas?) do (video )?(modelo|exemplo)|video modelo|igual ao modelo/.test(norm(text))) {
    const scope = styleScopeFromText(text) ?? 'all';
    // cor: combina com as cores medidas do modelo (ColorGrade); sem modelo legível, usa o preset do perfil
    const grade = scope === 'all' || scope === 'colors' ? await matchColorOps(opts) : null;
    const graded = !!grade?.ops.length;
    const styled = styleOps(store().project, st, scope);
    const rest = graded ? styled.ops.filter((o) => !(o.op === 'update_clip' && 'colorPreset' in o.patch)) : styled.ops;
    const raw = graded ? [...grade!.ops, ...rest] : rest;
    const said = graded ? ['cor combinada com o modelo', ...styled.said.filter((x) => !/^cores |cores naturais/.test(x))] : styled.said;
    const { ops } = sanitizeOps(raw, store().project, store().assets);
    const appliedIds = ops.length ? await apply(ops) : [];
    const msg = said.length ? said.join(', ') : 'nada a mudar';
    return { reply: ops.length ? `Feito, no estilo do modelo: ${msg}.` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`, ops, appliedIds, provider: 'demo', warnings: [] };
  }
  let silences: Record<Id, Range[]> | undefined;
  if (demoNeeds(text).silences) {
    opts.onStatus?.('Ouvindo o áudio…');
    const used = onTimeline(store().project);
    silences = await silencesFor(sourceAssets(store().assets).filter((a) => a.kind !== 'image' && used.has(a.id)), silenceOptsFromText(text));
  }
  const r = chatIntent(text, { project: store().project, assets: store().assets, silencesByAsset: silences, target: opts.context });
  if (r.undo) {
    asOwn(() => store().undo());
    return { reply: r.reply, ops: [], appliedIds: [], provider: 'demo', undo: true, warnings: [] };
  }
  const san = sanitizeOps(r.ops, store().project, store().assets);
  const ops = await withSfx(san.ops, san.sfx, opts.onStatus);
  const appliedIds = ops.length ? await apply(ops) : [];
  return { reply: r.reply, ops, appliedIds, provider: 'demo', warnings: [] };
}

async function claudeChat(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions): Promise<PipelineResult> {
  opts.onStatus?.('Pensando…');
  try {
    const s = store();
    const frames = await sourceFrames(sourceAssets(s.assets), false, 6);
    const res = await requestEdit({ project: s.project, assets: s.assets, messages: s.messages, userText: text, mode: 'chat', frames, context: opts.context, signal: opts.signal });
    const fin = await claudeOps(res, text, opts);
    const ops = fin.ops;
    const before = store().project;
    if (ops.length) opts.onStatus?.('Editando…');
    const appliedIds = ops.length ? await apply(ops) : [];
    const warnings: string[] = [];
    const extra = await afterClaude(fin, before, text, apply, opts, warnings);
    return { reply: fin.reply + extra, ops, appliedIds, provider: 'anthropic', warnings };
  } catch (e) {
    if (isRunAbort(e)) throw e;
    // IA indisponível: tenta o intérprete local antes de desistir
    const local = chatIntent(canonVerbs(text), { project: store().project, assets: store().assets, target: opts.context });
    if (local.ops.length) {
      const san = sanitizeOps(local.ops, store().project, store().assets);
      const ops = await withSfx(san.ops, san.sfx, opts.onStatus);
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
    // intérprete local recebe os verbos normalizados ("coloque" → "coloca"); o Claude recebe o texto original
    const local = canonVerbs(text);
    const res = (await localFeature(local, apply, opts, status, text)) ?? (status.configured ? await claudeChat(text, apply, opts) : await demoChat(local, apply, opts));
    // pedido feito apontando para um comentário de revisão: se editou, o comentário fica resolvido
    const mid = opts.context?.markerId;
    const cm = mid ? store().project.markers?.find((m) => m.id === mid && m.kind === 'comment' && !m.resolved) : undefined;
    if (cm && res.appliedIds.length) {
      const ids = await apply([{ op: 'update_marker', markerId: cm.id, patch: { resolved: true }, explain: 'Comentário resolvido' }], { delayMs: 150 });
      res.appliedIds.push(...ids);
    }
    return res;
  });
}

/* ---------- recursos com execução local (iguais nos dois modos) ---------- */

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const RE = {
  reframe: /reenquadr|re-enquadr|reframe|segu(e|ir) o rosto|acompanha(r)? (o )?(rosto|assunto)|centraliza(r)? (o )?(rosto|assunto)/,
  translate: /(tradu[zc]|traduc)/,
  fillers: /vicio|muleta|\bne\b.*\btipo\b|\btipo\b.*\bne\b|hesitac/,
  beats: /batida|\bbeat|ritmo da musica/,
  needsWords: /vicio|muleta|destaque|melhores (partes|momentos|trechos)|capitulo|gancho|enfase|frases (fortes|importantes)/,
  silence: /(cort|tir|remov|limp|elimin|apag)\w* .{0,20}(silenc|pausa|respiro|tempo morto)|(silenc|pausa)\w* .{0,25}(maior|acima|agressiv|longa|curta)/,
  emphasis: /zoom.{0,25}(enfase|frases? (fortes|importantes|de impacto)|palavras? (fortes|importantes|chave)|momentos? (fortes|importantes))|zoom automatico|(enfase|destaque).{0,20}zoom/,
  matchColor: /(combin|igual|parecid|casa|bate|iguala|match).{0,25}\bcor(es)?\b|\bcor(es)?\b.{0,30}(do|ao|com o) (video )?(modelo|exemplo|referencia)|color match/,
};
const LANGS: [RegExp, string, string][] = [
  [/ingles|english/, 'en-US', 'inglês'], [/espanhol|spanish/, 'es-ES', 'espanhol'], [/frances/, 'fr-FR', 'francês'],
  [/italiano/, 'it-IT', 'italiano'], [/alemao/, 'de-DE', 'alemão'], [/portugues/, 'pt-BR', 'português'],
];

/** garante legendas com palavras (Whisper) antes de recursos que dependem da fala */
async function ensureWords(opts: PipelineOptions, apply: NonNullable<PipelineOptions['apply']>, warnings: string[]): Promise<boolean> {
  const segsNow = store().project.captions.segments;
  const fake = captionsNeedTranscription(store().project); // legenda antiga de exemplo não é fala: transcreve
  if (!fake && segsNow.some((s) => s.words?.some((w) => w.id))) return true;
  // já há legendas (sem ids de palavra): reaproveita, só numerando as palavras — nunca retranscreve
  if (!fake && segsNow.length) {
    const { ops } = sanitizeOps([{ op: 'set_captions', segments: segsNow, language: store().project.captions.language, explain: 'Preparando as palavras das legendas' }], store().project, store().assets);
    if (ops.length) await apply(ops, { delayMs: 120 });
    return true;
  }
  const used = sourceAssets(store().assets).filter((a) => a.kind !== 'image' && onTimeline(store().project).has(a.id));
  const lang = store().project.captions.language || 'pt-BR';
  const run: CaptionRun = {};
  const segs = await whisperCaptions(used, lang, opts, warnings, run);
  if (!segs?.length) return false;
  const { ops } = sanitizeOps([speechCaptionsOp(segs, lang, run, `Transcrevendo: ${segs.length} frases`)], store().project, store().assets);
  await apply(ops, { delayMs: 250 });
  opts.onLog?.(`Fala transcrita: ${segs.length} legendas`);
  return true;
}

/** batidas: usa asset.beats ou detecta no navegador e guarda no asset */
async function ensureBeats(opts: PipelineOptions): Promise<number> {
  let n = 0;
  for (const t of store().project.tracks) for (const c of t.clips) {
    if (c.type !== 'audio') continue;
    const a = store().assets[c.assetId];
    if (!a) continue;
    if (!a.beats?.length) {
      opts.onStatus?.(`Ouvindo as batidas de "${a.name}"…`);
      const beats = await beatsOf(a);
      if (beats.length) store().updateAsset(a.id, { beats });
    }
    n += store().assets[a.id]?.beats?.length ?? 0;
  }
  return n;
}

async function localFeature(text: string, apply: NonNullable<PipelineOptions['apply']>, opts: PipelineOptions, status: AIStatus, original = text): Promise<PipelineResult | null> {
  const t = norm(text);
  const provider = status.provider;
  const warnings: string[] = [];
  const done = async (ops: EditOp[], reply: string): Promise<PipelineResult> => {
    const clean = sanitizeOps(ops, store().project, store().assets).ops;
    const appliedIds = clean.length ? await apply(clean) : [];
    return { reply, ops: clean, appliedIds, provider, warnings };
  };

  // pôr/trocar música sem arquivo do usuário → catálogo de músicas geradas por código
  const musicReq = chatMusicRequest(text);
  if (musicReq && !userMusic(store().assets).length) {
    const cur = backgroundMusicClips(store().project, store().assets);
    const exclude = (await Promise.all(cur.map((c) => catalogIdOf(c.type === 'audio' ? store().assets[c.assetId] : undefined)))).filter((x): x is string => !!x);
    const removeOps: EditOp[] = cur.map((c) => ({ op: 'remove_clip', clipId: c.id, explain: 'Tirando a música anterior' }));
    const sim = removeOps.length ? applyOps(store().project, removeOps).project : store().project;
    opts.onStatus?.('Escolhendo uma música do catálogo…');
    const m = await catalogMusicOps(text, sim, { exclude, onStatus: opts.onStatus });
    if (m) return done([...removeOps, ...m.ops], `${cur.length ? 'Troquei a música por' : 'Coloquei a música'} “${m.name}” do catálogo de músicas livres (sem direitos autorais)${store().project.captions.segments.length ? ', baixinha e abaixando na fala' : ''}.`);
  }

  // "coloque legenda no vídeo" sem legendas ainda → transcreve a fala de verdade (Whisper no aparelho),
  // nos dois modos; se o pedido também traz estilo ("…estilo TikTok", "amarela"), aplica em seguida
  if (/legenda/.test(t) && CAPTION_ADD.test(t) && !/(sem|tir|remov|escond|deslig|apag|ocult)\w* .{0,12}legenda/.test(t) && !RE.translate.test(t) && captionsWantTranscription(store().project)) {
    const cap = await generateCaptions({ ...opts, apply });
    const styleWords = /estilo|tiktok|karaok|neon|maior|menor|em cima|embaixo|no meio|centro|amarel|vermelh|branc|pret|azul|verde|rosa|laranja|roxo|dourad|negrito|caixa|fundo|contorno|anima|palavra/.test(t.replace(/^.*?legendas?/, ''));
    if (!cap.ops.length || !styleWords) return { ...cap, warnings: [...warnings, ...cap.warnings] };
    const rest = status.configured ? await claudeChat(original, apply, opts) : await demoChat(text, apply, opts);
    return { ...rest, reply: `${cap.reply.replace(/ Quer mudar o estilo.*$/, '')} ${rest.reply}`, ops: [...cap.ops, ...rest.ops], appliedIds: [...cap.appliedIds, ...rest.appliedIds], warnings: [...cap.warnings, ...rest.warnings] };
  }

  // auto-reframe (rosto/assunto) — no navegador
  if (RE.reframe.test(t)) {
    const only = opts.context?.clipIds;
    const outAspect = store().project.width / store().project.height;
    const vids = sourceAssets(store().assets).filter((a) => a.kind === 'video' && onTimeline(store().project).has(a.id) && !!a.width && !!a.height && a.width / a.height > outAspect + 0.01);
    if (!vids.length) return { reply: `O material já cabe no formato ${store().project.aspect} — não há o que reenquadrar.`, ops: [], appliedIds: [], provider, warnings };
    const subjects: Record<Id, { t: number; x: number }[]> = {};
    let method = 'center';
    for (const a of vids) {
      opts.onStatus?.(`Procurando o rosto/assunto em "${a.name}"…`);
      const tr = await trackSubject(a, (f) => opts.onStatus?.(`Procurando o rosto/assunto em "${a.name}"… ${Math.round(f * 100)}%`, f));
      subjects[a.id] = tr.points;
      if (tr.method === 'faces') method = 'faces';
      else if (method !== 'faces') method = tr.method;
    }
    const ops = reframeOps(store().project, store().assets, subjects, only);
    if (!ops.length) return { reply: `O material já cabe no formato ${store().project.aspect} — não há o que reenquadrar.`, ops: [], appliedIds: [], provider, warnings };
    return done(ops, method === 'faces' ? `Reenquadrei para ${store().project.aspect} seguindo o rosto.` : `Reenquadrei para ${store().project.aspect} seguindo a parte com mais detalhe da imagem (não achei rostos).`);
  }

  // traduzir legendas (Claude)
  if (RE.translate.test(t) && /legenda/.test(t)) {
    const lang = LANGS.find(([re]) => re.test(t));
    if (!status.configured) return null; // demo responde que precisa da chave
    if (captionsNeedTranscription(store().project)) {
      if (!(await ensureWords(opts, apply, warnings))) return { reply: 'Não há legendas para traduzir — gere as legendas primeiro.', ops: [], appliedIds: [], provider, warnings };
    }
    const [, code, name] = lang ?? [null, 'en-US', 'inglês'];
    opts.onStatus?.(`Traduzindo as legendas para ${name}…`);
    const p = store().project;
    const map = await translateSegments(p.captions.segments.map((s) => ({ id: s.id, text: s.words?.length ? s.words.map((w) => w.text).join(' ') : s.text })), code, p.captions.language);
    const segments = p.captions.segments.map((s) => {
      const tx = map.get(s.id) ?? s.text;
      return { id: s.id, start: s.start, end: s.end, text: tx, words: distributeWords(tx, s.start, s.end) };
    });
    return done([{ op: 'set_captions', segments, language: code, source: 'translation', model: store().project.captions.model, explain: `Legendas em ${name}` }], `Traduzi ${segments.length} legendas para ${name}. Os tempos de cada frase foram mantidos.`);
  }

  // cortar vícios (ids das palavras do Whisper) — exato e grátis
  if (RE.fillers.test(t)) {
    if (!(await ensureWords(opts, apply, warnings))) return { reply: 'Para cortar vícios eu preciso transcrever a fala primeiro (ligue o CC e tente de novo).', ops: [], appliedIds: [], provider, warnings };
    // conta o que sobra depois da validação (não promete cortes que caíram)
    const f = fillerOps(store().project);
    const ops = sanitizeOps(f.ops, store().project, store().assets).ops;
    const count = ops.length === f.ops.length ? f.count : ops.length;
    if (!ops.length) return { reply: 'Não encontrei vícios de linguagem (né, tipo, éé, hum…) na fala.', ops: [], appliedIds: [], provider, warnings };
    return done(ops, `Cortei ${count} vício${count > 1 ? 's' : ''} de linguagem pelas palavras da transcrição.`);
  }

  // batidas: detecta antes (Claude e demo usam asset.beats)
  if (RE.beats.test(t)) {
    const n = await ensureBeats(opts);
    if (!n) return { reply: 'Não achei batidas: coloque uma música na trilha de áudio primeiro.', ops: [], appliedIds: [], provider, warnings };
    if (/sincroniz|na batida|no ritmo|corta(r)? n/.test(t) && !/marca/.test(t)) {
      const { ops, cuts } = beatSyncOps(store().project, store().assets, /(rapid|frenet|toda batida)/.test(t) ? 0.45 : 0.8);
      if (!ops.length) return { reply: 'As batidas não caem dentro do vídeo.', ops: [], appliedIds: [], provider, warnings };
      return done(ops, `Sincronizei ${cuts} cortes com a batida da música, com zoom alternado e flash nas batidas fortes.`);
    }
    return null; // "marca as batidas" etc. seguem p/ o demo/Claude com asset.beats preenchido
  }

  // cortar silêncios com limiar ajustável ("pausas maiores que 1 s", "agressivo", "só as longas")
  if (RE.silence.test(t) && !/(nao|sem) cort/.test(t)) {
    const sOpts = silenceOptsFromText(text);
    opts.onStatus?.('Ouvindo o áudio para achar as pausas…');
    const used = onTimeline(store().project);
    const silences = await silencesFor(sourceAssets(store().assets).filter((a) => a.kind !== 'image' && used.has(a.id)), sOpts);
    const { ops, removed } = silenceCutOps(store().project, silences);
    const lim = sOpts?.minSilence ? ` (pausas ≥ ${sOpts.minSilence.toString().replace('.', ',')} s)` : '';
    if (!ops.length) return { reply: `Não encontrei pausas para cortar${lim}.`, ops: [], appliedIds: [], provider, warnings };
    return done(ops, `Cortei ${ops.length} pausa${ops.length > 1 ? 's' : ''}${lim}: ${removed.toFixed(1).replace('.', ',')} s a menos.`);
  }

  // zoom automático nas frases de ênfase
  if (RE.emphasis.test(t)) {
    if (!(await ensureWords(opts, apply, warnings))) return { reply: 'Para achar as frases de ênfase eu preciso transcrever a fala primeiro (ligue o CC).', ops: [], appliedIds: [], provider, warnings };
    const { ops, count } = emphasisZoomOps(store().project);
    if (!ops.length) return { reply: 'Não achei frases de ênfase dentro do vídeo.', ops: [], appliedIds: [], provider, warnings };
    return done(ops, `Coloquei zoom punch-in em ${count} frase${count > 1 ? 's' : ''} de ênfase.`);
  }

  // combinar a cor com o vídeo modelo (ColorGrade calculado das cores médias)
  if (RE.matchColor.test(t)) {
    const r = await matchColorOps(opts);
    if (!r) return { reply: 'Para combinar a cor eu preciso de um vídeo modelo: toque no 📎 → "Vídeo modelo (estilo)".', ops: [], appliedIds: [], provider, warnings };
    if (!r.ops.length) return { reply: 'As cores do seu vídeo já estão parecidas com as do modelo.', ops: [], appliedIds: [], provider, warnings };
    return done(r.ops, `Combinei a cor com o modelo “${r.name}” (equilíbrio de cor, exposição, contraste e saturação).`);
  }

  // recursos que dependem das palavras: transcreve antes, depois segue normalmente
  if (RE.needsWords.test(t) && !/["“”]/.test(text) && !store().project.captions.segments.length) await ensureWords(opts, apply, warnings);
  return null;
}

/* ---------- comentários de revisão ---------- */

export async function applyComments(opts: PipelineOptions & { markerIds?: Id[] } = {}): Promise<PipelineResult> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  const pending = (store().project.markers ?? []).filter((m) => m.kind === 'comment' && !m.resolved && (!opts.markerIds || opts.markerIds.includes(m.id)));
  if (!pending.length) return { reply: 'Não há comentários pendentes. Adicione comentários na timeline (marcadores de comentário) e toque em "Aplicar comentários".', ops: [], appliedIds: [], provider: status.provider, warnings: [] };
  const f = (n: number) => n.toFixed(1);
  const list = pending.map((m, i) => `${i + 1}. [${m.id}] em ${f(m.t)}${m.end !== undefined ? `–${f(m.end)}` : ''} s: "${m.label ?? ''}"`).join('\n');

  return withSingleUndo(async () => {
    let ops: EditOp[] = [];
    const sfx: SfxRequest[] = [];
    let fin: Finalized | null = null;
    const before = store().project;
    const warnings: string[] = [];
    const replies = new Map<string, string>();
    let reply = '';
    if (status.configured) {
      opts.onStatus?.(`Lendo ${pending.length} comentário${pending.length > 1 ? 's' : ''}…`);
      const s = store();
      const res = await requestEdit({ project: s.project, assets: s.assets, messages: s.messages, mode: 'comments', frames: await sourceFrames(sourceAssets(s.assets), false, 6), userText: `Aplique estes comentários de revisão:\n${list}`, signal: opts.signal });
      fin = await claudeOps(res, `Aplique estes comentários de revisão:\n${list}`, opts);
      ops = fin.ops; // já validadas (scripts/gráficos/SFX incluídos)
      for (const c of res.comments ?? []) replies.set(c.markerId, c.reply);
      reply = fin.reply;
    } else {
      // demo: cada comentário vira um pedido de chat no trecho/ponto dele
      let p = store().project;
      for (const m of pending) {
        const target: ChatContext = { label: m.label ?? 'comentário', markerId: m.id, range: { start: m.t, end: m.end ?? Math.min(projectDuration(p), m.t + 2) } };
        const r = chatIntent(m.label ?? '', { project: p, assets: store().assets, target });
        const clean = sanitizeOps(r.ops, p, store().assets);
        ops.push(...clean.ops);
        sfx.push(...clean.sfx);
        p = clean.project;
        replies.set(m.id, clean.ops.length ? r.reply : 'Não entendi este no modo demonstração.');
      }
      reply = 'Apliquei os comentários no modo demonstração.';
    }
    // marca como resolvidos os que tiveram resposta/ops (o Claude normalmente já manda update_marker)
    const resolvedByAI = new Set(ops.filter((o) => o.op === 'update_marker' && o.patch.resolved).map((o) => (o as Extract<EditOp, { op: 'update_marker' }>).markerId));
    for (const m of pending) {
      if (resolvedByAI.has(m.id) || !(replies.has(m.id) || status.configured)) continue;
      if (!status.configured && replies.get(m.id)?.startsWith('Não entendi')) continue;
      ops.push({ op: 'update_marker', markerId: m.id, patch: { resolved: true }, explain: `Comentário em ${f(m.t)} s resolvido` });
    }
    let clean: EditOp[];
    if (fin) {
      // ops do Claude já validadas; só as marcações de resolvido são novas
      const extra = ops.slice(fin.ops.length);
      clean = [...fin.ops, ...sanitizeOps(extra, applyOps(store().project, fin.ops).project, store().assets).ops];
    } else clean = await withSfx(sanitizeOps(ops, store().project, store().assets).ops, sfx, opts.onStatus);
    opts.onStatus?.('Editando…');
    const appliedIds = clean.length ? await apply(clean) : [];
    const lines = pending.map((m) => `• ${f(m.t)} s — "${m.label ?? ''}": ${replies.get(m.id) ?? 'feito.'}`);
    const after = fin ? await afterClaude(fin, before, `Comentários de revisão:\n${list}`, apply, opts, warnings) : '';
    return { reply: `${reply}\n${lines.join('\n')}${after}`, ops: clean, appliedIds, provider: status.provider, warnings };
  });
}

/** duração útil p/ UI */
export function timelineDuration(): number {
  return projectDuration(store().project);
}

/* ---------- vídeo modelo anexado no chat ---------- */

/** ops de colorGrade que aproximam as cores do material às do vídeo modelo ativo */
async function matchColorOps(opts: PipelineOptions): Promise<{ ops: EditOp[]; name: string } | null> {
  const ref = referenceAsset(store().assets, store().project);
  if (!ref) return null;
  opts.onStatus?.('Medindo as cores do modelo…');
  const model = await colorStatsOf(ref);
  if (!model) return null;
  const used = onTimeline(store().project);
  const grades: Record<Id, ColorGrade> = {};
  for (const a of sourceAssets(store().assets)) {
    if (a.kind !== 'video' || a.id === ref.id || !used.has(a.id)) continue;
    opts.onStatus?.(`Medindo as cores de "${a.name}"…`);
    const st = await colorStatsOf(a);
    if (st) grades[a.id] = matchColorGrade(model, st);
  }
  return { ops: colorGradeOps(store().project, grades), name: ref.name };
}

/**
 * Analisa um vídeo modelo (role 'reference'): quadros + cortes medidos aqui,
 * Claude descreve o estilo (ou heurística local no demo). Vira o estilo ativo
 * do projeto (set_project {style, referenceAssetId}) e devolve o resumo.
 */
export async function analyzeModel(assetId: Id, opts: PipelineOptions = {}): Promise<PipelineResult & { style?: StyleProfile }> {
  const apply = opts.apply ?? defaultApply;
  const status = await getStatus();
  const asset = store().assets[assetId];
  if (!asset || asset.kind !== 'video') throw new AIClientError('O vídeo modelo precisa ser um vídeo.', 400, 'bad_model');
  const warnings: string[] = [];
  opts.onStatus?.('Analisando o estilo do modelo…');
  const sample = await sampleReference(asset, (f) => opts.onStatus?.(`Analisando o estilo do modelo… ${Math.round(f * 100)}%`, f), status.configured);
  if (!sample) throw new AIClientError('Não consegui ler esse vídeo modelo. Tente outro arquivo (MP4/WebM).', 400, 'bad_model');
  let style = sample.localStyle;
  if (status.configured) {
    try {
      opts.onStatus?.('A IA está estudando o estilo do modelo…');
      style = await analyzeReference(sample);
    } catch (e) {
      warnings.push(`análise pela IA falhou (${errText(e)}) — usei a análise local`);
    }
  }
  opts.onLog?.(`Modelo lido: ${sample.metrics.cuts.length} cortes em ${sample.metrics.duration.toFixed(0)} s`);
  const ops: EditOp[] = [{ op: 'set_project', patch: { style, referenceAssetId: asset.id }, explain: 'Guardando o estilo do modelo' }];
  const appliedIds = await apply(ops, { delayMs: 150 });
  const reply = `${describeStyle(style, asset.name)}${warnings.length ? `\n(${warnings.join('; ')})` : ''}`;
  return { reply, ops, appliedIds, provider: status.provider, warnings, style };
}

/** aplica o estilo do modelo ativo (tudo ou só uma parte). A cor é combinada localmente (ColorGrade). */
export async function applyModelStyle(scope: StyleScope, opts: PipelineOptions = {}): Promise<PipelineResult> {
  if (!store().project.style) throw new AIClientError('Anexe um vídeo modelo primeiro.', 400, 'no_model');
  const status = await getStatus();
  if (!status.configured) return chatEdit(modelRequestText(scope), opts);
  if (scope !== 'colors' && scope !== 'all') return chatEdit(modelRequestText(scope), opts);
  const apply = opts.apply ?? defaultApply;
  return withSingleUndo(async () => {
    const m = await matchColorOps(opts);
    const clean = m?.ops.length ? sanitizeOps(m.ops, store().project, store().assets).ops : [];
    const ids = clean.length ? await apply(clean) : [];
    const colorMsg = clean.length ? `Cores combinadas com o modelo “${m!.name}”.` : '';
    if (scope === 'colors') {
      return { reply: colorMsg || 'As cores do seu vídeo já estão parecidas com as do modelo.', ops: clean, appliedIds: ids, provider: status.provider, warnings: [] };
    }
    const res = await chatEdit(`${modelRequestText('all')}${clean.length ? ' (as cores JÁ foram combinadas com o modelo via colorGrade — não mexa em cor/filtros/looks)' : ''}`, opts);
    return { ...res, ops: [...clean, ...res.ops], appliedIds: [...ids, ...res.appliedIds], reply: colorMsg ? `${colorMsg} ${res.reply}` : res.reply };
  });
}
