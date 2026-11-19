'use client';
/* =====================================================================
   Tela inicial — "home de app" (design v2): cabeçalho colorido com busca,
   pílulas Projetos/Modelos e cartão em carrossel; ações rápidas; card de IA;
   modelos; meus projetos. O wizard "Novo vídeo com IA" abre em tela própria.
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { mediaKindOf, formatBytes } from '@/lib/media/pure';
import { deleteProject, duplicateProject, listProjects, relativeTime, renameProject, type ProjectSummary } from '@/lib/persist';
import type { AspectRatio, MediaKind } from '@/lib/types';
import { formatTime } from '@/lib/util';
import {
  IconArrowLeft, IconChevRight, IconClose, IconCopy, IconFolder, IconHelp, IconImage, IconMic, IconMoon, IconMusic, IconPencil,
  IconSearch, IconSpark, IconSun, IconTrash, IconUpload, IconVideo, IconLayout,
} from './icons';
import { PROJECT_TEMPLATES } from './templates';
import { TOOLS, type ToolId } from './tools';
import { applySystemChrome } from './theme';

export interface WizardInput { brief: string; material: File[]; reference: File | null; aspect: AspectRatio }

const EXAMPLES = [
  'Reels dinâmico de 30s com cortes rápidos, legendas grandes e zoom nas frases de impacto',
  'Corte os silêncios, deixe o ritmo acelerado e coloque um gancho forte nos 3 primeiros segundos',
  'Vídeo de produto elegante, transições suaves, cor cinematográfica e CTA no final',
  'Tutorial passo a passo com títulos em cada etapa e legenda estilo karaokê',
];

const FORMATS: { id: AspectRatio; label: string; desc: string }[] = [
  { id: '9:16', label: '9:16', desc: 'Reels, TikTok, Shorts' },
  { id: '16:9', label: '16:9', desc: 'YouTube' },
  { id: '1:1', label: '1:1', desc: 'Feed quadrado' },
  { id: '4:5', label: '4:5', desc: 'Feed do Instagram' },
];

const KIND_ICON: Record<MediaKind, typeof IconVideo> = { video: IconVideo, image: IconImage, audio: IconMusic };
const TIP_KEY = 'ep_tip_v2';

/* ---------- wizard: peças ---------- */

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
        <span className="tx"><b>{title}{optional && <em>opcional</em>}</b><span>{sub}</span></span>
        <IconChevRight size={18} />
      </button>
      <input ref={input} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      {files.length > 0 && <div className="ep-fchips">{files.map((f, i) => <FileChip key={`${f.name}-${i}`} f={f} onRemove={() => onRemove(i)} />)}</div>}
    </div>
  );
}

function AspectGlyph({ id, size = 30 }: { id: AspectRatio; size?: number }) {
  const [w, h] = id.split(':').map(Number);
  const k = size / Math.max(w, h);
  return <i className="ep-fmtglyph" style={{ width: w * k, height: h * k }} />;
}

/* ---------- wizard (tela própria) ---------- */

