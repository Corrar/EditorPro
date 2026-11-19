import { describe, expect, it } from 'vitest';
import { applyOps, findClip, projectDuration, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project, TextClip, VideoClip } from '../types';
import { sanitizeOps } from './validate';
import { parseTime, sanitizeStyleProfile, sanitizeTranscript } from './sanitize';
import { captionsMediaToTimeline, mediaRangeToTimeline, mediaToTimeline, mergeRanges } from './timemap';
import {
  chatIntent, cutsFromDiffs, demoNeeds, detectSilences, hookFromBrief, parseBrief, planFirstEdit, punchKeyframes,
  silenceCutOps, speechRanges, styleFromCuts,
} from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const music: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'trilha.mp3', mime: 'audio/mpeg', size: 1, duration: 60 };
const assets = { a1: src, m1: music };

function base(): Project {
  const p = createProject();
  return applyOps(p, [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' } }]).project;
}

describe('sanitizeOps', () => {
  it('descarta op desconhecida e clipe inexistente, gera ids e explain', () => {
    const r = sanitizeOps(
      [
        { op: 'explode' },
        { op: 'remove_clip', clipId: 'nope' },
        { op: 'set_aspect', aspect: '16:9' },
      ],
      base(),
      assets,
    );
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].id).toBeTruthy();
    expect(r.ops[0].explain).toBeTruthy();
    expect(r.dropped.map((d) => d.reason)).toEqual([expect.stringContaining('desconhecida'), expect.stringContaining('não existe')]);
  });

  it('prende ripple_delete aos limites e recusa apagar tudo', () => {
    const r = sanitizeOps(
      [
        { op: 'ripple_delete', start: -3, end: '2', explain: 'corta' },
        { op: 'ripple_delete', start: 0, end: 999 },
      ],
      base(),
      assets,
    );
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ op: 'ripple_delete', start: 0, end: 2 });
    expect(projectDuration(r.project)).toBe(18);
  });

  it('add_clip completa um clipe de texto parcial e escolhe a trilha certa', () => {
    const r = sanitizeOps([{ op: 'add_clip', trackId: 'track_video_1', clip: { type: 'text', text: 'Olá', start: 1, style: { color: 'amarelo', fontSize: 9999 } } }], base(), assets);
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0] as Extract<EditOp, { op: 'add_clip' }>;
    expect(op.trackId).toBe('track_text_1');
    const clip = op.clip as TextClip;
    expect(clip.id).toMatch(/^clip_/);
    expect(clip.style.color).toBe('#FFD23F');
    expect(clip.style.fontSize).toBe(260);
    expect(clip.style.fontFamily).toBe('Poppins');
    expect(clip.duration).toBeGreaterThan(0);
  });

  it('add_clip de vídeo não passa do fim da mídia', () => {
    const r = sanitizeOps([{ op: 'add_clip', clip: { type: 'video', assetId: 'a1', start: 20, in: 15, duration: 50 } }], base(), assets);
    const clip = (r.ops[0] as Extract<EditOp, { op: 'add_clip' }>).clip as VideoClip;
    expect(clip.duration).toBe(5);
    expect(clip.transform.scale).toBe(1);
  });

  it('update_clip mescla transform/style parciais e ajusta duração ao mudar speed', () => {
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { speed: 2, transform: { scale: 1.2 }, type: 'audio', bogus: 1 } }], base(), assets);
    expect(r.ops).toHaveLength(1);
    const c = findClip(r.project, 'c1')!.clip as VideoClip;
    expect(c.type).toBe('video');
    expect(c.speed).toBe(2);
    expect(c.duration).toBe(10);
    expect(c.transform).toMatchObject({ scale: 1.2, x: 0, opacity: 1 });
    expect((c as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('ops em sequência podem referenciar clipes criados antes', () => {
    const r = sanitizeOps(
      [
        { op: 'split_clip', clipId: 'c1', at: 5, newId: 'c2' },
        { op: 'update_clip', clipId: 'c2', patch: { colorPreset: 'cinematic' } },
        { op: 'split_clip', clipId: 'c2', at: 2 }, // fora do clipe c2 (5..20)
      ],
      base(),
      assets,
    );
    expect(r.ops).toHaveLength(2);
    expect((findClip(r.project, 'c2')!.clip as VideoClip).colorPreset).toBe('cinematic');
  });

  it('trim_clip não estica além da mídia', () => {
    const r = sanitizeOps([{ op: 'trim_clip', clipId: 'c1', start: -5, end: 40 }], base(), assets);
    expect(r.ops[0]).toMatchObject({ start: 0, end: 20 });
  });

  it('set_caption_style valida enums e cores; update_clip remove transição com null', () => {
    const p = applyOps(base(), [{ op: 'split_clip', clipId: 'c1', at: 5, newId: 'c2' }, { op: 'update_clip', clipId: 'c2', patch: { transitionIn: { kind: 'fade', duration: 0.4 } } }]).project;
    const r = sanitizeOps(
      [
        { op: 'set_caption_style', style: { preset: 'xyz', color: 'red', maxWords: 40, position: { y: 2 } } },
        { op: 'update_clip', clipId: 'c2', patch: { transitionIn: null } },
      ],
      p,
      assets,
    );
    expect(r.ops).toHaveLength(2);
    expect(r.project.captions.style.preset).toBe('bold-pop');
    expect(r.project.captions.style.color).toBe('#FF3B30');
    expect(r.project.captions.style.maxWords).toBe(12);
    expect(r.project.captions.style.position).toEqual({ x: 0.5, y: 1 });
    expect((findClip(r.project, 'c2')!.clip as VideoClip).transitionIn).toBeUndefined();
  });

  it('aceita { ops: [...] } e limita a quantidade', () => {
    const many = Array.from({ length: 100 }, () => ({ op: 'toggle_captions', enabled: true }));
    const r = sanitizeOps({ ops: many }, base(), assets);
    expect(r.ops.length).toBe(80);
  });
});

