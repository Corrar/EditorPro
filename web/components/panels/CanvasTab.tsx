'use client';
/* Formatos + Tela de fundo (project.canvas) */
import { useRef } from 'react';
import { ingestFile } from '@/lib/media/ingest';
import { useEditor } from '@/lib/store';
import type { AspectRatio, Project } from '@/lib/types';
import { ColorField, Section, Seg, Slider } from './controls';
import { pct } from './hooks';

const FORMATS: { id: AspectRatio; desc: string }[] = [
  { id: '9:16', desc: 'Reels, TikTok' }, { id: '16:9', desc: 'YouTube' }, { id: '1:1', desc: 'Quadrado' }, { id: '4:5', desc: 'Feed' },
];

export default function CanvasTab() {
  const aspect = useEditor((s) => s.project.aspect);
  const canvas = useEditor((s) => s.project.canvas) ?? { type: 'color' as const, color: '#000000' };
  const bgColor = useEditor((s) => s.project.background);
  const images = useEditor((s) => Object.values(s.assets).filter((a) => a.kind === 'image'));
  const dispatch = useEditor((s) => s.dispatch);
  const input = useRef<HTMLInputElement>(null);
  const set = (c: Partial<NonNullable<Project['canvas']>>, history = true) => dispatch({ op: 'set_project', patch: { canvas: { ...canvas, ...c } } }, { history });

  return (
    <>
      <Section title="Formato">
        <div className="ep-fmtmini">
          {FORMATS.map((f) => {
            const [w, h] = f.id.split(':').map(Number);
            const k = 26 / Math.max(w, h);
            return (
              <button key={f.id} type="button" className={aspect === f.id ? 'on' : ''} onClick={() => aspect !== f.id && dispatch({ op: 'set_aspect', aspect: f.id })}>
                <i style={{ width: w * k, height: h * k }} /><b>{f.id}</b><span>{f.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Tela de fundo">
        <p className="ep-pnote">Aparece quando a mídia não preenche o quadro (ex.: vídeo horizontal em 9:16 com “Caber”).</p>
        <Seg value={canvas.type} onChange={(v) => set({ type: v })} options={[{ id: 'color', label: 'Cor' }, { id: 'blur', label: 'Desfoque' }, { id: 'image', label: 'Imagem' }]} />
        <div style={{ marginTop: 12 }}>
          {canvas.type === 'color' && <ColorField label="Cor de fundo" value={canvas.color ?? bgColor} onChange={(v, h) => set({ color: v }, h)} />}
          {canvas.type === 'blur' && <Slider label="Intensidade do desfoque" value={canvas.blur ?? 0.5} min={0} max={1} onChange={(v, h) => set({ blur: v }, h)} format={pct} />}
          {canvas.type === 'image' && (
            <>
              <div className="ep-bgimgs">
                {images.map((a) => (
                  <button key={a.id} type="button" className={canvas.assetId === a.id ? 'on' : ''} onClick={() => set({ assetId: a.id })} style={{ backgroundImage: a.thumbnails?.[0] ? `url(${a.thumbnails[0]})` : undefined }} title={a.name} />
                ))}
                <button type="button" className="add" onClick={() => input.current?.click()}>＋</button>
              </div>
              <input ref={input} type="file" hidden accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const a = await ingestFile(f, 'broll'); set({ assetId: a.id }); } }} />
            </>
          )}
        </div>
      </Section>
    </>
  );
}
