/* =====================================================================
   Usabilidade do chat (puro, testado):
   - suggestionsFor: sugestões que fazem sentido AGORA (estado do projeto)
   - explainChanges: "o que mudou?" comparando o projeto antes/depois
   - isExplainRequest: o usuário perguntou o que a IA fez
   ===================================================================== */
import { projectDuration } from '../ops';
import type { Clip, Id, MediaAsset, Project } from '../types';
import { norm } from './demo';

const clips = (p: Project): Clip[] => p.tracks.flatMap((t) => t.clips);

export function suggestionsFor(p: Project, assets: Record<Id, MediaAsset>, max = 8): string[] {
  const all = clips(p);
  const vids = all.filter((c) => c.type === 'video');
  const out: string[] = [];
  const add = (s: string, ok = true) => { if (ok && !out.includes(s)) out.push(s); };
  const hasSource = Object.values(assets).some((a) => a.role === 'source' || a.role === 'broll');
  if (!hasSource && !vids.length) return ['Como funciona?'];
  const caps = p.captions.segments.length > 0;
  const hasMusic = all.some((c) => c.type === 'audio' && assets[c.assetId]?.role === 'music');
  const hasRef = !!p.style && !!p.referenceAssetId;
  const wide = vids.some((c) => { const a = assets[c.assetId]; return !!a?.width && !!a.height && a.width / a.height > p.width / p.height + 0.05; });
  const dur = projectDuration(p);
  const hasText = all.some((c) => c.type === 'text');
  const graded = vids.some((c) => c.colorGrade || (c.colorPreset && c.colorPreset !== 'none'));

  add('Aplicar o estilo do vídeo modelo', hasRef);
  add('Combinar a cor com o modelo', hasRef && !graded);
  add('Gerar legendas', !caps);
  add('Cortar silêncios', vids.length <= 3);
  add('Cortar vícios de linguagem', caps);
  add('Legenda estilo creator', caps);
  add('Auto-reframe seguindo o rosto', wide);
  add('Sincronizar cortes na batida', hasMusic);
  add('Zoom nas frases de ênfase', caps);
  add('Gancho com zoom e flash', !hasText);
  add(`Melhores momentos em ${dur > 70 ? 60 : dur > 35 ? 30 : 15} s`, dur > 20 && caps);
  add('CTA siga no final', !all.some((c) => c.type === 'text' && /sig[ao]|inscrev|link na bio/i.test(c.text)));
  add('Look cinema', !graded);
  add('Whoosh nas transições', vids.length >= 3);
  add('Traduzir legendas para inglês', caps);
  add('Deixar mais dinâmico');
  return out.slice(0, max);
}

export function isExplainRequest(text: string): boolean {
  const t = norm(text);
  return /^(o que|oque) (voce |vc )?(mudou|fez|alterou|editou|mexeu)|^(me )?expli(ca|que)( (o que|as) (mudou|mudanca|edic))?|^o que mudou|^resum(e|o) (as )?(mudanca|edic)/.test(t);
}

const n = (x: number, d = 1) => x.toFixed(d).replace('.', ',');