describe('sanitizeTranscript', () => {
  it('converte tempos, ordena, prende à duração e sintetiza palavras', () => {
    const segs = sanitizeTranscript(
      {
        segments: [
          { start: '0:05.5', end: '0:07', text: 'segundo trecho' },
          { start: 1, end: 3, text: 'olá mundo', words: [{ text: 'olá', start: 1, end: 1.6 }, { text: 'mundo', start: 1.5, end: 2.4 }] },
          { start: 19, end: 30, text: 'fim' },
          { start: 'x', text: 'lixo' },
        ],
      },
      { duration: 20 },
    );
    expect(segs.map((s) => s.text)).toEqual(['olá mundo', 'segundo trecho', 'fim']);
    expect(segs[0].words![0].end).toBe(1.5); // sem sobreposição
    expect(segs[1].start).toBe(5.5);
    expect(segs[1].words).toHaveLength(2);
    expect(segs[2].end).toBe(20);
  });

  it('divide segmentos longos', () => {
    const text = Array.from({ length: 30 }, (_, i) => `p${i}`).join(' ');
    const segs = sanitizeTranscript([{ start: 0, end: 15, text }], { duration: 20 });
    expect(segs.length).toBeGreaterThan(2);
    expect(segs.every((s) => s.end - s.start <= 8.01)).toBe(true);
  });

  it('parseTime', () => {
    expect(parseTime('1:02.5')).toBe(62.5);
    expect(parseTime('01:00:01')).toBe(3601);
    expect(parseTime(3)).toBe(3);
    expect(parseTime('abc')).toBeUndefined();
  });

  it('sanitizeStyleProfile preenche e valida', () => {
    const s = sanitizeStyleProfile({ avgShotLength: 1.1, transitions: ['whip', 'nope', 'whip'], colorPreset: 'teal', captions: { present: true, preset: 'neon' } })!;
    expect(s.pacing).toBe('very-fast');
    expect(s.transitions).toEqual(['whip']);
    expect(s.colorPreset).toBeUndefined();
    expect(s.captions).toMatchObject({ present: true, preset: 'neon' });
  });
});

describe('timemap', () => {
  const p = applyOps(base(), [
    { op: 'ripple_delete', start: 4, end: 10 }, // mídia 0-4 em 0-4; mídia 10-20 em 4-14
    { op: 'update_clip', clipId: 'c1', patch: { speed: 2, duration: 2 } }, // mídia 0-4 em 0-2
  ]).project;
  const clips = p.tracks[0].clips as VideoClip[];

  it('mediaToTimeline respeita in/start/speed e devolve null fora', () => {
    expect(mediaToTimeline(clips, 2)!.t).toBe(1);
    expect(mediaToTimeline(clips, 12)!.t).toBe(6);
    expect(mediaToTimeline(clips, 7)).toBeNull();
  });

  it('mediaRangeToTimeline divide por clipe', () => {
    const r = mediaRangeToTimeline(clips, 3, 11);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ start: 1.5, end: 2 });
    expect(r[1]).toMatchObject({ start: 4, end: 5 });
  });

  it('captionsMediaToTimeline remove palavras cortadas e divide segmento entre clipes', () => {
    const segs = captionsMediaToTimeline(p, 'a1', [
      { id: 's1', start: 3, end: 11, text: 'a b c', words: [{ start: 3, end: 3.5, text: 'a' }, { start: 6, end: 7, text: 'b' }, { start: 10.2, end: 11, text: 'c' }] },
    ]);
    expect(segs.map((s) => s.text)).toEqual(['a', 'c']);
    expect(segs[0].start).toBe(1.5);
    expect(segs[1].start).toBeCloseTo(4.2);
  });

  it('mergeRanges', () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 0, end: 2 }, { start: 1.5, end: 3 }])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 6 }]);
  });
});

