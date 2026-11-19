'use client';
/* =====================================================================
   Barra de ferramentas do editor no celular (≤899px) — padrão CapCut (design v2.2).
   - nível 1: ferramentas em rolagem horizontal (+ IA em destaque)
   - nível 2: sub-ferramentas com ‹ voltar
   - contextual: ações do clipe selecionado (por tipo)
   Ações com parâmetros abrem o ToolSheet (sheet baixo, ✓ confirma = 1 desfazer, ↺ redefine).
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import { makeTextClip } from '@/lib/defaults';
import { emit } from '@/lib/events';
import { ingestFile } from '@/lib/media/ingest';
import { targetTrackId } from '@/lib/media/place';
import { findClip } from '@/lib/ops';
import { useEditor } from '@/lib/store';
import { detachAudio, duplicateClips, freezeFrame, removeClips, splitAtPlayhead } from '@/lib/timeline/actions';
import type { Clip } from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { uid } from '@/lib/util';
import ToolSheet, { type SheetKind } from './ToolSheet';
import { useAudioView } from '@/components/panels/AudioTab';
import type { ToolId } from './tools';

interface Item { id: string; label: string; icon: IconName; run: () => void; on?: boolean; danger?: boolean; tag?: string }

const toast = (text: string, kind: 'ok' | 'error' | 'info' = 'info') => emit('ep:toast', { text, kind });

export default function MobileToolbar({ onTool, onAi, onMenu, tool, toolOpen }: {
  onTool: (t: ToolId) => void; onAi: () => void; onMenu: () => void; tool: ToolId; toolOpen: boolean;
}) {
  const selId = useEditor((s) => s.selection[0]);
  const clip = useEditor((s) => (s.selection[0] ? findClip(s.project, s.selection[0])?.clip ?? null : null));
  const select = useEditor((s) => s.select);
  const [level2, setLevel2] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pipInput = useRef<HTMLInputElement>(null);
  const [edges, setEdges] = useState({ l: false, r: true });

  // ao mudar de modo, volta ao início da faixa
  const mode = clip ? `ctx-${clip.type}` : level2 ?? 'root';
  useEffect(() => { scroller.current?.scrollTo({ left: 0 }); updateEdges(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!selId) setSheet(null); }, [selId]);
  const updateEdges = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  const openPanel = (t: ToolId) => onTool(t);
  const isOn = (t: ToolId) => toolOpen && tool === t;

  const addPip = async (f: File | undefined) => {
    if (!f) return;
    try {
      const a = await ingestFile(f, 'broll');
      const st = useEditor.getState();
      const id = uid('clip');
      const base = { id, start: Math.round(st.playhead * 100) / 100, transform: { ...DEFAULT_TRANSFORM, scale: 0.42, x: 0.25, y: -0.25 }, filters: [], label: a.name };
      const c: Clip = a.kind === 'video'
        ? { ...base, type: 'video', assetId: a.id, duration: a.duration || 3, in: 0, speed: 1, volume: 1 }
        : { ...base, type: 'image', assetId: a.id, duration: 3 };
      st.dispatch({ op: 'add_clip', trackId: uid('track_video'), clip: c, explain: 'Adicionando sobreposição' });
      st.select([id]);
      toast('Sobreposição adicionada — ajuste em Posição', 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Falha ao importar', 'error'); }
  };

  const firstVideoAtPlayhead = () => {
    const st = useEditor.getState();
    const t = st.playhead;
    const c = st.project.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).flatMap((tr) => tr.clips).find((x) => t >= x.start && t < x.start + x.duration)
      ?? st.project.tracks.flatMap((tr) => tr.clips)[0];
    if (c) st.select([c.id]); else toast('Adicione um vídeo primeiro (Mídia)');
  };

  const extractFromVideo = () => {
    const st = useEditor.getState();
    const v = st.selection.map((id) => findClip(st.project, id)?.clip).find((c) => c?.type === 'video')
      ?? st.project.tracks.flatMap((t) => t.clips).find((c) => c.type === 'video' && st.playhead >= c.start && st.playhead < c.start + c.duration);
    if (!v) return toast('Posicione o cursor sobre um vídeo');
    detachAudio([v.id]);
  };

  /* ---------- listas ---------- */
  // ordem e rótulos como no CapCut (v2.3); "IA"/"Novo" são selos pequenos sobre o ícone
  const root: Item[] = [
    { id: 'edit', label: 'Editar', icon: 'edit', run: firstVideoAtPlayhead },
    { id: 'audio', label: 'Áudio', icon: 'audio', run: () => setLevel2('audio') },
    { id: 'text', label: 'Texto', icon: 'text', run: () => setLevel2('text') },
    { id: 'effects', label: 'Efeitos', icon: 'effects', run: () => openPanel('effects'), on: isOn('effects') },
    { id: 'overlay', label: 'Sobrepor', icon: 'overlay', run: () => pipInput.current?.click() },
    { id: 'captions', label: 'Legendas', icon: 'captions', run: () => openPanel('captions'), on: isOn('captions') },
    { id: 'filters', label: 'Filtros', icon: 'filters', run: () => openPanel('filters'), on: isOn('filters') },
    { id: 'adjust', label: 'Ajustar', icon: 'adjust', run: () => openPanel('adjust'), on: isOn('adjust') },
    { id: 'stickers', label: 'Stickers', icon: 'stickers', run: () => openPanel('stickers'), on: isOn('stickers') },
    { id: 'templates', label: 'Modelos', icon: 'templates', run: () => openPanel('templates'), on: isOn('templates'), tag: 'Novo' },
    { id: 'gen', label: 'Gerar com IA', icon: 'ai', run: () => openPanel('media'), on: isOn('media'), tag: 'IA' },
    { id: 'format', label: 'Proporção', icon: 'formats', run: () => openPanel('canvas'), on: isOn('canvas') },
    { id: 'bg', label: 'Fundo', icon: 'background', run: () => openPanel('canvas') },
    { id: 'transitions', label: 'Transições', icon: 'transitions', run: () => openPanel('transitions'), on: isOn('transitions') },
    { id: 'media', label: 'Mídia', icon: 'media', run: () => openPanel('media') },
    { id: 'review', label: 'Revisão', icon: 'review', run: () => openPanel('review'), on: isOn('review') },
    { id: 'more', label: 'Mais', icon: 'grid', run: onMenu },
  ];

  const sub: Record<string, Item[]> = {
    audio: [
      { id: 'music', label: 'Músicas', icon: 'music', run: () => { useAudioView.setState({ view: 'music' }); openPanel('audio'); } },
      { id: 'sfx', label: 'Efeitos sonoros', icon: 'sfx', run: () => { useAudioView.setState({ view: 'sfx' }); openPanel('audio'); } },
      { id: 'rec', label: 'Narração', icon: 'mic', run: () => { useAudioView.setState({ view: 'music' }); openPanel('audio'); } },
      { id: 'extract', label: 'Extrair áudio', icon: 'music', run: extractFromVideo },
    ],
    text: [
      { id: 'add', label: 'Adicionar', icon: 'add', run: () => {
        const st = useEditor.getState();
        const c = makeTextClip('Digite seu texto', Math.round(st.playhead * 100) / 100, 2.5, { label: 'texto', position: { x: 0.5, y: 0.5 }, animation: 'fade' });
        st.dispatch({ op: 'add_clip', trackId: targetTrackId(st.project, 'text'), clip: c, explain: 'Adicionando texto' });
        st.select([c.id]); st.setPlayhead(c.start + 0.5); setSheet('text');
      } },
      { id: 'tpl', label: 'Modelos de texto', icon: 'templates', run: () => openPanel('text') },
      { id: 'motion', label: 'Animados', icon: 'film', run: () => openPanel('templates') },
      { id: 'auto', label: 'Legendas auto', icon: 'captions', run: () => emit('ep:generate-captions', {}) },
      { id: 'capstyle', label: 'Estilo legenda', icon: 'font', run: () => openPanel('captions') },
      { id: 'stk', label: 'Stickers', icon: 'stickers', run: () => openPanel('stickers') },
    ],
  };

  const S = (k: SheetKind) => () => setSheet(k);
  const common = { dup: { id: 'dup', label: 'Duplicar', icon: 'copy' as IconName, run: () => duplicateClips() }, del: { id: 'del', label: 'Excluir', icon: 'delete' as IconName, run: () => removeClips(), danger: true } };
  const ctx: Record<Clip['type'], Item[]> = {
    video: [
      { id: 'split', label: 'Dividir', icon: 'cut', run: () => splitAtPlayhead() },
      { id: 'speed', label: 'Velocidade', icon: 'speed', run: S('speed') },
      { id: 'vol', label: 'Volume', icon: 'volume', run: S('volume') },
      { id: 'anim', label: 'Animações', icon: 'loop', run: S('anim') },
      { id: 'fx', label: 'Efeitos', icon: 'effects', run: S('effects') },
      { id: 'flt', label: 'Filtros', icon: 'filters', run: S('filters') },
      { id: 'adj', label: 'Ajustes', icon: 'adjust', run: S('adjust') },
      { id: 'pos', label: 'Posição', icon: 'fullscreen', run: S('motion') },
      { id: 'mask', label: 'Máscara', icon: 'shapes', run: S('mask') },
      { id: 'chroma', label: 'Chroma', icon: 'chroma', run: S('chroma') },
      { id: 'crop', label: 'Recortar', icon: 'crop', run: S('crop') },
      { id: 'bg', label: 'Remover fundo', icon: 'user', run: S('bg') },
      { id: 'blend', label: 'Mesclar', icon: 'layers', run: S('blend') },
      { id: 'replace', label: 'Substituir', icon: 'replace', run: S('edit') },
      { id: 'rev', label: 'Reverso', icon: 'reverse', run: () => { const c = clip as Extract<Clip, { type: 'video' }>; useEditor.getState().dispatch({ op: 'update_clip', clipId: c.id, patch: { reverse: !c.reverse } }); toast(c.reverse ? 'Reverso desligado' : 'Reproduzindo ao contrário', 'ok'); }, on: clip?.type === 'video' && !!clip.reverse },
      { id: 'freeze', label: 'Congelar', icon: 'freeze', run: () => void freezeFrame() },
      { id: 'detach', label: 'Extrair áudio', icon: 'music', run: () => detachAudio() },
      common.dup, common.del,
    ],
    image: [
      { id: 'split', label: 'Dividir', icon: 'cut', run: () => splitAtPlayhead() },
      { id: 'anim', label: 'Animações', icon: 'loop', run: S('anim') },
      { id: 'fx', label: 'Efeitos', icon: 'effects', run: S('effects') },
      { id: 'flt', label: 'Filtros', icon: 'filters', run: S('filters') },
      { id: 'adj', label: 'Ajustes', icon: 'adjust', run: S('adjust') },
      { id: 'pos', label: 'Posição', icon: 'fullscreen', run: S('motion') },
      { id: 'mask', label: 'Máscara', icon: 'shapes', run: S('mask') },
      { id: 'chroma', label: 'Chroma', icon: 'chroma', run: S('chroma') },
      { id: 'crop', label: 'Recortar', icon: 'crop', run: S('crop') },
      { id: 'bg', label: 'Remover fundo', icon: 'user', run: S('bg') },
      { id: 'replace', label: 'Substituir', icon: 'replace', run: S('edit') },
      common.dup, common.del,
    ],
    text: [
      { id: 'edit', label: 'Editar', icon: 'rename', run: S('text') },
      { id: 'style', label: 'Estilo', icon: 'filters', run: S('text') },
      { id: 'font', label: 'Fonte', icon: 'font', run: S('text') },
      { id: 'anim', label: 'Animação', icon: 'loop', run: S('text') },
      { id: 'split', label: 'Dividir', icon: 'cut', run: () => splitAtPlayhead() },
      common.dup, common.del,
    ],
    audio: [
      { id: 'vol', label: 'Volume', icon: 'volume', run: S('volume') },
      { id: 'fades', label: 'Fades', icon: 'fades', run: S('volume') },
      { id: 'vfx', label: 'Efeitos de voz', icon: 'voicefx', run: S('volume') },
      { id: 'speed', label: 'Velocidade', icon: 'speed', run: S('speed') },
      { id: 'beats', label: 'Batidas', icon: 'beats', run: S('volume') },
      { id: 'split', label: 'Dividir', icon: 'cut', run: () => splitAtPlayhead() },
      common.dup, common.del,
    ],
    sticker: [
      { id: 'style', label: 'Sticker', icon: 'stickers', run: S('style') },
      { id: 'anim', label: 'Animação', icon: 'loop', run: S('anim') },
      { id: 'pos', label: 'Posição', icon: 'fullscreen', run: S('motion') },
      { id: 'blend', label: 'Opacidade', icon: 'layers', run: S('blend') },
      { id: 'fx', label: 'Efeitos', icon: 'effects', run: S('effects') },
      common.dup, common.del,
    ],
    shape: [
      { id: 'style', label: 'Estilo', icon: 'shapes', run: S('style') },
      { id: 'anim', label: 'Animação', icon: 'loop', run: S('anim') },
      { id: 'pos', label: 'Posição', icon: 'fullscreen', run: S('motion') },
      { id: 'blend', label: 'Opacidade', icon: 'layers', run: S('blend') },
      common.dup, common.del,
    ],
    adjustment: [
      { id: 'adj', label: 'Ajustes', icon: 'adjust', run: S('adjust') },
      { id: 'flt', label: 'Filtros', icon: 'filters', run: S('filters') },
      { id: 'fx', label: 'Efeitos', icon: 'effects', run: S('effects') },
      common.dup, common.del,
    ],
  };

  const items = clip ? ctx[clip.type] : level2 ? sub[level2] : root;
  const back = clip ? () => select([]) : level2 ? () => setLevel2(null) : null;
  const backLabel = clip ? { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', text: 'Texto', sticker: 'Sticker', shape: 'Forma', adjustment: 'Ajuste' }[clip.type] : level2 === 'audio' ? 'Áudio' : level2 === 'text' ? 'Texto' : '';

  return (
    <>
      <nav className={`ep-mtools${back ? ' lvl2' : ''}`} aria-label="Ferramentas de edição">
        {back && (
          <button type="button" className="ep-mtback" onClick={back} aria-label={clip ? 'Desmarcar clipe' : 'Voltar'}>
            <Icon name="prev" size={22} /><span>{backLabel}</span>
          </button>
        )}
        <div className={`ep-mtscroll${edges.l ? ' fl' : ''}${edges.r ? ' fr' : ''}`} ref={scroller} onScroll={updateEdges} key={mode}>
          {items.map((it) => (
            <button key={it.id} type="button" className={`ep-mtitem${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}`} onClick={it.run}>
              <span className="ic"><Icon name={it.icon} size={24} strokeWidth={1.6} />{it.tag && <span className="ep-tag ep-mttag">{it.tag}</span>}</span>
              <span className="lb">{it.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <input ref={pipInput} type="file" hidden accept="video/*,image/*" onChange={(e) => { void addPip(e.target.files?.[0]); e.target.value = ''; }} />
      {sheet && clip && <ToolSheet kind={sheet} clip={clip} onClose={() => setSheet(null)} />}
    </>
  );
}
