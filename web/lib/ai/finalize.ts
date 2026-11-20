/* =====================================================================
   Finaliza a resposta do Claude NO NAVEGADOR:
     1) valida as ops (e confere os shaders GLSL custom)
     2) executa os pedidos adiados: run_script (Worker isolado), add_graphic /
        update_graphic (SVG saneado -> PNG), generate_captions (flag)
     3) junta os erros (op inválida, erro de script com linha, shader que não
        compila, SVG inválido) e faz UMA rodada de conserto (mode 'repair')
        a partir do projeto com o que já deu certo
   Puro o bastante para testar: request/runScript/gráficos são injetáveis.
   ===================================================================== */
import type { ChatContext, ChatMessage, Id, MediaAsset, Project } from '../types';
import { applyOps, type EditOp } from '../ops';
import { uid } from '../util';
import type { EditRequest, EditResponse } from './client';
import type { SfxRequest } from './library';
import { sanitizeDeferredList, type Deferred } from './deferred';
import { checkShaderCode, type ShaderStage } from './optional';
import { isObj } from './sanitize';
import { sanitizeOps } from './validate';
import type { SandboxResult } from './script/sandbox';

/** teto de ops por resposta do Claude (igual ao da rota) e por script */
export const MAX_AI_OPS = 400;
export const MAX_SCRIPT_OPS = 3000;

export interface FinalizeDeps {
  request?: (req: EditRequest) => Promise<EditResponse>;
  runScript?: (code: string, p: Project, assets: Record<Id, MediaAsset>) => Promise<SandboxResult>;
  createGraphic?: (svg: string, name: string, p: Project) => Promise<MediaAsset>;
  updateGraphic?: (assetId: Id, svg: string, p: Project) => Promise<unknown>;
}

export interface FinalizeOptions extends FinalizeDeps {
  userText: string;
  getAssets: () => Record<Id, MediaAsset>;
  messages?: ChatMessage[];
  context?: ChatContext;
  onStatus?: (s: string) => void;
  /** faz a rodada de conserto quando algo falha (padrão true) */
  repair?: boolean;
  /** execução interrompida */
  signal?: AbortSignal;
}

export interface Finalized {
  ops: EditOp[];
  /** projeto simulado depois das ops */
  project: Project;
  sfx: SfxRequest[];
  reply: string;
  captions?: { language?: string };
  /** erros que sobraram (depois do conserto, se houve) */
  errors: string[];
  repaired: boolean;
}

/* ---------- shaders ---------- */

const shaderErr = (name: string | undefined, stage: ShaderStage, error: string, line?: number) =>
  `shader GLSL ${stage === 'effect' ? 'de efeito' : 'de transição'}${name ? ` "${name}"` : ''} não compila: ${error}${line ? ` (linha ${line})` : ''}`;

/** tira das ops cruas os efeitos/transições custom que não compilam (e diz por quê) */
export function filterShaders(raw: unknown, errors: string[]): unknown {
  if (!Array.isArray(raw)) return raw;
  const fixHolder = (h: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...h };
    if (Array.isArray(out.effects)) {
      out.effects = out.effects.filter((e) => {
        if (!isObj(e) || e.kind !== 'custom' || typeof e.code !== 'string') return true;
        const r = checkShaderCode(e.code, 'effect');
        if (!r.ok) errors.push(shaderErr(typeof e.name === 'string' ? e.name : undefined, 'effect', r.error, r.line));
        return r.ok;
      });
    }
    for (const k of ['transitionIn', 'transitionOut']) {
      const t = out[k];
      if (isObj(t) && t.kind === 'custom' && typeof t.code === 'string') {
        const r = checkShaderCode(t.code, 'transition');
        if (!r.ok) { errors.push(shaderErr(typeof t.name === 'string' ? t.name : undefined, 'transition', r.error, r.line)); delete out[k]; }
      }
    }
    return out;
  };
  return raw.map((o) => {
    if (!isObj(o)) return o;
    const c = { ...o };
    if (isObj(c.clip)) c.clip = fixHolder(c.clip);
    if (isObj(c.patch)) c.patch = fixHolder(c.patch);
    return c;
  });
}

/* ---------- gráficos ---------- */

/** trilha de vídeo por cima da principal, livre no trecho (senão uma nova, que fica no topo) */
export function graphicTrack(p: Project, start: number, end: number, wanted?: string): Id {
  const vids = p.tracks.filter((t) => t.kind === 'video');
  const main = vids[0]?.id;
  const free = (id: Id) => {
    const t = p.tracks.find((x) => x.id === id);
    return !!t && t.kind === 'video' && !t.locked && t.id !== main && t.clips.every((c) => c.start >= end - 1e-3 || c.start + c.duration <= start + 1e-3);
  };
  if (wanted && free(wanted)) return wanted;
  const found = vids.slice(1).reverse().find((t) => free(t.id));
  return found?.id ?? `track_gfx_${uid('t').slice(-6)}`;
}

/* ---------- materialização ---------- */

interface Pass { ops: EditOp[]; project: Project; sfx: SfxRequest[]; errors: string[]; captions?: { language?: string } }

const dropReasons = (prefix: string, d: { op: unknown; reason: string }[], max = 10) =>
  d.slice(0, max).map((x) => `${prefix}${isObj(x.op) && typeof x.op.op === 'string' ? `${x.op.op}: ` : ''}${x.reason}`.slice(0, 240));