/** áudio sintético: tom com trechos mudos */
function synth(pattern: [number, boolean][], sr = 8000): Float32Array {
  const total = pattern.reduce((a, [d]) => a + d, 0);
  const out = new Float32Array(Math.round(total * sr));
  let i = 0;
  for (const [d, loud] of pattern) {
    const n = Math.round(d * sr);
    for (let k = 0; k < n; k++, i++) out[i] = loud ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr) : (Math.random() - 0.5) * 0.0005;
  }
  return out;
}

describe('demo: silêncios', () => {
  it('detecta pausas com respiro e ignora pausas curtas', () => {
    const s = synth([[1, false], [3, true], [1.5, false], [2, true], [0.2, false], [2, true], [1, false]]);
    const sil = detectSilences(s, 8000);
    expect(sil).toHaveLength(3);
    expect(sil[0].start).toBe(0);
    expect(sil[0].end).toBeCloseTo(0.88, 1);
    expect(sil[1].start).toBeCloseTo(4.12, 1);
    expect(sil[1].end).toBeCloseTo(5.38, 1);
    expect(sil[2].end).toBeCloseTo(10.7, 1);
  });

  it('áudio contínuo não tem silêncio', () => {
    expect(detectSilences(synth([[5, true]]), 8000)).toEqual([]);
  });

  it('silenceCutOps gera ripple_delete com deslocamento acumulado', () => {
    const { ops, removed } = silenceCutOps(base(), { a1: [{ start: 0, end: 1 }, { start: 5, end: 7 }] });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: 'ripple_delete', start: 0, end: 1 });
    expect(ops[1]).toMatchObject({ start: 4, end: 6 });
    expect(removed).toBe(3);
    const after = applyOps(base(), ops).project;
    expect(projectDuration(after)).toBe(17);
  });

  it('speechRanges é o complemento', () => {
    expect(speechRanges([{ start: 0, end: 1 }, { start: 5, end: 7 }], 10)).toEqual([{ start: 1, end: 5 }, { start: 7, end: 10 }]);
  });
});

