/* =====================================================================
   Cursor da IA — CONTRATO da principal (pedido do Bruno: "mostre em tempo real
   a edição… utilize um cursor para representar a IA").
   - `aiTargetFor(project, op)` (puro, testado) diz PARA ONDE o cursor vai em cada op.
   - `resolveAiTarget(target)` traduz o alvo em coordenadas de tela usando
     convenções de DOM que cada módulo expõe:
       timeline: elemento do clipe com  data-ep-clip="<clipId>"
                 contêiner da timeline com data-ep-timeline e a função global
                 window.__epTimeToClientX?.(t) (posição x de um tempo na tela)
       preview:  canvas/contêiner com    data-ep-preview  (o retângulo do QUADRO
                 do vídeo na tela; x/y normalizados 0..1 são mapeados nele)
       ferramentas: botões com           data-ep-tool="<toolId>"
   - O overlay (componente do shell) escuta store.live.current e anima até o alvo.
   ===================================================================== */
import type { Clip, Id, Project, Seconds } from './types';
import type { EditOp } from './ops';
import { findClip } from './ops';

export type AiTarget =
  | { kind: 'clip'; clipId: Id; tool?: string }
  | { kind: 'time'; t: Seconds; tool?: string }
  | { kind: 'preview'; x: number; y: number; tool?: string }
  | { kind: 'tool'; tool: string };

/** ferramenta "visitada" por tipo de ajuste (o cursor passa pelo botão antes de agir, quando visível) */
function toolForPatch(patch: Record<string, unknown>): string | undefined {
  const k = Object.keys(patch);
  if (k.some((x) => ['filters', 'colorPreset'].includes(x))) return 'filters';
  if (k.some((x) => ['effects', 'blendMode', 'mask', 'chromaKey', 'removeBackground'].includes(x))) return 'effects';
  if (k.some((x) => ['transitionIn'].includes(x))) return 'transitions';
  if (k.some((x) => ['speed', 'speedCurve', 'speedPreset', 'reverse'].includes(x))) return 'edit';
  if (k.some((x) => ['volume', 'audioEffects', 'pitch', 'fadeIn', 'fadeOut', 'muted'].includes(x))) return 'audio';
  if (k.some((x) => ['text', 'style', 'animation', 'animationIn', 'animationOut'].includes(x))) return 'text';
  return undefined;
}

function previewPointOf(clip: Clip): { x: number; y: number } | null {
  if (clip.type === 'text') return { x: clip.position.x, y: clip.position.y };
  if ('transform' in clip && clip.transform) return { x: 0.5 + clip.transform.x / 2, y: 0.5 + clip.transform.y / 2 };
  return null;
}

/** alvo do cursor para uma operação (antes de aplicá-la) */
export function aiTargetFor(p: Project, op: EditOp): AiTarget | null {
  switch (op.op) {
    case 'add_clip': {
      const pt = previewPointOf(op.clip);
      if (op.clip.type === 'text' || op.clip.type === 'sticker' || op.clip.type === 'shape') {
        return pt ? { kind: 'preview', ...pt, tool: op.clip.type === 'text' ? 'text' : 'stickers' } : { kind: 'time', t: op.clip.start };
      }
      return { kind: 'time', t: op.clip.start, tool: op.clip.type === 'audio' ? 'audio' : op.clip.type === 'adjustment' ? 'effects' : 'media' };
    }
    case 'update_clip': {
      const f = findClip(p, op.clipId);
      if (!f) return null;
      const tool = toolForPatch(op.patch as Record<string, unknown>);
      const visual = ['filters', 'effects'].includes(tool ?? '') || 'transform' in op.patch || 'keyframes' in op.patch || 'position' in op.patch;
      if (visual) {
        const pt = previewPointOf({ ...f.clip, ...(op.patch as object) } as Clip) ?? { x: 0.5, y: 0.5 };
        return { kind: 'preview', ...pt, tool };
      }
      return { kind: 'clip', clipId: op.clipId, tool };
    }
    case 'remove_clip':
    case 'trim_clip':
    case 'duplicate_clip':
      return { kind: 'clip', clipId: op.clipId };
    case 'move_clip':
      return { kind: 'time', t: op.start };
    case 'split_clip':
      return { kind: 'time', t: op.at, tool: 'edit' };
    case 'ripple_delete':
      return { kind: 'time', t: op.start, tool: 'edit' };
    case 'remove_words': {
      const words = p.captions.segments.flatMap((s) => s.words ?? []);
      const w = words.find((x) => x.id === op.fromWordId);
      return w ? { kind: 'time', t: w.start, tool: 'edit' } : null;
    }
    case 'set_captions':
    case 'set_caption_style':
    case 'toggle_captions':
      return { kind: 'preview', x: p.captions.style.position.x, y: p.captions.style.position.y, tool: 'captions' };
    case 'update_caption': {
      const s = p.captions.segments.find((x) => x.id === op.segmentId);
      return s ? { kind: 'time', t: s.start, tool: 'captions' } : null;
    }
    case 'set_aspect':
      return { kind: 'tool', tool: 'formats' };
    case 'set_project':
      return 'canvas' in op.patch ? { kind: 'preview', x: 0.5, y: 0.5, tool: 'formats' } : null;
    case 'add_marker':
      return { kind: 'time', t: op.marker.t };
    default:
      return null;
  }
}

export interface ScreenPoint { x: number; y: number }

/** coordenadas de tela do alvo (null se o elemento não estiver visível agora) */
export function resolveAiTarget(target: AiTarget, doc: Document = document): ScreenPoint | null {
  const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  switch (target.kind) {
    case 'clip': {
      const el = doc.querySelector<HTMLElement>(`[data-ep-clip="${CSS.escape(target.clipId)}"]`);
      const r = el?.getBoundingClientRect();
      return r && visible(r) ? { x: r.left + Math.min(r.width / 2, 48), y: r.top + r.height / 2 } : null;
    }
    case 'time': {
      const tl = doc.querySelector<HTMLElement>('[data-ep-timeline]');
      const fx = (window as unknown as { __epTimeToClientX?: (t: number) => number | null }).__epTimeToClientX;
      const r = tl?.getBoundingClientRect();
      const x = fx?.(target.t);
      return r && visible(r) && typeof x === 'number' ? { x, y: r.top + r.height * 0.45 } : null;
    }
    case 'preview': {
      const el = doc.querySelector<HTMLElement>('[data-ep-preview]');
      const r = el?.getBoundingClientRect();
      return r && visible(r) ? { x: r.left + target.x * r.width, y: r.top + target.y * r.height } : null;
    }
    case 'tool': {
      const el = doc.querySelector<HTMLElement>(`[data-ep-tool="${CSS.escape(target.tool)}"]`);
      const r = el?.getBoundingClientRect();
      return r && visible(r) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
  }
}

/** ritmo recomendado do applyLive quando o cursor está ativo (dá tempo de ver o movimento) */
export const AI_CURSOR_STEP_MS = 900;