async function materialize(res: EditResponse, base: Project, o: FinalizeOptions): Promise<Pass> {
  const errors: string[] = [...(res.droppedReasons ?? []).map((r) => `op descartada — ${r}`)];
  const raw = filterShaders(res.ops, errors);
  const san = sanitizeOps(raw, base, o.getAssets(), MAX_AI_OPS);
  errors.push(...dropReasons('op descartada — ', san.dropped));
  const ops: EditOp[] = [...san.ops];
  const sfx: SfxRequest[] = [...(res.sfx ?? []), ...san.sfx] as SfxRequest[];
  let sim = san.project;
  let captions: { language?: string } | undefined;
  const deferred: Deferred[] = [...sanitizeDeferredList(res.deferred, base, o.getAssets()), ...san.deferred];

  for (const d of deferred) {
    if (d.kind === 'captions') { captions = { language: d.language }; continue; }
    if (d.kind === 'script') {
      if (!o.runScript) { errors.push('run_script indisponível neste aparelho'); continue; }
      o.onStatus?.('Rodando o script de edição…');
      const r = await o.runScript(d.code, sim, o.getAssets());
      if ('error' in r) { errors.push(`run_script falhou: ${r.error}${r.line ? ` (linha ${r.line})` : ''}`); continue; }
      const s = sanitizeOps(filterShaders(r.ops, errors), sim, o.getAssets(), MAX_SCRIPT_OPS);
      errors.push(...dropReasons('run_script gerou op inválida — ', s.dropped, 8));
      if (s.dropped.length > 8) errors.push(`run_script: mais ${s.dropped.length - 8} ops inválidas do mesmo tipo`);
      if (!r.ops.length) errors.push('run_script não gerou nenhuma op (use ep.add/ep.update/… ou devolva um array de ops)');
      ops.push(...s.ops);
      sfx.push(...s.sfx);
      sim = s.project;
      continue;
    }
    if (d.kind === 'graphic') {
      if (!o.createGraphic) { errors.push('add_graphic indisponível neste aparelho'); continue; }
      o.onStatus?.(`Desenhando “${d.name}”…`);
      try {
        const asset = await o.createGraphic(d.svg, d.name, sim);
        const assets = { ...o.getAssets(), [asset.id]: asset };
        const trackId = graphicTrack(sim, d.start, d.start + d.duration, d.trackId);
        const clip = { label: d.name, fit: 'contain', ...d.clip, type: 'image', assetId: asset.id, start: d.start, duration: d.duration };
        const s = sanitizeOps([{ op: 'add_clip', trackId, clip, explain: d.explain ?? `Gráfico “${d.name}”` }], sim, assets);
        errors.push(...dropReasons(`add_graphic "${d.name}" — `, s.dropped));
        ops.push(...s.ops);
        sim = s.project;
      } catch (e) {
        errors.push(`add_graphic "${d.name}" falhou: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    if (d.kind === 'update_graphic') {
      // gráfico em uso: desenha um asset NOVO e troca o assetId dos clipes por ops — entra no desfazer,
      // o Parar descarta e o gráfico antigo fica intacto (re-rasterizar no lugar não tinha volta)
      const users = sim.tracks.flatMap((t) => t.clips.filter((c) => c.type === 'image' && c.assetId === d.assetId).map((c) => ({ c, t })));
      if (users.length && o.createGraphic) {
        o.onStatus?.('Redesenhando o gráfico…');
        try {
          const old = o.getAssets()[d.assetId];
          const asset = await o.createGraphic(d.svg, (old?.name ?? 'Gráfico').replace(/\.png$/i, ''), sim);
          const swap: EditOp[] = [];
          for (const { c, t } of users) {
            if (t.locked || c.locked) { errors.push(`update_graphic: o clipe ${c.id} está travado — peça para o usuário destravar`); continue; }
            swap.push({ op: 'update_clip', id: uid('op'), clipId: c.id, patch: { assetId: asset.id }, explain: d.explain ?? 'Redesenhando o gráfico' });
          }
          sim = applyOps(sim, swap).project;
          ops.push(...swap);
        } catch (e) {
          errors.push(`update_graphic ${d.assetId} falhou: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }
      if (!o.updateGraphic) { errors.push('update_graphic indisponível neste aparelho'); continue; }
      o.onStatus?.('Redesenhando o gráfico…');
      try { await o.updateGraphic(d.assetId, d.svg, sim); } catch (e) { errors.push(`update_graphic ${d.assetId} falhou: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  return { ops, project: sim, sfx, errors, captions };
}

export function repairText(userText: string, errors: string[]): string {
  return `${userText}\n\nERROS DA TENTATIVA ANTERIOR (conserte só isto; o resto já foi aplicado):\n${errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}`;
}

/** resposta do Claude -> ops prontas (com 1 rodada de conserto se algo falhar) */
export async function finalizeClaude(res: EditResponse, base: Project, o: FinalizeOptions): Promise<Finalized> {
  const a = await materialize(res, base, o);
  let reply = res.reply;
  let repaired = false;
  let { ops, project, sfx, errors, captions } = a;
  if (errors.length && o.repair !== false && o.request) {
    o.onStatus?.('Consertando o que falhou…');
    try {
      const r2 = await o.request({ project, assets: o.getAssets(), messages: o.messages ?? [], userText: repairText(o.userText, errors), mode: 'repair', context: o.context, signal: o.signal });
      const b = await materialize(r2, project, o);
      repaired = true;
      ops = [...ops, ...b.ops];
      project = b.project;
      sfx = [...sfx, ...b.sfx];
      captions = b.captions ?? captions;
      errors = b.errors;
      if (r2.reply && r2.reply !== reply && (b.ops.length || b.errors.length)) reply = `${reply}\n${r2.reply}`;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      errors = [...errors, `conserto falhou: ${e instanceof Error ? e.message : String(e)}`];
    }
  }
  return { ops, project, sfx, reply, captions, errors, repaired };
}
