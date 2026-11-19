/* =====================================================================
   Ponte IA <-> biblioteca profissional (puro, exceto materializeSfx).
   A IA (Claude ou demo) usa "macro-ops" que só existem na camada de IA e
   são expandidas aqui em EditOps reais do contrato:
     {op:'apply_template', templateId, values, at?, duration?, brand?}
     {op:'apply_caption_preset', presetId, style?}
     {op:'apply_look', lookId, intensity?, clipIds?, start?, end?}
     {op:'add_sfx', sfxId, at? | atCuts:true, volume?}  -> pedido de SFX
   set_caption_style com `preset` = id da biblioteca também é expandido.
   Efeitos sonoros precisam gerar o WAV e virar asset no navegador: o
   validate devolve `SfxRequest[]` e o pipeline materializa (materializeSfx).
   ===================================================================== */
import type { EditOp } from '../ops';
import { applyOp, projectDuration } from '../ops';
import type { CaptionStyle, Id, MediaAsset, Project } from '../types';
import {
  buildTemplate, captionPresetDef, captionPresetOp, fontDef, lookAdjustmentOps, lookClipOps, lookDef, sfxClipOps, sfxDef, templateDef,
} from '../library';
import { clampNum, color, isObj, r3, str } from './sanitize';
import { sanitizeCaptionStyle } from './sanitize';

export const LIBRARY_MACROS = ['apply_template', 'apply_caption_preset', 'apply_look', 'add_sfx'] as const;
export type LibraryMacro = (typeof LIBRARY_MACROS)[number];

export interface SfxRequest { sfxId: string; at: number; volume?: number; explain?: string }

export function isLibraryMacro(item: unknown): boolean {
  if (!isObj(item)) return false;
  if ((LIBRARY_MACROS as readonly string[]).includes(String(item.op))) return true;
  return item.op === 'set_caption_style' && isObj(item.style) && !!captionPresetDef(String(item.style.preset ?? ''));
}

const fail = (m: string): never => { throw new Error(m); };

/** {nome:"Bruno"} ou [{key:"nome",value:"Bruno"}] -> Record */
function templateValues(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const kv of v) if (isObj(kv)) { const k = str(kv.key, 40); const val = str(kv.value, 200); if (k && val !== undefined) out[k] = val; }
  } else if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'number') out[k.slice(0, 40)] = String(val).slice(0, 200);
    }
  }
  return out;
}

/** pontos de corte da trilha principal (início dos clipes após o primeiro), p/ whoosh nas transições */
export function cutPoints(p: Project, lead = 0.15, max = 12): number[] {
  const main = p.tracks.find((t) => t.kind === 'video' && t.clips.length);
  if (!main) return [];
  const starts = [...main.clips].sort((a, b) => a.start - b.start).slice(1).map((c) => r3(Math.max(0, c.start - lead)));
  return [...new Set(starts)].slice(0, max);
}

/** normaliza fontFamily para o nome do catálogo (ex.: "bebas neue" -> "Bebas Neue") */
export function catalogFont(family: unknown): string | undefined {
  const f = str(family, 60);
  return f ? fontDef(f)?.family ?? fontDef(f.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()))?.family ?? f : undefined;
}

function withExplain(ops: EditOp[], explain: unknown): EditOp[] {
  const e = str(explain, 160);
  if (!e || !ops.length) return ops;
  // o passo mais visível (o add_clip principal) carrega o texto da IA
  const i = Math.max(0, ops.findIndex((o) => o.op === 'add_clip' || o.op === 'set_caption_style'));
  return ops.map((o, k) => (k === i ? { ...o, explain: e } : o));
}