describe('demo: exemplo e brief', () => {
  it('cutsFromDiffs + styleFromCuts', () => {
    const times = Array.from({ length: 40 }, (_, i) => i * 0.25);
    const diffs = times.map((_, i) => (i % 6 === 5 ? 0.6 : 0.02));
    const cuts = cutsFromDiffs(diffs, times);
    expect(cuts.length).toBe(6);
    const st = styleFromCuts(cuts, 10, { width: 1080, height: 1920 });
    expect(st.pacing).toBe('fast');
    expect(st.aspect).toBe('9:16');
    expect(st.zoomPunchIns).toBe(true);
  });

  it('parseBrief entende palavras-chave', () => {
    const b = parseBrief('Vídeo dinâmico pro TikTok sobre minha padaria artesanal, com legenda amarela e cores quentes. Termine com siga!');
    expect(b.dynamic).toBe(true);
    expect(b.color?.preset).toBe('warm');
    expect(b.captionLook?.style).toMatchObject({ preset: 'bold-pop', color: '#FFD23F' });
    expect(b.hook).toBe('Minha padaria artesanal');
    expect(b.cta).toBe('Siga para mais!');
    expect(b.aspect).toBe('9:16');
  });

  it('hookFromBrief prefere texto entre aspas', () => {
    expect(hookFromBrief('Faça um vídeo com o título "3 erros que você comete" e legendas')).toBe('3 erros que você comete');
    expect(hookFromBrief('vídeo legal')).toBeUndefined();
  });

  it('punchKeyframes alterna escala', () => {
    const kf = punchKeyframes(10, 2.5, 1.2);
    expect(kf[0]).toEqual({ t: 0, transform: { scale: 1 } });
    expect(kf.some((k) => k.transform.scale === 1.2)).toBe(true);
    expect(kf.every((k) => k.t <= 10)).toBe(true);
  });

  it('planFirstEdit monta uma edição completa e válida', () => {
    const p0 = createProject();
    const p = applyOps(p0, [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' } }]).project;
    const res = planFirstEdit({
      project: p,
      assets,
      brief: 'Vídeo dinâmico para TikTok sobre minha padaria, cinematográfico, siga para mais',
      silencesByAsset: { a1: [{ start: 0, end: 0.8 }, { start: 6, end: 7.5 }, { start: 12, end: 13 }] },
    });
    const kinds = res.ops.map((o) => o.op);
    expect(kinds).toContain('set_captions');
    expect(kinds.filter((k) => k === 'ripple_delete')).toHaveLength(3);
    expect(kinds).toContain('set_caption_style');
    expect(kinds).toContain('add_clip');
    expect(res.ops.every((o) => o.explain && o.explain.length > 3)).toBe(true);
    // passa pelo validador sem perdas
    const v = sanitizeOps(res.ops, p, assets);
    expect(v.dropped).toEqual([]);
    expect(projectDuration(v.project)).toBeCloseTo(16.7, 1);
    const music = v.project.tracks.find((t) => t.kind === 'audio')!.clips[0];
    expect(music?.type).toBe('audio');
    expect(v.project.captions.segments.length).toBeGreaterThan(0);
    expect(v.project.tracks.find((t) => t.kind === 'text')!.clips.map((c) => c.label)).toEqual(['gancho', 'CTA']);
    expect((v.project.tracks[0].clips[0] as VideoClip).colorPreset).toBe('cinematic');
    expect(res.reply).toMatch(/Pronto/);
  });
});

describe('demo: chat', () => {
  const withCaps = () =>
    applyOps(base(), [{ op: 'set_captions', segments: [{ id: 's1', start: 1, end: 3, text: 'oi gente' }] }]).project;

  it('legenda maior e amarela, em cima', () => {
    const p = withCaps();
    const r = chatIntent('deixa a legenda maior e amarela, lá em cima', { project: p, assets });
    const st = applyOps(p, r.ops).project.captions.style;
    expect(st.fontSize).toBe(Math.round(p.captions.style.fontSize * 1.25));
    expect(st.color).toBe('#FFD23F');
    expect(st.position.y).toBe(0.18);
    expect(r.reply).toMatch(/Feito/);
  });

  it('cortar os primeiros 3 segundos e os últimos 2', () => {
    const r = chatIntent('corta os primeiros 3 segundos e corta os últimos 2s', { project: base(), assets });
    expect(r.ops).toHaveLength(2);
    expect(projectDuration(applyOps(base(), r.ops).project)).toBe(15);
  });

  it('acelerar 1.5x reescala vídeo e legendas', () => {
    const p = withCaps();
    const r = chatIntent('acelera para 1.5x', { project: p, assets });
    const after = applyOps(p, r.ops).project;
    expect(projectDuration(after)).toBeCloseTo(20 / 1.5, 2);
    expect(after.captions.segments[0].start).toBeCloseTo(1 / 1.5, 2);
    expect((after.tracks[0].clips[0] as VideoClip).speed).toBe(1.5);
  });

  it('tirar zoom / preto e branco / tirar legenda', () => {
    let p = applyOps(withCaps(), [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1.3 } }] } }]).project;
    const r1 = chatIntent('tira o zoom', { project: p, assets });
    p = applyOps(p, r1.ops).project;
    expect((p.tracks[0].clips[0] as VideoClip).keyframes).toEqual([]);
    const r2 = chatIntent('deixa preto e branco', { project: p, assets });
    p = applyOps(p, r2.ops).project;
    expect((p.tracks[0].clips[0] as VideoClip).colorPreset).toBe('bw');
    const r3 = chatIntent('tira a legenda', { project: p, assets });
    expect(applyOps(p, r3.ops).project.captions.enabled).toBe(false);
  });

  it('cortar silêncios usa a análise de áudio do contexto', () => {
    expect(demoNeeds('cortar silêncios').silences).toBe(true);
    const r = chatIntent('cortar silêncios', { project: base(), assets, silencesByAsset: { a1: [{ start: 2, end: 4 }] } });
    expect(r.ops).toEqual([expect.objectContaining({ op: 'ripple_delete', start: 2, end: 4 })]);
  });

  it('transição só aparece com mais de um clipe', () => {
    const p = applyOps(base(), [{ op: 'split_clip', clipId: 'c1', at: 10, newId: 'c2' }]).project;
    const r = chatIntent('troca a transição para fade', { project: p, assets });
    const c2 = findClip(applyOps(p, r.ops).project, 'c2')!.clip as VideoClip;
    expect(c2.transitionIn?.kind).toBe('fade');
  });

  it('pedido desconhecido devolve ajuda', () => {
    const r = chatIntent('faça um bolo de chocolate', { project: base(), assets });
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/modo demonstração/);
  });

  it('adicionar título com aspas', () => {
    const r = chatIntent('adicionar título "Promoção de hoje"', { project: base(), assets });
    const clip = (r.ops[0] as Extract<EditOp, { op: 'add_clip' }>).clip as TextClip;
    expect(clip.text).toBe('Promoção de hoje');
    expect(clip.label).toBe('gancho');
  });
});

