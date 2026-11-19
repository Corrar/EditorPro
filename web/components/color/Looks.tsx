'use client';
/* =====================================================================
   Looks/LUTs: grade de miniaturas (o quadro do clipe com a correção atual
   + cada look), intensidade e "Importar .cube" (salvo no IndexedDB).
   ===================================================================== */
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ColorGrade } from '@/lib/types';
import { BUILTIN_LOOKS, deleteImportedLut, importCubeFile, importedLuts, loadImportedLuts, onLutsChanged } from '@/lib/color/luts';
import { CubeParseError } from '@/lib/color/cube';
import { getColorGrader } from '@/lib/color/gl';
import { resolveGrade } from '@/lib/color/pipeline';
import { getLut, lutVersion } from '@/lib/color/luts';
import { normalizeGrade } from '@/lib/color/grade';
import { emit } from '@/lib/events';
import Icon from '@/components/ui/Icon';
import { ColorSlider, type Phase } from './controls';
import type { ClipFrame } from './useClipFrame';

type SetGrade = (fn: (g: ColorGrade) => ColorGrade, phase: Phase) => void;

let lutsVersion = 0;
const subscribe = (f: () => void) => onLutsChanged(() => { lutsVersion++; f(); });
const snap = () => lutsVersion;

const Thumb = memo(function Thumb({ frame, grade, gradeKey, id, swatch, label, on, onPick, onDelete }: {
  frame: ClipFrame | null; grade: ColorGrade; gradeKey: string; id: string | null; swatch?: [string, string]; label: string; on: boolean;
  onPick: () => void; onDelete?: () => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  // lê frame/grade por ref: o efeito só roda com quadro novo, grade diferente (por valor) ou outro look
  const live = useRef({ frame, grade });
  live.current = { frame, grade };
  useEffect(() => {
    const { frame, grade } = live.current;
    const c = cv.current;
    if (!c || !frame) { setDrawn(false); return; }
    const src = frame.canvas;
    const W = 132, H = Math.max(40, Math.round((W * src.height) / Math.max(1, src.width)));
    const tw = Math.min(W, 132), th = Math.min(H, 132);
    if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const g: ColorGrade = { ...grade, lut: id ? { id, intensity: grade.lut?.id === id ? grade.lut.intensity : 1 } : undefined };
    const out = getColorGrader('ui')?.render(src, resolveGrade(g, getLut), tw, th);
    ctx.clearRect(0, 0, tw, th);
    try {
      // recorte central (miniaturas quadradas)
      ctx.drawImage((out ?? src) as CanvasImageSource, 0, 0, tw, th);
      setDrawn(true);
    } catch { setDrawn(false); }
  }, [frame?.version, frame?.canvas, gradeKey, id, lutsV(id)]);
  return (
    <div className={`ec-look${on ? ' on' : ''}`}>
      <button type="button" className="ec-look-btn" onClick={onPick} aria-pressed={on} aria-label={`Look ${label}`}>
        <span className="ec-look-img" style={swatch && !drawn ? { background: `linear-gradient(135deg, ${swatch[0]}, ${swatch[1]})` } : undefined}>
          <canvas ref={cv} style={{ opacity: drawn ? 1 : 0 }} />
          {on && <span className="ec-look-check"><Icon name="check" size={14} strokeWidth={3} /></span>}
        </span>
        <span className="ec-look-l">{label}</span>
      </button>
      {onDelete && (
        <button type="button" className="ec-look-del" aria-label={`Remover ${label}`} title="Remover LUT" onClick={onDelete}><Icon name="close" size={13} /></button>
      )}
    </div>
  );
});

/** a miniatura de LUT importada precisa redesenhar quando ela carrega/sai do registro */
const lutsV = (id: string | null) => (id && id.startsWith('cube:') ? lutVersion() : 0);

export function LooksTab({ grade, set, frame }: { grade: ColorGrade; set: SetGrade; frame: ClipFrame | null }) {
  useSyncExternalStore(subscribe, snap, snap);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadImportedLuts(); }, []);
  const cur = grade.lut?.id ?? null;
  // a miniatura mostra a correção atual SEM a LUT atual + a LUT candidata
  const gradeKey = JSON.stringify(normalizeGrade({ ...grade, lut: undefined }) ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base: ColorGrade = useMemo(() => ({ ...grade, lut: undefined }), [gradeKey]);
  const pick = (id: string | null) => set((g) => ({ ...g, lut: id ? { id, intensity: g.lut?.id === id ? g.lut.intensity : 1 } : undefined }), 'once');
  const imported = importedLuts();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let last: string | null = null;
    for (const f of Array.from(files)) {
      try {
        const l = await importCubeFile(f);
        last = l.id;
        emit('ep:toast', { text: `LUT "${l.name}" importada (${l.size}³)`, kind: 'ok' });
      } catch (e) {
        emit('ep:toast', { text: e instanceof CubeParseError ? `Arquivo .cube inválido: ${e.message}` : 'Não foi possível importar a LUT', kind: 'error' });
      }
    }
    setBusy(false);
    if (last) pick(last);
    if (file.current) file.current.value = '';
  };

  return (
    <div className="ec-looks">
      {cur && (
        <div className="ec-looks-int">
          <ColorSlider label="Intensidade do look" value={grade.lut?.intensity ?? 1} min={0} max={1} def={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v, ph) => set((g) => (g.lut ? { ...g, lut: { ...g.lut, intensity: v } } : g), ph)} />
        </div>
      )}
      <div className="ec-look-grid">
        <Thumb frame={frame} grade={base} gradeKey={gradeKey} id={null} label="Nenhum" on={!cur} onPick={() => pick(null)} swatch={['#3a3b40', '#9a9ca1']} />
        {BUILTIN_LOOKS.map((l) => (
          <Thumb key={l.id} frame={frame} grade={base} gradeKey={gradeKey} id={l.id} label={l.name} swatch={l.swatch} on={cur === l.id} onPick={() => pick(l.id)} />
        ))}
        {imported.map((l) => (
          <Thumb key={l.id} frame={frame} grade={base} gradeKey={gradeKey} id={l.id} label={l.name} swatch={['#2a2b2f', '#F2681F']} on={cur === l.id}
            onPick={() => pick(l.id)}
            onDelete={() => { void deleteImportedLut(l.id); if (cur === l.id) pick(null); }} />
        ))}
        <div className="ec-look">
          <button type="button" className="ec-look-btn ec-look-import" onClick={() => file.current?.click()} disabled={busy}>
            <span className="ec-look-img"><Icon name="upload" size={22} /></span>
            <span className="ec-look-l">{busy ? 'Importando…' : 'Importar .cube'}</span>
          </button>
          <input ref={file} type="file" accept=".cube,text/plain" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        </div>
      </div>
      {cur && !getLut(cur) && <p className="ec-hint warn">Esta LUT não está neste aparelho. Importe o arquivo .cube de novo para vê-la.</p>}
    </div>
  );
}