/** expande uma macro-op em EditOps (ou pedidos de SFX). Lança erro se inválida. */
export function expandLibraryOp(item: Record<string, unknown>, p: Project, sfx: SfxRequest[]): EditOp[] {
  const dur = projectDuration(p);
  switch (item.op) {
    case 'apply_template': {
      const id = str(item.templateId ?? item.id, 60) ?? fail('templateId ausente');
      const def = templateDef(id) ?? fail(`modelo desconhecido: ${id}`);
      const at = clampNum(item.at ?? item.start, 0, Math.max(0, dur)) ?? 0;
      const duration = clampNum(item.duration, 0.5, 600);
      const brand = isObj(item.brand)
        ? Object.fromEntries((['primary', 'secondary', 'text'] as const).map((k) => [k, color((item.brand as Record<string, unknown>)[k])]).filter(([, v]) => v))
        : undefined;
      const ops = buildTemplate(def.id, templateValues(item.values), { project: p, at, ...(duration ? { duration } : {}), ...(brand ? { brand } : {}) });
      if (!ops.length) fail('modelo não gerou nada');
      return withExplain(ops, item.explain);
    }
    case 'apply_caption_preset':
    case 'set_caption_style': {
      const style = isObj(item.style) ? item.style : {};
      const id = str(item.presetId ?? style.preset, 60) ?? fail('presetId ausente');
      const op = captionPresetOp(id, p.captions.style) ?? fail(`estilo de legenda desconhecido: ${id}`);
      // ajustes extras da IA por cima do preset (cor, tamanho…), sem trocar o preset
      const extra = sanitizeCaptionStyle({ ...style, preset: undefined }, p.captions.style) ?? {};
      if (extra.fontFamily) extra.fontFamily = catalogFont(extra.fontFamily);
      const merged = op.op === 'set_caption_style' ? { ...op, style: { ...op.style, ...extra } as Partial<CaptionStyle> } : op;
      return withExplain([merged], item.explain);
    }
    case 'apply_look': {
      const id = str(item.lookId ?? item.id, 60) ?? fail('lookId ausente');
      if (!lookDef(id)) fail(`look desconhecido: ${id}`);
      const intensity = clampNum(item.intensity, 0, 1) ?? 1;
      const ids = Array.isArray(item.clipIds) ? item.clipIds.map((c) => str(c, 80)).filter((c): c is string => !!c) : [];
      let ops: EditOp[];
      if (ids.length) ops = lookClipOps(p, ids, id, intensity);
      else {
        const start = clampNum(item.start, 0, dur);
        const end = clampNum(item.end, 0, dur);
        const range = start !== undefined && end !== undefined && end - start > 0.1 ? { start, duration: end - start } : undefined;
        ops = lookAdjustmentOps(p, id, intensity, range);
      }
      if (!ops.length) fail('look sem clipes para aplicar');
      return withExplain(ops, item.explain);
    }
    case 'add_sfx': {
      const id = str(item.sfxId ?? item.id, 60) ?? fail('sfxId ausente');
      const def = sfxDef(id) ?? fail(`efeito sonoro desconhecido: ${id}`);
      const volume = clampNum(item.volume, 0, 2);
      const explain = str(item.explain, 160);
      const times = item.atCuts === true || item.at === 'cuts' ? cutPoints(p) : [clampNum(item.at ?? item.start, 0, Math.max(0, dur)) ?? 0];
      if (!times.length) fail('não há cortes para colocar o efeito');
      for (const at of times) sfx.push({ sfxId: def.id, at, ...(volume !== undefined ? { volume } : {}), ...(explain ? { explain } : {}) });
      return [];
    }
  }
  return fail(`macro desconhecida: ${String(item.op)}`);
}

/** sanitiza a lista de pedidos de SFX vinda da rota (JSON) */
export function sanitizeSfxRequests(v: unknown, duration: number): SfxRequest[] {
  if (!Array.isArray(v)) return [];
  const out: SfxRequest[] = [];
  for (const r of v.slice(0, 24)) {
    if (!isObj(r)) continue;
    const def = sfxDef(String(r.sfxId ?? ''));
    const at = clampNum(r.at, 0, Math.max(0, duration));
    if (!def || at === undefined) continue;
    const volume = clampNum(r.volume, 0, 2);
    const explain = str(r.explain, 160);
    out.push({ sfxId: def.id, at, ...(volume !== undefined ? { volume } : {}), ...(explain ? { explain } : {}) });
  }
  return out;
}

/**
 * Navegador: gera os WAVs (sintetizados, grátis), ingere como assets da
 * biblioteca e devolve as EditOps dos AudioClips, encadeadas sobre `p`.
 */