describe('contrato: biblioteca profissional', () => {
  it('aceita animações por palavra/letra, estilo pro, wordBox e groupId', async () => {
    const { sanitizeCaptionStyle, sanitizeTextStyle, TEXT_ANIMATIONS } = await import('./sanitize');
    expect(TEXT_ANIMATIONS).toContain('word-pop');
    expect(TEXT_ANIMATIONS).toContain('char-typewriter');
    const cs = sanitizeCaptionStyle({ animation: 'word-pop', wordBox: { color: '#F2681F', radius: 99 }, activeScale: 9, inactiveOpacity: 0.4, autoEmoji: true, lines: 3, jitter: 4 });
    expect(cs).toMatchObject({ animation: 'word-pop', wordBox: { color: '#F2681F', radius: 60, padding: 10 }, activeScale: 2, inactiveOpacity: 0.4, autoEmoji: true, lines: 2, jitter: 4 });
    const ts = sanitizeTextStyle({ glow: { color: '#00FFFF', blur: 30 }, shadowColor: '#000000', shadowBlur: 12, shadowOffset: { x: 4, y: 999 }, backgroundPadding: 16 });
    expect(ts).toMatchObject({ glow: { color: '#00FFFF', blur: 30 }, shadowBlur: 12, shadowOffset: { x: 4, y: 80 }, backgroundPadding: 16 });
  });
});

describe('groupId', () => {
  it('add_clip e update_clip mantêm groupId', () => {
    const r = sanitizeOps([
      { op: 'add_clip', clip: { type: 'text', text: 'Bruno', start: 1, duration: 3, groupId: 'lt1', animation: 'word-slide' } },
      { op: 'update_clip', clipId: 'c1', patch: { groupId: 'lt1' } },
    ], base(), assets);
    expect(r.ops).toHaveLength(2);
    const p = applyOps(base(), r.ops).project;
    const txt = p.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text') as TextClip;
    expect(txt.groupId).toBe('lt1');
    expect(txt.animation).toBe('word-slide');
    expect(findClip(p, 'c1')?.clip.groupId).toBe('lt1');
  });
});

describe('pop-up da IA', () => {
  it('liveSummary/liveLabel resumem a última execução', async () => {
    const { liveSummary, liveLabel } = await import('./live');
    const msgs = [
      { id: 'u1', role: 'user', text: 'oi', status: 'done', at: 0 },
      { id: 'a1', role: 'assistant', text: '', status: 'applying', at: 1 },
    ] as never[];
    const run = { log: [], done: false, phase: 'Editando…', steps: [
      { id: '1', text: 'a', state: 'done' }, { id: '2', text: 'b', state: 'done' }, { id: '3', text: 'c', state: 'active' },
      { id: '4', text: 'd', state: 'pending' }, { id: '5', text: 'e', state: 'pending' }, { id: '6', text: 'f', state: 'pending' },
      { id: '7', text: 'g', state: 'pending' }, { id: '8', text: 'h', state: 'pending' },
    ] } as never;
    const s = liveSummary(msgs, { a1: run });
    expect(s).toMatchObject({ msgId: 'a1', working: true, done: 2, total: 8 });
    expect(liveLabel(s)).toBe('IA editando 2/8');
    expect(liveLabel(liveSummary([], {}))).toBe('Editar com IA');
    expect(liveLabel({ working: true, done: 0, total: 0, waiting: false, phase: 'Transcrevendo…' })).toBe('Transcrevendo…');
  });

  it('ditado: junta texto digitado e falado; ponte registra uma vez', async () => {
    const { joinDictation, speechCtor } = await import('./speech');
    expect(joinDictation('', 'corta o começo')).toBe('Corta o começo');
    expect(joinDictation('Legenda maior ', 'e amarela')).toBe('Legenda maior e amarela');
    expect(joinDictation('abc', '  ')).toBe('abc');
    expect(speechCtor({})).toBeUndefined();
    class W {}
    expect(speechCtor({ webkitSpeechRecognition: W })).toBe(W);

    const hadWindow = 'window' in globalThis;
    if (!hadWindow) (globalThis as Record<string, unknown>).window = new EventTarget();
    const { acquireAIBridge } = await import('./bridge');
    const { emit } = await import('../events');
    const { useAIChat } = await import('./chatStore');
    let calls = 0;
    const orig = useAIChat.getState().captions;
    useAIChat.setState({ captions: async () => { calls++; } });
    const r1 = acquireAIBridge(); const r2 = acquireAIBridge();
    emit('ep:generate-captions', {});
    expect(calls).toBe(1);
    r1(); r1();
    emit('ep:generate-captions', {});
    expect(calls).toBe(2);
    r2();
    emit('ep:generate-captions', {});
    expect(calls).toBe(2);
    useAIChat.setState({ captions: orig });
    if (!hadWindow) delete (globalThis as Record<string, unknown>).window;
  });
});

