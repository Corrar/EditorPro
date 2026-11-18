'use client';
/* =====================================================================
   Tela inicial: wizard "Novo projeto" + "Meus projetos".
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { mediaKindOf, formatBytes } from '@/lib/media/pure';
import { deleteProject, duplicateProject, listProjects, relativeTime, renameProject, type ProjectSummary } from '@/lib/persist';
import { PROJECT_TEMPLATES } from './templates';
import type { AspectRatio, MediaKind } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { IconClose, IconCopy, IconPencil, IconFolder, IconImage, IconMusic, IconSpark, IconTrash, IconUpload, IconVideo } from './icons';

export interface WizardInput { brief: string; material: File[]; reference: File | null; aspect: AspectRatio }

const EXAMPLES = [
  'Reels dinâmico de 30s com cortes rápidos, legendas grandes e zoom nas frases de impacto',
  'Corte os silêncios, deixe o ritmo acelerado e coloque um gancho forte nos 3 primeiros segundos',
  'Vídeo de produto elegante, transições suaves, cor cinematográfica e CTA no final',
  'Tutorial passo a passo com títulos em cada etapa e legenda estilo karaokê',
];

const FORMATS: { id: AspectRatio; label: string; desc: string }[] = [
  { id: '9:16', label: '9:16', desc: 'Reels, TikTok, Shorts' },
  { id: '16:9', label: '16:9', desc: 'YouTube, apresentações' },
  { id: '1:1', label: '1:1', desc: 'Feed quadrado' },
  { id: '4:5', label: '4:5', desc: 'Feed do Instagram' },
];

const KIND_ICON: Record<MediaKind, typeof IconVideo> = { video: IconVideo, image: IconImage, audio: IconMusic };

function FileChip({ f, onRemove }: { f: File; onRemove: () => void }) {
  const Icon = KIND_ICON[mediaKindOf(f.type, f.name) ?? 'video'];
  return (
    <span className="ep-fchip">
      <Icon size={14} />
      <span className="n" title={f.name}>{f.name}</span>
      <span className="s">{formatBytes(f.size)}</span>
      <button type="button" aria-label={`Remover ${f.name}`} onClick={onRemove}><IconClose size={12} /></button>
    </span>
  );
}

function Dropzone({ title, sub, multiple, accept, files, onFiles, onRemove, optional, icon }: {
  title: string; sub: string; multiple: boolean; accept: string; files: File[]; optional?: boolean;
  onFiles: (f: File[]) => void; onRemove: (i: number) => void; icon: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null | undefined) => {
    const arr = Array.from(list ?? []).filter((f) => {
      const k = mediaKindOf(f.type, f.name);
      return k && (accept.includes('audio') || k !== 'audio') && (accept.includes('image') || k !== 'image');
    });
    if (arr.length) onFiles(multiple ? arr : arr.slice(0, 1));
    else if (list?.length) emit('ep:toast', { text: 'Formato não suportado aqui', kind: 'error' });
  };
  return (
    <div
      className={`ep-dz${over ? ' over' : ''}${files.length ? ' has' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
    >
      <button type="button" className="ep-dz-hit" onClick={() => input.current?.click()}>
        <span className="ic">{icon}</span>
        <b>{title}{optional && <em>opcional</em>}</b>
        <span>{sub}</span>
      </button>
      <input ref={input} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      {files.length > 0 && (
        <div className="ep-fchips">
          {files.map((f, i) => <FileChip key={`${f.name}-${i}`} f={f} onRemove={() => onRemove(i)} />)}
        </div>
      )}
    </div>
  );
}

function FormatCard({ f, on, onPick }: { f: (typeof FORMATS)[number]; on: boolean; onPick: () => void }) {
  const [w, h] = f.id.split(':').map(Number);
  const k = 34 / Math.max(w, h);
  return (
    <button type="button" role="radio" aria-checked={on} className={`ep-fmt${on ? ' on' : ''}`} onClick={onPick}>
      <span className="ep-fmt-box"><i style={{ width: w * k, height: h * k }} /></span>
      <b>{f.label}</b>
      <span>{f.desc}</span>
    </button>
  );
}

function ProjectsList({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: number }) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const load = () => listProjects().then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, [refreshKey]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const commitRename = async (id: string) => {
    const v = name.trim();
    setRenaming(null);
    if (v) { await renameProject(id, v); void load(); }
  };

  if (items === null) return <div className="ep-projgrid"><div className="ep-skel" style={{ height: 150 }} /><div className="ep-skel" style={{ height: 150 }} /></div>;
  if (!items.length) {
    return (
      <div className="ep-projempty">
        <IconFolder size={20} />
        <span>Seus projetos aparecem aqui — tudo fica salvo neste navegador.</span>
      </div>
    );
  }
  return (
    <div className="ep-projgrid">
      {items.map((p) => (
        <div key={p.id} className="ep-proj" role="button" tabIndex={0} onClick={() => renaming !== p.id && onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' && renaming !== p.id) onOpen(p.id); }}>
          <div className={`ep-proj-cover a-${p.aspect.replace(':', 'x')}`}>
            {p.cover ? <img src={p.cover} alt="" /> : <IconVideo size={22} />}
            <span className="ep-proj-dur mono">{formatTime(p.duration)}</span>
          </div>
          <div className="ep-proj-meta">
            {renaming === p.id ? (
              <input
                className="ep-input ep-proj-rename" autoFocus value={name} aria-label="Novo nome"
                onClick={(e) => e.stopPropagation()} onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitRename(p.id)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
              />
            ) : <b title={p.name}>{p.name}</b>}
            <span>{relativeTime(p.updatedAt)} · {p.aspect} · {p.clipCount} clipe{p.clipCount === 1 ? '' : 's'}</span>
          </div>
          <button
            type="button" className="ep-proj-more" aria-label={`Opções de ${p.name}`} title="Opções" aria-expanded={menu === p.id}
            onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}
          >⋯</button>
          {menu === p.id && (
            <div className="ep-proj-menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => { setMenu(null); setName(p.name); setRenaming(p.id); }}><IconPencil size={15} />Renomear</button>
              <button type="button" onClick={async () => { setMenu(null); const id = await duplicateProject(p.id); if (id) { void load(); emit('ep:toast', { text: 'Projeto duplicado', kind: 'ok' }); } }}><IconCopy size={15} />Duplicar</button>
              <button type="button" className="danger" onClick={() => { setMenu(null); setConfirm(p.id); }}><IconTrash size={15} />Excluir</button>
            </div>
          )}
          {confirm === p.id && (
            <div className="ep-proj-confirm" onClick={(e) => e.stopPropagation()}>
              <p>Apagar “{p.name}”? A mídia dele também sai deste navegador.</p>
              <div>
                <button type="button" className="ep-mini" onClick={() => setConfirm(null)}>Cancelar</button>
                <button type="button" className="ep-mini danger" onClick={async () => { await deleteProject(p.id); setConfirm(null); void load(); emit('ep:toast', { text: 'Projeto apagado', kind: 'info' }); }}>Apagar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TemplatesRow({ onTemplate }: { onTemplate: (id: string) => void }) {
  return (
    <div className="ep-tplrow">
      {PROJECT_TEMPLATES.map((t) => (
        <button key={t.id} type="button" className="ep-ptpl" onClick={() => onTemplate(t.id)}>
          <span className="em">{t.emoji}</span>
          <span className="tx"><b>{t.label}</b><span>{t.desc}</span></span>
        </button>
      ))}
    </div>
  );
}

export default function Home({ onStart, onEmpty, onOpen, onTemplate, busy, canResume, onResume, focusWizard }: {
  focusWizard?: boolean; onTemplate: (id: string) => void;
  onStart: (w: WizardInput) => void; onEmpty: (aspect: AspectRatio) => void; onOpen: (id: string) => void;
  busy: string | null; canResume?: string | null; onResume?: () => void;
}) {
  const [brief, setBrief] = useState('');
  const [material, setMaterial] = useState<File[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const briefRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusWizard) briefRef.current?.focus();
  }, [focusWizard]);
  const can = !busy && (brief.trim().length > 0 || material.length > 0);

  return (
    <div className="ep-home">
      <main className="ep-homemain">
        <div className="ep-header ep-homehead">
          <div>
            <h1 className="ep-h1">Novo projeto</h1>
            <div className="ep-sub">descreva · envie o material · a IA edita ao vivo</div>
          </div>
          {canResume && onResume && <button type="button" className="ep-pillbtn ep-resume" onClick={onResume}>Voltar para “{canResume}”</button>}
        </div>
        <section className="ep-hero">
          <span className="ep-kicker"><IconSpark size={14} /> Editor de vídeo com IA</span>
          <h1>Descreva o vídeo. <span>A IA edita ao vivo.</span></h1>
          <p>Envie seu material e, se quiser, um vídeo de exemplo com o estilo que você gosta. Você acompanha cada corte na timeline e ajusta pelo chat.</p>
        </section>

        <form className="ep-wizard" onSubmit={(e) => { e.preventDefault(); if (can) onStart({ brief, material, reference, aspect }); }}>
          <div className="ep-wstep">
            <div className="ep-wnum">1</div>
            <div className="ep-wbody">
              <label className="ep-wlabel" htmlFor="ep-brief">Descreva como você quer o vídeo</label>
              <textarea
                ref={briefRef} id="ep-brief" className="ep-textarea ep-brief" value={brief} onChange={(e) => setBrief(e.target.value)}
                placeholder="Ex.: Reels de 30 segundos sobre minha loja, ritmo rápido, legendas amarelas e música animada…"
              />
              <div className="ep-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="ep-exchip" onClick={() => setBrief(ex)}>{ex}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="ep-wstep">
            <div className="ep-wnum">2</div>
            <div className="ep-wbody ep-dzrow">
              <Dropzone
                title="Seu material" sub="Vídeos, fotos e músicas · vários arquivos" multiple accept="video/*,image/*,audio/*"
                icon={<IconUpload size={22} />} files={material}
                onFiles={(f) => setMaterial((s) => [...s, ...f])} onRemove={(i) => setMaterial((s) => s.filter((_, j) => j !== i))}
              />
              <Dropzone
                title="Vídeo de exemplo (estilo)" sub="A IA copia o ritmo, as legendas e a cor" multiple={false} accept="video/*" optional
                icon={<IconSpark size={22} />} files={reference ? [reference] : []}
                onFiles={(f) => setReference(f[0] ?? null)} onRemove={() => setReference(null)}
              />
            </div>
          </div>

          <div className="ep-wstep">
            <div className="ep-wnum">3</div>
            <div className="ep-wbody">
              <span className="ep-wlabel">Formato</span>
              <div className="ep-fmts" role="radiogroup" aria-label="Formato do vídeo">
                {FORMATS.map((f) => <FormatCard key={f.id} f={f} on={aspect === f.id} onPick={() => setAspect(f.id)} />)}
              </div>
            </div>
          </div>

          <div className="ep-wactions">
            <button type="button" className="ep-btn sec" onClick={() => onEmpty(aspect)} disabled={!!busy}>Abrir editor vazio</button>
            <button type="submit" className="ep-btn primary ep-go" disabled={!can}>
              {busy ? <><span className="ep-spin sm" /> {busy}</> : <><IconSpark size={16} /> Editar com IA</>}
            </button>
          </div>
        </form>

        <section className="ep-projs">
          <h2>Começar de um modelo</h2>
          <TemplatesRow onTemplate={onTemplate} />
        </section>

        <section className="ep-projs">
          <h2>Meus projetos</h2>
          <ProjectsList onOpen={onOpen} refreshKey={busy ? 1 : 0} />
        </section>
      </main>
    </div>
  );
}