export async function materializeSfx(reqs: SfxRequest[], p: Project, applyOpsFn: (p: Project, ops: EditOp[]) => Project): Promise<EditOp[]> {
  if (!reqs.length) return [];
  const [{ useEditor }, { ingestFile }, { synthSfx }] = await Promise.all([import('../store'), import('../media/ingest'), import('../library')]);
  const cache = new Map<string, MediaAsset>();
  const ops: EditOp[] = [];
  let sim = p;
  for (const r of reqs) {
    const def = sfxDef(r.sfxId);
    if (!def) continue;
    let asset = cache.get(def.id);
    if (!asset) {
      const name = `${def.name}.wav`;
      asset = Object.values(useEditor.getState().assets).find((a) => a.library && a.name === name && a.url);
      if (!asset) {
        const blob = await synthSfx(def.id);
        const ingested = await ingestFile(new File([blob], name, { type: 'audio/wav' }), 'music');
        useEditor.getState().updateAsset(ingested.id, { library: true });
        asset = { ...ingested, library: true };
      }
      cache.set(def.id, asset);
    }
    const more = sfxClipOps(sim, asset, r.at, { volume: r.volume ?? def.volume });
    const withText = r.explain ? more.map((o) => (o.op === 'add_clip' ? { ...o, explain: r.explain } : o)) : more;
    sim = applyOpsFn(sim, withText);
    ops.push(...withText);
  }
  return ops;
}

export type { Id };

/* ---------------- modo demo: pedidos em linguagem natural ---------------- */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const CAPTION_WORDS: [RegExp, string, string][] = [
  [/caixa (por|em cada|na) palavra|palavra (com|em) caixa|word box/, 'caixa-por-palavra', 'caixa por palavra'],
  [/karaok\w* acendendo|acendendo/, 'karaoke-acendendo', 'karaokê acendendo'],
  [/marca.?texto|destaque amarelo/, 'marca-texto', 'marca-texto'],
  [/com emoji|emoji automatic/, 'pop-emoji', 'pop com emoji'],
  [/maquina de escrever|datilograf/, 'maquina-escrever', 'máquina de escrever'],
  [/manuscrit|escrita a mao|cursiva/, 'manuscrita', 'manuscrita'],
  [/serif|elegante|chique/, 'serifada-elegante', 'serifada elegante'],
  [/retro|anos 80|80s|synthwave/, 'retro-80s', 'retrô 80s'],
  [/noticia|jornal|telejornal/, 'noticia-faixa', 'notícia'],
  [/podcast/, 'podcast', 'podcast'],
  [/tutorial|aula/, 'tutorial', 'tutorial'],
  [/contorno grosso/, 'contorno-grosso', 'contorno grosso'],
  [/sombra longa/, 'sombra-longa', 'sombra longa'],
  [/duas cores|bicolor/, 'duas-cores', 'duas cores'],
  [/gradiente|degrade/, 'gradiente', 'gradiente'],
  [/minimal|discreta|simples/, 'minimal-branco', 'minimal'],
  [/classic\w* (de )?tv|estilo tv|closed caption/, 'classico-tv', 'clássico TV'],
  [/letterbox|estilo cinema|de cinema/, 'cinema-letterbox', 'cinema'],
  [/creator|criador|criadora|youtuber|influencer|viral|impacto/, 'impacto-amarelo', 'creator'],
];

const LOOK_WORDS: [RegExp, string][] = [
  [/teal|azul e laranja/, 'teal-laranja'], [/cinema verde|matrix/, 'cinema-verde'], [/neon/, 'neon-noturno'],
  [/noir/, 'noir'], [/p&b suave|preto e branco suave/, 'pb-suave'], [/p&b|preto e branco|monocrom/, 'pb-contraste'],
  [/vintage|70|retro|anos 70/, 'vintage-70'], [/matte|desbotad|lavad/, 'matte'], [/pastel/, 'pastel'],
  [/por do sol|entardecer|golden/, 'por-do-sol'], [/verao|ensolarad/, 'verao'], [/inverno|gelad/, 'inverno'],
  [/filme quente|quente/, 'filme-quente'], [/filme frio|frio/, 'filme-frio'], [/vibrante|saturad/, 'vibrante'],
  [/natural/, 'natural-mais'], [/cinema|cinemat|filme|hollywood/, 'teal-laranja'],
];