/** resumo legível das diferenças entre dois estados do projeto */
export function explainChanges(before: Project, after: Project): string {
  const lines: string[] = [];
  const d0 = projectDuration(before), d1 = projectDuration(after);
  if (Math.abs(d1 - d0) > 0.05 && d0 > 0.05) lines.push(`• Duração: ${n(d0)} s → ${n(d1)} s (${d1 < d0 ? `${n(d0 - d1)} s a menos` : `${n(d1 - d0)} s a mais`})`);
  const c0 = clips(before), c1 = clips(after);
  const ids0 = new Map(c0.map((c) => [c.id, c]));
  const ids1 = new Map(c1.map((c) => [c.id, c]));
  const added = c1.filter((c) => !ids0.has(c.id));
  const removed = c0.filter((c) => !ids1.has(c.id));
  const vid0 = c0.filter((c) => c.type === 'video').length, vid1 = c1.filter((c) => c.type === 'video').length;
  if (vid0 === 0 && vid1) lines.push(`• Material colocado na timeline (${vid1} tomada${vid1 === 1 ? '' : 's'})`);
  else if (vid1 !== vid0) lines.push(`• Cortes: ${vid0} → ${vid1} tomada${vid1 === 1 ? '' : 's'} de vídeo`);
  const kinds: Record<string, string> = { text: 'texto', sticker: 'sticker', shape: 'forma', audio: 'áudio', adjustment: 'camada de ajuste', image: 'imagem' };
  for (const [k, label] of Object.entries(kinds)) {
    const a = added.filter((c) => c.type === k).length, r = removed.filter((c) => c.type === k).length;
    if (a) lines.push(`• +${a} ${label}${a > 1 ? (label.endsWith('m') ? 'ns' : 's') : ''}${k === 'text' ? `: ${added.filter((c) => c.type === 'text').map((c) => `“${(c as { text: string }).text.slice(0, 30)}”`).slice(0, 3).join(', ')}` : ''}`);
    if (r) lines.push(`• −${r} ${label}${r > 1 ? (label.endsWith('m') ? 'ns' : 's') : ''}`);
  }
  // mudanças em clipes que continuam
  let zoom = 0, color = 0, trans = 0, fx = 0, speed = 0, vol = 0;
  for (const c of c1) {
    const o = ids0.get(c.id) as Record<string, unknown> | undefined;
    if (!o) continue;
    const x = c as unknown as Record<string, unknown>;
    const ch = (k: string) => JSON.stringify(x[k] ?? null) !== JSON.stringify(o[k] ?? null);
    if (ch('keyframes') || ch('transform')) zoom++;
    if (ch('colorGrade') || ch('colorPreset') || ch('filters')) color++;
    if (ch('transitionIn')) trans++;
    if (ch('effects')) fx++;
    if (ch('speed') || ch('speedCurve') || ch('speedPreset')) speed++;
    if (ch('volume') || ch('audioEffects')) vol++;
  }
  const pl = (k: number) => (k > 1 ? 's' : '');
  if (zoom) lines.push(`• Zoom/enquadramento em ${zoom} clipe${pl(zoom)}`);
  if (color) lines.push(`• Cor ajustada em ${color} clipe${pl(color)}`);
  if (trans) lines.push(`• Transições em ${trans} corte${pl(trans)}`);
  if (fx) lines.push(`• Efeitos em ${fx} clipe${pl(fx)}`);
  if (speed) lines.push(`• Velocidade em ${speed} clipe${pl(speed)}`);
  if (vol) lines.push(`• Áudio/volume em ${vol} clipe${pl(vol)}`);
  const s0 = before.captions, s1 = after.captions;
  if (s1.segments.length !== s0.segments.length) lines.push(`• Legendas: ${s0.segments.length} → ${s1.segments.length}`);
  else if (JSON.stringify(s1.segments.map((s) => s.text)) !== JSON.stringify(s0.segments.map((s) => s.text))) lines.push('• Texto das legendas alterado');
  if (JSON.stringify(s1.style) !== JSON.stringify(s0.style)) lines.push(`• Estilo da legenda${s1.style.preset !== s0.style.preset ? ` (${s1.style.preset})` : ''}`);
  if (s1.enabled !== s0.enabled) lines.push(s1.enabled ? '• Legendas ligadas' : '• Legendas escondidas');
  if (after.aspect !== before.aspect) lines.push(`• Formato: ${before.aspect} → ${after.aspect}`);
  const m0 = (before.markers ?? []).length, m1 = (after.markers ?? []).length;
  if (m1 !== m0) lines.push(`• Marcadores: ${m0} → ${m1}`);
  if (after.style !== before.style && after.style) lines.push('• Estilo do vídeo modelo guardado');
  return lines.length ? lines.join('\n') : 'Nada mudou no projeto nessa edição.';
}

export function isHelpRequest(text: string): boolean {
  return /^(como funciona|ajuda|o que voce (faz|sabe fazer)|o que da pra fazer|help)\??$/.test(norm(text));
}

export const HELP_TEXT = [
  'Funciona assim:',
  '1. Toque no 📎 e envie o seu vídeo (material bruto). Se quiser, envie também um "vídeo modelo" para eu copiar o estilo.',
  '2. Diga como quer o vídeo ("Reels dinâmico com legenda amarela e gancho") e eu edito ao vivo na timeline.',
  '3. Peça correções aqui mesmo: "legenda maior", "corta as pausas maiores que 1 s", "look cinema", "tira o zoom do começo".',
  'Toque e segure um clipe ou trecho para "apontar" e pedir uma mudança só ali. "O que mudou?" explica cada edição e dá para desfazer.',
].join('\n');