function Wizard({ onStart, onEmpty, onBack, busy, focus }: { onStart: (w: WizardInput) => void; onEmpty: (a: AspectRatio) => void; onBack: () => void; busy: string | null; focus?: boolean }) {
  const [brief, setBrief] = useState('');
  const [material, setMaterial] = useState<File[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const briefRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focus) briefRef.current?.focus(); }, [focus]);
  const can = !busy && (brief.trim().length > 0 || material.length > 0);

  return (
    <div className="ep-wiz">
      <div className="ep-wiz-top">
        <button type="button" className="ep-circle" onClick={onBack} aria-label="Voltar"><IconArrowLeft size={20} /></button>
        <h1 className="ep-h-sheet">Novo vídeo com IA</h1>
        <span />
      </div>
      <form className="ep-wiz-body" onSubmit={(e) => { e.preventDefault(); if (can) onStart({ brief, material, reference, aspect }); }}>
        <section className="ep-wblock">
          <span className="ep-wstep">1</span>
          <h2>Como você quer o vídeo?</h2>
          <textarea
            ref={briefRef} id="ep-brief" className="ep-textarea ep-brief" value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder="Ex.: Reels de 30 segundos sobre minha loja, ritmo rápido, legendas amarelas e música animada…"
          />
          <div className="ep-examples">
            {EXAMPLES.map((ex) => <button key={ex} type="button" className="ep-exchip" onClick={() => setBrief(ex)}>{ex}</button>)}
          </div>
        </section>
        <section className="ep-wblock">
          <span className="ep-wstep">2</span>
          <h2>Envie o material</h2>
          <div className="ep-dzrow">
            <Dropzone title="Seu material" sub="Vídeos, fotos e músicas" multiple accept="video/*,image/*,audio/*" icon={<IconUpload size={22} />} files={material}
              onFiles={(f) => setMaterial((s) => [...s, ...f])} onRemove={(i) => setMaterial((s) => s.filter((_, j) => j !== i))} />
            <Dropzone title="Vídeo de exemplo" sub="A IA copia o ritmo e o estilo" multiple={false} accept="video/*" optional icon={<IconSpark size={22} />}
              files={reference ? [reference] : []} onFiles={(f) => setReference(f[0] ?? null)} onRemove={() => setReference(null)} />
          </div>
        </section>
        <section className="ep-wblock">
          <span className="ep-wstep">3</span>
          <h2>Formato</h2>
          <div className="ep-tiles ep-fmts" role="radiogroup" aria-label="Formato do vídeo">
            {FORMATS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={aspect === f.id} className={`ep-tile ep-fmt${aspect === f.id ? ' on' : ''}`} onClick={() => setAspect(f.id)}>
                <span className="ic"><AspectGlyph id={f.id} /></span>
                <span><span className="lb">{f.label}</span><span className="ds">{f.desc}</span></span>
              </button>
            ))}
          </div>
        </section>
        <div className="ep-wiz-acts">
          <button type="button" className="ep-btn sec" onClick={() => onEmpty(aspect)} disabled={!!busy}>Abrir editor vazio</button>
          <button type="submit" className="ep-cta accent ep-go" disabled={!can}>
            {busy ? <><span className="ep-spin sm" /> {busy}</> : <><IconSpark size={18} /> Editar com IA</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- meus projetos (linhas largas) ---------- */

function ProjectRows({ items, reload, onOpen, filter }: { items: ProjectSummary[]; reload: () => void; onOpen: (id: string) => void; filter?: string }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);
  const commitRename = async (id: string) => { const v = name.trim(); setRenaming(null); if (v) { await renameProject(id, v); reload(); } };
  const q = (filter ?? '').trim().toLowerCase();
  const list = q ? items.filter((p) => p.name.toLowerCase().includes(q)) : items;

  if (!list.length) {
    return <div className="ep-projempty"><IconFolder size={20} /><span>{q ? 'Nenhum projeto com esse nome.' : 'Seus projetos aparecem aqui — tudo fica salvo neste aparelho.'}</span></div>;
  }
  return (
    <div className="ep-rows ep-projrows">
      {list.map((p) => (
        <div key={p.id} className="ep-row ep-projrow" role="button" tabIndex={0} onClick={() => renaming !== p.id && onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' && renaming !== p.id) onOpen(p.id); }}>
          <span className={`ep-projthumb a-${p.aspect.replace(':', 'x')}`}>{p.cover ? <img src={p.cover} alt="" /> : <IconVideo size={18} />}</span>
          <span className="ep-projtx">
            {renaming === p.id ? (
              <input className="ep-input ep-proj-rename" autoFocus value={name} aria-label="Novo nome" onClick={(e) => e.stopPropagation()} onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitRename(p.id)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
            ) : <b title={p.name}>{p.name}</b>}
            <span className="meta">{formatTime(p.duration)} · {p.aspect} · {relativeTime(p.updatedAt)}</span>
          </span>
          <button type="button" className="ep-circle sm ep-proj-more" aria-label={`Opções de ${p.name}`} aria-expanded={menu === p.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}>⋯</button>
          {menu === p.id && (
            <div className="ep-proj-menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => { setMenu(null); setName(p.name); setRenaming(p.id); }}><IconPencil size={15} />Renomear</button>
              <button type="button" onClick={async () => { setMenu(null); if (await duplicateProject(p.id)) { reload(); emit('ep:toast', { text: 'Projeto duplicado', kind: 'ok' }); } }}><IconCopy size={15} />Duplicar</button>
              <button type="button" className="danger" onClick={() => { setMenu(null); setConfirm(p.id); }}><IconTrash size={15} />Excluir</button>
            </div>
          )}
          {confirm === p.id && (
            <div className="ep-proj-confirm" onClick={(e) => e.stopPropagation()}>
              <p>Apagar “{p.name}”?</p>
              <div>
                <button type="button" className="ep-pillbtn" onClick={() => setConfirm(null)}>Cancelar</button>
                <button type="button" className="ep-btn primary" onClick={async () => { await deleteProject(p.id); setConfirm(null); reload(); emit('ep:toast', { text: 'Projeto apagado', kind: 'info' }); }}>Apagar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- cabeçalho com carrossel ---------- */

function HeroCarousel({ tab, projects, onOpen, onTemplate, onNew }: {
  tab: 'projects' | 'templates'; projects: ProjectSummary[]; onOpen: (id: string) => void; onTemplate: (id: string) => void; onNew: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); ref.current?.scrollTo({ left: 0 }); }, [tab]);
  const slides = tab === 'projects' ? projects.slice(0, 5) : PROJECT_TEMPLATES;
  const count = tab === 'projects' ? Math.max(1, slides.length) : slides.length;
  return (
    <>
      <div className="ep-hcar" ref={ref} onScroll={(e) => { const el = e.currentTarget; setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {tab === 'projects' && !projects.length && (
          <div className="ep-hero2-card ep-hslide">
            <span className="sub">Comece agora</span>
            <div className="big">Crie seu primeiro vídeo com IA</div>
            <span className="sub">Descreva, envie o material e acompanhe a edição ao vivo.</span>
            <button type="button" className="ep-hero2-btn" onClick={onNew}>Começar</button>
          </div>
        )}
        {tab === 'projects' && projects.slice(0, 5).map((p, i) => (
          <div key={p.id} className="ep-hero2-card ep-hslide">
            <span className="sub">{i === 0 ? 'Continue de onde parou' : 'Projeto recente'} · {relativeTime(p.updatedAt)}</span>
            <div className="ep-hslide-name">{p.name}</div>
            <div className="big mono">{formatTime(p.duration)} <small>· {p.aspect}</small></div>
            <span className="sub">{p.clipCount} clipe{p.clipCount === 1 ? '' : 's'} · {p.assetCount} mídia{p.assetCount === 1 ? '' : 's'}</span>
            <button type="button" className="ep-hero2-btn" onClick={() => onOpen(p.id)}>Continuar editando</button>
          </div>
        ))}
        {tab === 'templates' && PROJECT_TEMPLATES.map((t) => (
          <div key={t.id} className="ep-hero2-card ep-hslide">
            <span className="sub">Modelo pronto · {t.aspect}</span>
            <div className="big">{t.emoji} {t.label}</div>
            <span className="sub">{t.desc}</span>
            <button type="button" className="ep-hero2-btn" onClick={() => onTemplate(t.id)}>Usar modelo</button>
          </div>
        ))}
      </div>
      {count > 1 && <div className="ep-dots" aria-hidden="true">{Array.from({ length: count }, (_, i) => <i key={i} className={i === page ? 'on' : ''} />)}</div>}
    </>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="ep-modal-bg" onClick={onClose}>
      <div className="ep-modal" role="dialog" aria-modal="true" aria-label="Ajuda" onClick={(e) => e.stopPropagation()}>
        <div className="ep-sheet2-head"><span /><span className="ep-h-sheet">Como funciona</span><button type="button" className="ep-circle sm" onClick={onClose} aria-label="Fechar"><IconClose size={16} /></button></div>
        <div className="ep-rows">
          <div className="ep-row static"><span><b>1. Descreva</b><span className="meta">Conte como quer o vídeo (ritmo, legendas, música).</span></span></div>
          <div className="ep-row static"><span><b>2. Envie</b><span className="meta">Seu material e, se quiser, um vídeo de exemplo.</span></span></div>
          <div className="ep-row static"><span><b>3. Acompanhe</b><span className="meta">A IA edita ao vivo; corrija pelo chat ou à mão.</span></span></div>
          <div className="ep-row static"><span><b>4. Exporte</b><span className="meta">MP4, legendas SRT ou projeto para outros editores.</span></span></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- tela inicial ---------- */

export default function Home({ onStart, onEmpty, onOpen, onTemplate, onTool, onImport, onTheme, dark, busy, canResume, onResume, focusWizard }: {
  focusWizard?: boolean; onTemplate: (id: string) => void; onTool: (t: ToolId) => void; onImport: (files: File[]) => void;
  onTheme: () => void; dark: boolean;
  onStart: (w: WizardInput) => void; onEmpty: (aspect: AspectRatio) => void; onOpen: (id: string) => void;
  busy: string | null; canResume?: string | null; onResume?: () => void;
}) {
  const [wizard, setWizard] = useState(!!focusWizard);
  const [tab, setTab] = useState<'projects' | 'templates'>('projects');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [tip, setTip] = useState(false);
  const [help, setHelp] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const qaRef = useRef<HTMLDivElement>(null);
  const [showCta, setShowCta] = useState(false);
  const tplRef = useRef<HTMLHeadingElement>(null);
  const reload = () => listProjects().then(setItems).catch(() => setItems([]));
  useEffect(() => { void reload(); }, [busy]);
  useEffect(() => { if (focusWizard) setWizard(true); }, [focusWizard]);
  useEffect(() => { try { setTip(localStorage.getItem(TIP_KEY) !== '1'); } catch {} }, []);

  // CTA flutuante "Novo vídeo" só depois que as ações rápidas saem da tela (não cobre nada na 1ª dobra)
  useEffect(() => {
    const el = qaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setShowCta(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [wizard]);

  // barra do sistema laranja só enquanto o hero laranja está no topo da tela
  const heroRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = heroRef.current;
    if (wizard || !el) { applySystemChrome(dark); return; }
    let top = true;
    applySystemChrome(dark, true);
    const scroller = el.closest('.ep-home');
    const onScroll = () => { const t = (scroller?.scrollTop ?? 0) < 24; if (t !== top) { top = t; applySystemChrome(dark, t); } };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller?.removeEventListener('scroll', onScroll); applySystemChrome(dark); };
  }, [dark, wizard]);

  const ql = q.trim().toLowerCase();
  const toolHits = useMemo(() => (ql ? TOOLS.filter((t) => t.id !== 'edit' && t.label.toLowerCase().includes(ql)) : []), [ql]);

  if (wizard) return <div className="ep-home"><Wizard onStart={onStart} onEmpty={onEmpty} onBack={() => setWizard(false)} busy={busy} focus /></div>;

  return (
    <div className="ep-home">
      <header className="ep-hero2 ep-homehero" ref={heroRef}>
        <div className="ep-hh-top">
          <span className="ep-avatar2" aria-hidden="true">B</span>
          <label className="ep-searchpill">
            <IconSearch size={18} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar projetos e ferramentas" aria-label="Buscar projetos e ferramentas" />
          </label>
          <button type="button" className="ep-circle" onClick={() => setHelp(true)} aria-label="Ajuda" title="Ajuda"><IconHelp size={20} /></button>
          <button type="button" className="ep-circle" onClick={onTheme} aria-label="Alternar tema" title={dark ? 'Tema claro' : 'Tema escuro'}>{dark ? <IconSun size={20} /> : <IconMoon size={20} />}</button>
          <button type="button" className="ep-circle ep-hh-ai" onClick={() => setWizard(true)} aria-label="Novo vídeo com IA" title="Novo vídeo com IA"><IconSpark size={20} /></button>
        </div>
        <p className="ep-hh-hello">Olá, Bruno 👋 <span>O que vamos editar hoje?</span></p>
        <div className="ep-hh-pills" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'projects'} className={`ep-pill2${tab === 'projects' ? ' on' : ''}`} onClick={() => setTab('projects')}>Projetos</button>
          <button type="button" role="tab" aria-selected={tab === 'templates'} className={`ep-pill2${tab === 'templates' ? ' on' : ''}`} onClick={() => setTab('templates')}>Modelos</button>
          {canResume && onResume && <button type="button" className="ep-pill2 ep-hh-resume" onClick={onResume}>Voltar ao editor</button>}
        </div>
        <HeroCarousel tab={tab} projects={items ?? []} onOpen={onOpen} onTemplate={onTemplate} onNew={() => setWizard(true)} />
      </header>

      <main className="ep-homebody">
        {ql && (
          <section>
            <h2 className="ep-h-section">Resultados</h2>
            {toolHits.length > 0 && (
              <div className="ep-tiles" style={{ marginBottom: 12 }}>
                {toolHits.map(({ id, label, Icon }) => (
                  <button key={id} type="button" className="ep-tile" onClick={() => onTool(id)}><span className="ic"><Icon size={24} /></span><span className="lb">{label}</span></button>
                ))}
              </div>
            )}
            <ProjectRows items={items ?? []} reload={reload} onOpen={onOpen} filter={q} />
          </section>
        )}

        <h2 className="ep-h-section">Comece por aqui</h2>
        <div className="ep-qa-row" ref={qaRef}>
          <button type="button" className="ep-qa on" onClick={() => setWizard(true)}><span className="ic"><IconSpark size={26} /></span><span className="ep-tag ep-qa-tag">IA</span><span className="lb">Novo com IA</span></button>
          <button type="button" className="ep-qa" onClick={() => importRef.current?.click()}><span className="ic"><IconUpload size={26} /></span><span className="lb">Importar mídia</span></button>
          <button type="button" className="ep-qa" onClick={() => onTool('audio')}><span className="ic"><IconMic size={26} /></span><span className="lb">Gravar narração</span></button>
          <button type="button" className="ep-qa" onClick={() => tplRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span className="ic"><IconLayout size={26} /></span><span className="lb">Modelos</span></button>
          <button type="button" className="ep-qa" onClick={() => onEmpty('9:16')}><span className="ic"><IconVideo size={26} /></span><span className="lb">Editor vazio</span></button>
        </div>
        <input ref={importRef} type="file" hidden multiple accept="video/*,image/*,audio/*" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onImport(f); }} />

        {tip && (
          <div className="ep-banner" style={{ marginTop: 24 }}>
            <span>💡 Dica: envie um vídeo de exemplo e a IA copia o ritmo, as legendas e a cor.</span>
            <button type="button" className="x" aria-label="Fechar dica" onClick={() => { setTip(false); try { localStorage.setItem(TIP_KEY, '1'); } catch {} }}><IconClose size={18} /></button>
          </div>
        )}

        <button type="button" className="ep-aicard ep-home-ai" onClick={() => setWizard(true)}>
          <span className="spark"><IconSpark size={26} /></span>
          <span><span className="t">Editar com IA</span><span className="d">Descreva o vídeo e a IA monta a edição ao vivo, passo a passo.</span></span>
          <IconChevRight size={20} />
        </button>

        <h2 className="ep-h-section" ref={tplRef}>Modelos prontos</h2>
        <div className="ep-tiles">
          {PROJECT_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="ep-tile" onClick={() => onTemplate(t.id)}>
              <span className="ic ep-tile-em">{t.emoji}</span>
              <span><span className="lb">{t.label}</span><span className="ds">{t.desc}</span></span>
            </button>
          ))}
        </div>

        <h2 className="ep-h-section">Meus projetos</h2>
        {items === null ? <div className="ep-rows"><div className="ep-skel" style={{ height: 68, borderRadius: 24 }} /><div className="ep-skel" style={{ height: 68, borderRadius: 24 }} /></div>
          : <ProjectRows items={items} reload={reload} onOpen={onOpen} />}
      </main>

      <button type="button" className={`ep-cta accent ep-homecta${showCta ? ' show' : ''}`} onClick={() => setWizard(true)} tabIndex={showCta ? 0 : -1} aria-hidden={!showCta}><IconSpark size={20} /> Novo vídeo</button>
      {help && <HelpSheet onClose={() => setHelp(false)} />}
    </div>
  );
}