const SFX_WORDS: [RegExp, string][] = [
  [/whoosh|wush|vush/, 'whoosh'], [/swoosh|swish/, 'swoosh'], [/riser|subida|suspense/, 'riser'], [/\bdrop\b|queda/, 'drop'],
  [/\bpop\b|estalo/, 'pop'], [/clique|click/, 'click'], [/\bding\b|plim/, 'ding'], [/notifica/, 'notificacao'],
  [/teclad|digita/, 'teclado'], [/erro|buzzer|errado/, 'erro'], [/impacto|boom|grave|batida forte/, 'impacto'],
  [/sino/, 'sino'], [/glitch/, 'glitch'], [/caixa registradora|dinheiro|cash|cha.?ching/, 'caixa-registradora'],
  [/aplauso|palmas/, 'aplausos'], [/obturador|foto|camera/, 'obturador'],
];

const LT_WORDS: [RegExp, string][] = [[/barra/, 'lt-barra'], [/linha/, 'lt-linha'], [/vidro|glass/, 'lt-glass'], [/minimal|simples/, 'lt-minimal']];
const CTA_WORDS: [RegExp, string][] = [[/inscrev/, 'cta-inscreva'], [/link na bio|bio\b/, 'cta-link-bio'], [/coment/, 'cta-comente'], [/sig[ao]|seguir|follow/, 'cta-siga']];