describe('biblioteca na IA', () => {
  const twoClips = () => {
    const p = createProject();
    return applyOps(p, [
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 5, in: 0 } },
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 5), id: 'c2', duration: 5, in: 10 } },
    ]).project;
  };

  it('macro-ops viram ops reais e pedidos de sfx', () => {
    const r = sanitizeOps([
      { op: 'apply_caption_preset', presetId: 'caixa-por-palavra', style: { fontSize: 90 }, explain: 'Legenda creator' },
      { op: 'set_caption_style', style: { preset: 'neon-vibrante' } },
      { op: 'apply_template', templateId: 'lt-caixa', values: [{ key: 'nome', value: 'Bruno' }, { key: 'funcao', value: 'Confeiteiro' }], at: 1 },
      { op: 'apply_look', lookId: 'teal-laranja', intensity: 0.8 },
      { op: 'add_sfx', sfxId: 'whoosh', atCuts: true },
      { op: 'add_sfx', sfxId: 'nao-existe', at: 1 },
      { op: 'apply_template', templateId: 'inventado' },
    ], twoClips(), assets);
    expect(r.dropped).toHaveLength(2);
    expect(r.project.captions.style.preset).toBe('neon-vibrante');
    const texts = r.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text') as TextClip[];
    expect(texts.map((c) => c.text)).toEqual(expect.arrayContaining(['Bruno', 'Confeiteiro']));
    expect(new Set(texts.map((c) => c.groupId)).size).toBe(1);
    expect(r.project.tracks.some((t) => t.kind === 'effect' && t.clips.some((c) => c.type === 'adjustment'))).toBe(true);
    expect(r.sfx).toEqual([{ sfxId: 'whoosh', at: 4.85 }]);
    expect(r.ops.every((o) => o.id && o.explain)).toBe(true);
  });

  it('demo entende os pedidos da biblioteca', () => {
    const p = twoClips();
    const run = (text: string) => {
      const r = chatIntent(text, { project: p, assets });
      return { r, s: sanitizeOps(r.ops, p, assets) };
    };
    const a = run('legenda estilo creator');
    expect(a.s.project.captions.style.preset).toBe('impacto-amarelo');
    const b = run('coloca um lower third com meu nome Bruno Silva');
    const tb = b.s.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text') as TextClip[];
    expect(tb.map((c) => c.text)).toContain('Bruno Silva');
    const c = run('som de whoosh nas transições');
    expect(c.s.sfx.map((x) => x.sfxId)).toEqual(['whoosh']);
    expect(c.s.project.tracks.flatMap((t) => t.clips).some((cl) => 'transitionIn' in cl && cl.transitionIn)).toBe(false);
    const d = run('look cinema');
    expect(d.s.project.tracks.some((t) => t.clips.some((cl) => cl.type === 'adjustment' && cl.label?.includes('Azul e laranja')))).toBe(true);
    const e = run('CTA siga no final');
    const te = e.s.project.tracks.flatMap((t) => t.clips).filter((cl) => cl.type === 'text') as TextClip[];
    expect(te.some((cl) => /siga/i.test(cl.text) && cl.start >= 6.9)).toBe(true);
    expect(e.r.reply).toMatch(/CTA/);
  });
});