/** "meu nome é Bruno Silva" / "com o nome Bruno" / "lower third Bruno" -> "Bruno Silva" */
export function nameFromText(text: string): string | undefined {
  const m = text.match(/(?:meu nome(?: [ée]| como)?|nome(?: de)?|chamad[oa]|com o nome|se chama)\s*[:"“]?\s*([A-ZÀ-Ý][\p{L}'-]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\p{L}'-]+){0,3})/u);
  if (m) return m[1].trim();
  const q = text.match(/["“]([^"”]{2,40})["”]/);
  return q ? q[1].trim() : undefined;
}

/** "como confeiteira" / "função: CEO" / ", fundador da X" */
export function roleFromText(text: string): string | undefined {
  const m = text.match(/(?:fun[cç][aã]o|cargo|profiss[aã]o)\s*[:é]?\s*([^,.;]{2,40})/i) ?? text.match(/\bcomo\s+((?:o |a )?[\p{L}][\p{L} ·&-]{2,40}?)(?=[,.;]|$| no | na | em )/iu);
  return m ? m[1].trim().replace(/^(o|a) /i, '') : undefined;
}

export interface DemoLibraryResult {
  ops: EditOp[];
  /** macro-ops (add_sfx) para o sanitizeOps expandir depois */
  macros: Record<string, unknown>[];
  said: string[];
  handled: { captionPreset: boolean; look: boolean; template: boolean; sfx: boolean };
}

/**
 * Pedidos da biblioteca no modo demo: "legenda estilo creator", "lower third com
 * meu nome Bruno", "whoosh nas transições", "look cinema", "CTA siga no final".
 */
export function demoLibraryOps(text: string, p: Project, target?: { start: number; end: number }): DemoLibraryResult {
  const t = fold(text);
  const out: DemoLibraryResult = { ops: [], macros: [], said: [], handled: { captionPreset: false, look: false, template: false, sfx: false } };
  const dur = projectDuration(p);
  let sim = p;
  const push = (ops: EditOp[], phrase: string) => {
    if (!ops.length) return;
    let next = sim;
    try { for (const o of ops) next = applyOneLib(next, o); } catch { return; }
    sim = next;
    out.ops.push(...ops);
    out.said.push(phrase);
  };
  const negate = /\b(tira|tirar|remove|remover|sem|apaga)\b/.test(t);

  // --- estilo de legenda da biblioteca
  if (/legenda|letra/.test(t) && /estilo|tipo|igual|jeito|preset|modelo|creator|criador|youtuber|influencer|caixa|acendendo|marca.?texto|maquina|manuscrit|elegante|retro|noticia|podcast|tutorial|emoji|minimal|contorno|sombra|gradiente|duas cores|letterbox|impacto/.test(t) && !negate) {
    const hit = CAPTION_WORDS.find(([re]) => re.test(t));
    if (hit) {
      const op = captionPresetOp(hit[1], p.captions.style);
      if (op) { push([op], `legendas no estilo ${hit[2]}`); out.handled.captionPreset = true; }
    }
  }

  // --- look de cor (LUT)
  if (/\blook\b|\blut\b|gradua|color grading|colorizac|\bgrade\b/.test(t) && !negate) {
    const hit = LOOK_WORDS.find(([re]) => re.test(t.replace(/\blook\b|\blut\b/g, ''))) ?? LOOK_WORDS[LOOK_WORDS.length - 1];
    const intensity = /suave|leve|sutil|pouco/.test(t) ? 0.6 : /forte|intens|bastante/.test(t) ? 1 : 0.85;
    const ops = lookAdjustmentOps(sim, hit[1], intensity, target ? { start: target.start, duration: Math.max(0.2, target.end - target.start) } : undefined);
    push(ops, `look “${lookDef(hit[1])?.name}”`);
    out.handled.look = ops.length > 0;
  }

  // --- lower third / nome na tela
  if (/lower ?third|terco inferior|nome na tela|meu nome|com (o )?nome|apresenta(cao|r)|credito com nome/.test(t) && !negate) {
    const name = nameFromText(text) ?? 'Seu nome';
    const role = roleFromText(text) ?? '';
    const id = /nome na tela/.test(t) ? 'nome-na-tela' : LT_WORDS.find(([re]) => re.test(t))?.[1] ?? 'lt-caixa';
    const at = target?.start ?? Math.min(1, Math.max(0, dur - 4));
    const ops = buildTemplate(id, { nome: name, funcao: role }, { project: sim, at });
    push(ops, `lower third com “${name}”${name === 'Seu nome' ? ' (toque no texto para trocar o nome)' : ''}`);
    out.handled.template ||= ops.length > 0;
  }

  // --- CTA
  if ((/\bcta\b|chamada para acao|call to action/.test(t) || /(coloca|adiciona|bota|cria|termina|terminar|no final|no fim).*(sig[ao]|seguir|inscrev|link na bio|coment)/.test(t)) && !negate) {
    const id = CTA_WORDS.find(([re]) => re.test(t))?.[1] ?? 'cta-siga';
    const def = templateDef(id)!;
    const custom = text.match(/["“]([^"”]{2,40})["”]/)?.[1];
    const atEnd = /final|fim|termin|acabar/.test(t) || !target;
    const at = target && !/final|fim/.test(t) ? target.start : Math.max(0, dur - def.duration);
    const ops = buildTemplate(id, custom ? { texto: custom } : {}, { project: sim, at });
    push(ops, `CTA “${def.name.replace(/^CTA · /, '')}”${atEnd ? ' no final' : ''}`);
    out.handled.template ||= ops.length > 0;
  }

  // --- efeitos sonoros
  const sfxHit = SFX_WORDS.find(([re]) => re.test(t));
  if (sfxHit && (/\bsom\b|sonor|sfx|efeito|whoosh|swoosh|coloca|adiciona|bota|poe|nas? transi|nos? cortes?/.test(t)) && !negate) {
    const def = sfxDef(sfxHit[1])!;
    const cuts = cutPoints(p);
    const onCuts = /transi|cortes?|cada corte|entre as cenas|troca de cena/.test(t) || (!target && /whoosh|swoosh/.test(sfxHit[1]) && cuts.length > 0);
    const at = /final|fim/.test(t) ? Math.max(0, dur - def.duration) : target?.start ?? 0;
    out.macros.push(onCuts && cuts.length ? { op: 'add_sfx', sfxId: def.id, atCuts: true, explain: `${def.name} nos cortes` } : { op: 'add_sfx', sfxId: def.id, at, explain: `Efeito sonoro “${def.name}”` });
    out.said.push(onCuts && cuts.length ? `som de ${def.name.toLowerCase()} em ${cuts.length} cortes` : `som de ${def.name.toLowerCase()}`);
    out.handled.sfx = true;
  }
  return out;
}

const applyOneLib = (p: Project, op: EditOp): Project => applyOp(p, op);
