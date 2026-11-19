/* =====================================================================
   Biblioteca · pacote 4 de modelos de texto/motion (+52), em 12 categorias:
   abertura, lower thirds, CTA, redes, listas, citações, oferta, destaque,
   tutorial, eventos, notícias e finais. Fábricas pequenas geram variações
   coerentes; tudo vira TextClip/ShapeClip/StickerClip editáveis depois.
   ===================================================================== */
import type { TextStyle } from '../types';
import type { Frame, Piece, TemplateCategory, TemplateDef, TemplateKind, TextPiece } from './templates';
import { P, N, ts, mx, ly, leftX, fy, sq } from './tplkit';

type St = Partial<TextStyle>;
const BLK = '#141414', WHT = '#FFFFFF', YEL = '#FFE14D';

const T = (id: string, name: string, kind: TemplateKind, category: TemplateCategory, duration: number, description: string,
  params: TemplateDef['params'], build: TemplateDef['build'], extra: Partial<TemplateDef> = {}): TemplateDef =>
  ({ id, name, kind, category, duration, description, params, build, ...extra });

/* ---------- fábricas ---------- */

/** título grande (gancho) + linha opcional */
function bigTitle(id: string, name: string, desc: string, defTitle: string, defSub: string, style: St, opts: {
  y?: number; sub?: St; anim?: TextPiece['animation']; loop?: TextPiece['animationLoop']; out?: TextPiece['animationOut']; category?: TemplateCategory;
} = {}): TemplateDef {
  return T(id, name, 'texto', opts.category ?? 'abertura', 3, desc, [P('titulo', 'Título', defTitle), P('sub', 'Linha de apoio', defSub)], (v) => {
    const y = opts.y ?? 0.45;
    const big = ts(style);
    const subSt = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 52, color: WHT, shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 14, ...opts.sub });
    return [
      { kind: 'text', text: v.titulo, style: big, x: 0.5, y, animation: opts.anim ?? 'stomp', animationOut: opts.out ?? 'fade', ...(opts.loop ? { animationLoop: opts.loop } : {}) },
      { kind: 'text', text: v.sub, style: subSt, x: 0.5, y: y + fy(big.fontSize ?? 120) * 0.85 + 0.03, t0: 0.35, animation: 'slide-up', animationOut: 'fade' },
    ];
  });
}

/** lower third com decoração variável */
function lowerThird(id: string, name: string, desc: string, deco: 'pill' | 'tag' | 'underline' | 'glass' | 'block' | 'outline', color: string,
  defs: { nome: string; funcao: string; icon?: string; labels?: [string, string] } = { nome: 'Ana Souza', funcao: 'Fundadora' }): TemplateDef {
  const labels = defs.labels ?? ['Nome', 'Função'];
  return T(id, name, 'motion', 'lower-third', 4, desc, [P('nome', labels[0], defs.nome), P('funcao', labels[1], defs.funcao)], (v, f) => {
    const left = mx(f);
    const y = ly(f);
    const nameTxt = defs.icon ? `${defs.icon} ${v.nome}` : v.nome;
    const dark = deco === 'pill' || deco === 'block';
    const nameSt = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 58, color: dark ? WHT : WHT, align: 'left', ...(dark ? {} : { shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 14 }) });
    const roleSt = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: 38, color: deco === 'tag' ? BLK : 'rgba(255,255,255,.92)', align: 'left', ...(deco === 'tag' ? {} : { shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 12 }) });
    const hasRole = !!v.funcao?.trim();
    const pad = 0.035;
    const tl = left + pad;
    const nw = f.textW(nameTxt, nameSt) + pad * 2;
    const nh = fy(58) * 1.7;
    const rw = f.textW(v.funcao, roleSt) + pad * 2;
    const rh = fy(38) * 1.7;
    const ry = y + nh / 2 + rh / 2 + 0.008;
    const pieces: Piece[] = [];
    if (deco === 'pill') pieces.push({ kind: 'shape', shape: 'line', fill: color, box: { cx: left + nw / 2, cy: y, w: nw, h: nh }, animIn: 'slide-right', animOut: 'slide-left' });
    if (deco === 'block') pieces.push({ kind: 'shape', shape: 'rect', fill: color, box: { cx: left + nw / 2, cy: y, w: nw, h: nh }, animIn: 'slide-right', animOut: 'slide-left' });
    if (deco === 'glass') pieces.push({ kind: 'shape', shape: 'rounded-rect', fill: 'rgba(255,255,255,.16)', stroke: 'rgba(255,255,255,.5)', strokeWidth: 3, radiusPx: 26 * f.H / 1920, box: { cx: left + Math.max(nw, rw) / 2, cy: hasRole ? (y + ry) / 2 : y, w: Math.max(nw, rw), h: hasRole ? nh + rh + 0.01 : nh }, animIn: 'zoom-in', animOut: 'fade' });
    if (deco === 'outline') pieces.push({ kind: 'shape', shape: 'rounded-rect', fill: 'rgba(0,0,0,.35)', stroke: color, strokeWidth: 6, radiusPx: 18 * f.H / 1920, box: { cx: left + nw / 2, cy: y, w: nw, h: nh }, animIn: 'pop', animOut: 'fade' });
    if (deco === 'underline') pieces.push({ kind: 'shape', shape: 'line', fill: color, box: { cx: left + (nw - pad) / 2, cy: y + nh * 0.5, w: nw - pad, h: 0.006 }, t0: 0.2, animIn: 'slide-right', animOut: 'fade' });
    pieces.push({ kind: 'text', text: nameTxt, style: nameSt, x: leftX(f, tl, nameTxt, nameSt), y, t0: 0.15, animation: 'fade', animationOut: 'fade' });
    if (deco === 'tag') pieces.push({ kind: 'shape', requires: ['funcao'], shape: 'line', fill: color, box: { cx: left + rw / 2, cy: ry, w: rw, h: rh }, t0: 0.25, animIn: 'slide-right', animOut: 'slide-left' });
    pieces.push({ kind: 'text', text: v.funcao, style: roleSt, x: leftX(f, tl, v.funcao, roleSt), y: deco === 'tag' ? ry : y + nh * 0.5 + fy(38) * 0.9, t0: 0.3, animation: 'fade', animationOut: 'fade' });
    return pieces;
  });
}

/** botão de CTA em pílula com emoji animado */
function ctaPill(id: string, name: string, desc: string, defText: string, emoji: string, bg: string, fg: string, loop: 'bounce' | 'swing' | 'zoom-in' | 'shake' = 'bounce', shape: 'line' | 'rounded-rect' = 'line'): TemplateDef {
  return T(id, name, 'motion', 'cta', 3, desc, [P('texto', 'Texto', defText)], (v, f) => {
    const st = ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 58, color: fg, uppercase: shape === 'rounded-rect' });
    const w = f.textW(v.texto, st) + 0.12;
    const y = f.portrait ? 0.7 : 0.74;
    return [
      { kind: 'shape', shape, fill: bg, radiusPx: 22 * f.H / 1920, box: { cx: 0.5, cy: y, w, h: fy(58) * 1.95 }, animIn: 'pop', animOut: 'zoom-out', animLoop: 'zoom-in' },
      { kind: 'text', text: v.texto, style: st, x: 0.5, y, t0: 0.1, animation: 'pop', animationOut: 'fade' },
      { kind: 'sticker', emoji, cx: Math.min(0.92, 0.5 + w / 2 + 0.03), cy: y - fy(58) * 0.9, size: 0.11, t0: 0.35, animIn: 'pop', animLoop: loop },
    ];
  });
}

/** card de preço/oferta */
function offer(id: string, name: string, desc: string, params: TemplateDef['params'], build: (v: Record<string, string>, f: Frame) => Piece[]): TemplateDef {
  return T(id, name, 'motion', 'oferta', 4, desc, params, build);
}

/** dica/tutorial: ícone + rótulo em pílula + texto */
function tip(id: string, name: string, desc: string, icon: string, label: string, color: string, defText: string): TemplateDef {
  return T(id, name, 'texto', 'tutorial', 4, desc, [P('rotulo', 'Rótulo', label), P('texto', 'Texto', defText, true)], (v, f) => {
    const lab = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 42, color: WHT, uppercase: true, letterSpacing: 3, background: color, backgroundRadius: 40, backgroundPadding: 14 });
    const body = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 62, color: BLK, background: 'rgba(255,255,255,0.95)', backgroundRadius: 24, backgroundPadding: 22, lineHeight: 1.25, balance: true });
    const y = f.portrait ? 0.3 : 0.32;
    return [
      { kind: 'sticker', emoji: icon, cx: 0.5, cy: y - 0.085, size: 0.12, animIn: 'pop', animLoop: 'swing' },
      { kind: 'text', text: v.rotulo, style: lab, x: 0.5, y: y - 0.01, t0: 0.15, animation: 'pop', animationOut: 'fade' },
      { kind: 'text', text: v.texto, style: body, x: 0.5, y: y + 0.075, t0: 0.3, animation: 'word-slide', animationOut: 'fade' },
    ];
  });
}

/** tela de fim: texto grande + linha + ícone */
function ending(id: string, name: string, desc: string, defTitle: string, defSub: string, style: St, emoji?: string, anim: TextPiece['animation'] = 'blur-in'): TemplateDef {
  return T(id, name, 'texto', 'final', 3.5, desc, [P('titulo', 'Título', defTitle), P('sub', 'Linha de apoio', defSub)], (v) => [
    ...(emoji ? [{ kind: 'sticker', emoji, cx: 0.5, cy: 0.34, size: 0.16, animIn: 'pop', animLoop: 'bounce' } as Piece] : []),
    { kind: 'text', text: v.titulo, style: ts(style), x: 0.5, y: 0.47, t0: 0.15, animation: anim, animationOut: 'fade' },
    { kind: 'text', text: v.sub, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: 46, color: 'rgba(255,255,255,.9)', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 12 }), x: 0.5, y: 0.47 + fy(style.fontSize ?? 120) * 0.8 + 0.02, t0: 0.5, animation: 'fade', animationOut: 'fade' },
  ]);
}

/* ---------- catálogo ---------- */

export const TEMPLATES_MORE: TemplateDef[] = [
  /* ===== abertura / ganchos ===== */
  bigTitle('gancho-voce-sabia', 'Gancho · Você sabia?', 'Pergunta em caixa amarela + fato logo abaixo.', 'VOCÊ SABIA?', 'que 9 em cada 10 erram isso',
    { fontFamily: 'Anton', fontWeight: 400, fontSize: 150, color: BLK, background: YEL, backgroundRadius: 12, backgroundPadding: 20, uppercase: true }, { anim: 'box-reveal' }),
  bigTitle('gancho-pare', 'Gancho · Pare tudo', 'Vermelho, tremendo, para prender nos 2 primeiros segundos.', 'PARE TUDO', 'e assista até o fim',
    { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 160, color: '#FF3B3B', strokeColor: WHT, strokeWidth: 6, strokes: [{ color: BLK, width: 5 }], uppercase: true }, { loop: 'shake' }),
  bigTitle('titulo-3d', 'Título 3D', 'Título enorme com extrusão e sombra.', 'GRANDE IDEIA', 'em menos de 1 minuto',
    { fontFamily: 'Lilita One', fontWeight: 400, fontSize: 170, color: WHT, strokeColor: '#1E2A78', strokeWidth: 3, extrude: { color: '#2F6BFF', depth: 24 }, uppercase: true }, { anim: 'pop', loop: 'bounce' }),
  bigTitle('titulo-neon', 'Título neon', 'Letreiro neon piscando.', 'ABERTO', 'a noite toda',
    { fontFamily: 'Righteous', fontWeight: 400, fontSize: 170, color: '#FFE6F4', glow: { color: '#FF2EC4', blur: 48 }, uppercase: true }, { anim: 'flicker', loop: 'flicker' }),
  bigTitle('titulo-curvo', 'Título em arco', 'Título curvado num arco suave.', 'BEM-VINDOS', 'ao canal',
    { fontFamily: 'Luckiest Guy', fontWeight: 400, fontSize: 130, color: YEL, strokeColor: BLK, strokeWidth: 8, curve: -50, uppercase: true }, { anim: 'pop' }),
  bigTitle('titulo-minimal', 'Título minimal', 'Fino, espaçado e elegante.', 'manifesto', 'capítulo um',
    { fontFamily: 'Outfit', fontWeight: 300, fontSize: 130, color: WHT, letterSpacing: 18, shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 18 }, { anim: 'char-fade', sub: { letterSpacing: 8, fontWeight: 500, uppercase: true, fontSize: 36 } }),
  bigTitle('titulo-marca-texto', 'Título marca-texto', 'Um marca-texto passa por trás do título.', 'O MÉTODO', 'passo a passo',
    { fontFamily: 'League Spartan', fontWeight: 900, fontSize: 150, color: BLK, highlightColor: YEL, uppercase: true }, { anim: 'highlight-sweep' }),
  T('contagem-pronto', 'Contagem · Preparar, já', 'motion', 'abertura', 3, 'Preparar… apontar… JÁ! em três batidas.', [P('a', 'Palavra 1', 'PREPARAR'), P('b', 'Palavra 2', 'APONTAR'), P('c', 'Palavra 3', 'JÁ!')], (v, f) => {
  const st = ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 170, color: WHT, strokeColor: BLK, strokeWidth: 8, uppercase: true });
  const step = f.dur / 3;
  return [v.a, v.b, v.c].map((w, i): Piece => ({ kind: 'text', text: w, style: i === 2 ? { ...st, color: YEL, fontSize: 220, extrude: { color: '#C2410C', depth: 18 } } : st, x: 0.5, y: 0.47, t0: i * step, dur: step, animation: 'stomp', ...(i === 2 ? { animationLoop: 'shake' } : {}) }));
}),

  /* ===== lower thirds ===== */
  lowerThird('lt-pilula', 'Lower third · pílula', 'Nome numa pílula da cor da marca.', 'pill', '#F2681F'),
  lowerThird('lt-etiqueta', 'Lower third · etiqueta', 'Nome em destaque e função numa etiqueta amarela.', 'tag', YEL),
  lowerThird('lt-sublinhado', 'Lower third · sublinhado', 'Nome com sublinhado que se desenha.', 'underline', '#3DE0FF'),
  lowerThird('lt-vidro2', 'Lower third · vidro claro', 'Cartão de vidro com nome e função.', 'glass', WHT),
  lowerThird('lt-bloco', 'Lower third · bloco', 'Bloco sólido escuro estilo telejornal.', 'block', '#0B2E5C'),
  lowerThird('lt-contorno', 'Lower third · contorno', 'Caixa vazada com borda colorida.', 'outline', '#7CFF4F'),
  lowerThird('lt-local', 'Lower third · local', 'Pino de mapa + nome do lugar.', 'pill', '#E62E2E', { nome: 'Praia do Rosa', funcao: 'Santa Catarina', icon: '📍', labels: ['Local', 'Região'] }),
  lowerThird('lt-data', 'Lower third · data', 'Calendário + data e horário.', 'glass', WHT, { nome: '25 de novembro', funcao: 'às 19h', icon: '📅', labels: ['Data', 'Horário'] }),
  lowerThird('lt-entrevistado', 'Lower third · entrevistado', 'Microfone + nome do convidado.', 'underline', '#F2681F', { nome: 'Carlos Lima', funcao: 'Economista', icon: '🎙️' }),

  /* ===== CTA ===== */
  ctaPill('cta-compre', 'CTA · Compre agora', 'Botão verde de compra com carrinho.', 'Compre agora', '🛒', '#16A34A', WHT, 'bounce'),
  ctaPill('cta-arraste', 'CTA · Arraste para cima', 'Seta subindo para arrastar.', 'Arraste para cima', '⬆️', WHT, BLK, 'bounce'),
  ctaPill('cta-saiba-mais', 'CTA · Saiba mais', 'Botão azul de saiba mais.', 'Saiba mais', '👉', '#2F6BFF', WHT, 'shake'),
  ctaPill('cta-baixe', 'CTA · Baixe o app', 'Botão escuro com celular.', 'Baixe o app', '📲', BLK, WHT, 'swing', 'rounded-rect'),
  ctaPill('cta-ative-sino', 'CTA · Ative o sininho', 'Lembrete do sininho de notificação.', 'Ative o sininho', '🔔', YEL, BLK, 'swing'),
  ctaPill('cta-salve', 'CTA · Salve este vídeo', 'Pede para salvar para depois.', 'Salve para depois', '🔖', '#7B5CFF', WHT, 'bounce'),

  /* ===== redes ===== */
  T('rede-usuario', '@ com ícone', 'motion', 'redes', 4, 'Seu @ numa pílula com ícone de perfil.', [P('usuario', '@ usuário', '@seuperfil'), P('icone', 'Ícone (emoji)', '📸')], (v, f) => {
    const st = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 54, color: BLK });
    const txt = `${v.icone} ${v.usuario}`.trim();
    const w = f.textW(txt, st) + 0.1;
    const y = f.portrait ? 0.82 : 0.84;
    return [
      { kind: 'shape', shape: 'line', fill: 'rgba(255,255,255,.95)', box: { cx: 0.5, cy: y, w, h: fy(54) * 1.9 }, animIn: 'slide-up', animOut: 'fade' },
      { kind: 'text', text: txt, style: st, x: 0.5, y, t0: 0.15, animation: 'fade', animationOut: 'fade' },
    ];
  }),
  T('rede-curtir-comentar', 'Curtir · comentar · compartilhar', 'motion', 'redes', 4, 'Três ícones pulando em sequência com legenda.', [P('a', 'Rótulo 1', 'Curta'), P('b', 'Rótulo 2', 'Comente'), P('c', 'Rótulo 3', 'Compartilhe')], (v, f) => {
    const items: [string, string][] = [['❤️', v.a], ['💬', v.b], ['↗️', v.c]];
    const y = f.portrait ? 0.74 : 0.76;
    const gap = f.portrait ? 0.28 : 0.18;
    const lab = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 40, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 });
    return items.flatMap(([e, t], i): Piece[] => [
      { kind: 'sticker', emoji: e, cx: 0.5 + (i - 1) * gap, cy: y, size: 0.13, t0: i * 0.3, animIn: 'pop', animLoop: 'bounce' },
      { kind: 'text', text: t, style: lab, x: 0.5 + (i - 1) * gap, y: y + 0.075, t0: i * 0.3 + 0.1, animation: 'pop', animationOut: 'fade' },
    ]);
  }),
  T('rede-seguidores', 'Marco de seguidores', 'motion', 'redes', 4, 'Comemoração de marco (10 mil!) com confete.', [P('numero', 'Número', '10 MIL'), P('texto', 'Texto', 'seguidores, obrigado!')], (v) => [
    { kind: 'sticker', emoji: '🎉', cx: 0.24, cy: 0.33, size: 0.14, animIn: 'pop', animLoop: 'swing' },
    { kind: 'sticker', emoji: '🎊', cx: 0.76, cy: 0.33, size: 0.14, t0: 0.15, animIn: 'pop', animLoop: 'swing' },
    { kind: 'text', text: v.numero, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 220, color: YEL, strokeColor: BLK, strokeWidth: 8, extrude: { color: '#C2410C', depth: 16 } }), x: 0.5, y: 0.44, t0: 0.2, animation: 'stomp', animationLoop: 'pop' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 58, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 14 }), x: 0.5, y: 0.55, t0: 0.6, animation: 'word-pop', animationOut: 'fade' },
  ]),
  T('rede-comentario', 'Responder comentário', 'motion', 'redes', 5, 'Balão de comentário de seguidor para responder em vídeo.', [P('usuario', 'Quem comentou', '@maria'), P('comentario', 'Comentário', 'Como você faz esse efeito?', true)], (v, f) => {
    const st = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 50, color: BLK, align: 'left', lineHeight: 1.25 });
    const who = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 36, color: '#6B7280', align: 'left' });
    const w = Math.min(0.86, Math.max(f.textW(v.comentario, st), f.textW(v.usuario, who)) + 0.1);
    const left = 0.5 - w / 2;
    const y = f.portrait ? 0.24 : 0.26;
    return [
      { kind: 'shape', shape: 'rounded-rect', fill: WHT, radiusPx: 30 * f.H / 1920, box: { cx: 0.5, cy: y + 0.02, w, h: fy(50 + 36) * 2.1 }, animIn: 'pop', animOut: 'zoom-out' },
      { kind: 'text', text: `Respondendo a ${v.usuario}`, style: who, x: leftX(f, left + 0.05, `Respondendo a ${v.usuario}`, who), y: y - fy(36) * 0.7, t0: 0.15, animation: 'fade', animationOut: 'fade' },
      { kind: 'text', text: v.comentario, style: st, x: leftX(f, left + 0.05, v.comentario, st), y: y + fy(50) * 0.7, t0: 0.25, animation: 'char-typewriter', animationOut: 'fade' },
    ];
  }),

  /* ===== listas e passos ===== */
  T('passos-horizontais', 'Passos 1 → 2 → 3', 'motion', 'lista', 5, 'Três passos lado a lado com setas.', [P('a', 'Passo 1', 'Grave'), P('b', 'Passo 2', 'Edite'), P('c', 'Passo 3', 'Poste')], (v, f) => {
    const steps = [v.a, v.b, v.c];
    const gap = f.portrait ? 0.3 : 0.22;
    const y = 0.5;
    const num = ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 90, color: WHT });
    const lab = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 44, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 });
    const c = sq(f, f.portrait ? 0.18 : 0.13);
    return steps.flatMap((s, i): Piece[] => [
      { kind: 'shape', shape: 'circle', fill: '#F2681F', box: { cx: 0.5 + (i - 1) * gap, cy: y, w: c.w, h: c.h }, t0: i * 0.5, animIn: 'pop', animOut: 'fade' },
      { kind: 'text', text: String(i + 1), style: num, x: 0.5 + (i - 1) * gap, y, t0: i * 0.5 + 0.05, animation: 'pop', animationOut: 'fade' },
      { kind: 'text', text: s, style: lab, x: 0.5 + (i - 1) * gap, y: y + c.h * 0.85, t0: i * 0.5 + 0.1, animation: 'slide-up', animationOut: 'fade' },
      ...(i < 2 ? [{ kind: 'text', text: '→', style: ts({ fontFamily: 'Inter', fontWeight: 800, fontSize: 70, color: WHT }), x: 0.5 + (i - 0.5) * gap, y, t0: i * 0.5 + 0.3, animation: 'slide-right', animationOut: 'fade' } as Piece] : []),
    ]);
  }),
  T('top-5', 'Top 5', 'motion', 'lista', 6, 'Ranking de 5 itens aparecendo do 5 para o 1.', [P('titulo', 'Título', 'TOP 5'), P('i1', '1º', 'Primeiro'), P('i2', '2º', 'Segundo'), P('i3', '3º', 'Terceiro'), P('i4', '4º', 'Quarto'), P('i5', '5º', 'Quinto')], (v, f) => {
    const items = [v.i1, v.i2, v.i3, v.i4, v.i5];
    const st = ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 54, color: WHT, align: 'left', shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 });
    const num = ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 64, color: YEL, align: 'left', strokeColor: BLK, strokeWidth: 4 });
    const gap = f.portrait ? 0.07 : 0.12;
    const y0 = 0.3;
    const left = mx(f) + 0.04;
    const pieces: Piece[] = [{ kind: 'text', text: v.titulo, x: 0.5, y: y0 - gap * 1.2, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 120, color: WHT, strokeColor: BLK, strokeWidth: 6, uppercase: true }), animation: 'stomp', animationOut: 'fade' }];
    items.forEach((it, i) => {
      if (!it?.trim()) return;
      const t0 = 0.4 + (4 - i) * 0.5;
      const y = y0 + i * gap;
      pieces.push({ kind: 'text', text: `${i + 1}.`, style: num, x: leftX(f, left, `${i + 1}.`, num), y, t0, animation: 'pop', animationOut: 'fade' });
      pieces.push({ kind: 'text', text: it, style: st, x: leftX(f, left + 0.1, it, st), y, t0: t0 + 0.05, animation: 'slide-right', animationOut: 'fade' });
    });
    return pieces;
  }),
  T('pros-contras', 'Prós e contras', 'motion', 'lista', 5, 'Duas colunas com ✅ e ❌.', [P('pro1', 'Pró 1', 'Barato'), P('pro2', 'Pró 2', 'Rápido'), P('con1', 'Contra 1', 'Frágil'), P('con2', 'Contra 2', 'Sem garantia')], (v, f) => {
    const st = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 50, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 });
    const col = (x: number, icon: string, a: string, b: string, t: number): Piece[] => [
      { kind: 'sticker', emoji: icon, cx: x, cy: 0.38, size: 0.12, t0: t, animIn: 'pop' },
      { kind: 'text', text: a, style: st, x, y: 0.47, t0: t + 0.2, animation: 'slide-up', animationOut: 'fade' },
      { kind: 'text', text: b, style: st, x, y: 0.53, t0: t + 0.4, animation: 'slide-up', animationOut: 'fade' },
    ];
    return [...col(f.portrait ? 0.27 : 0.3, '✅', v.pro1, v.pro2, 0), ...col(f.portrait ? 0.73 : 0.7, '❌', v.con1, v.con2, 0.6)];
  }),

  /* ===== citações / depoimentos ===== */
  T('depoimento', 'Depoimento com estrelas', 'texto', 'citacao', 5, 'Frase de cliente, estrelas e nome.', [P('frase', 'Depoimento', 'Mudou a forma como eu trabalho!', true), P('autor', 'Nome', 'Júlia, cliente')], (v, f) => [
    { kind: 'shape', shape: 'rounded-rect', fill: 'rgba(255,255,255,.95)', radiusPx: 36 * f.H / 1920, box: { cx: 0.5, cy: 0.47, w: 0.86, h: f.portrait ? 0.2 : 0.36 }, animIn: 'pop', animOut: 'zoom-out' },
    { kind: 'text', text: '★★★★★', style: ts({ fontFamily: 'Inter', fontWeight: 800, fontSize: 60, color: '#FFB800', letterSpacing: 6 }), x: 0.5, y: f.portrait ? 0.4 : 0.36, t0: 0.2, animation: 'char-pop', animationOut: 'fade' },
    { kind: 'text', text: `“${v.frase}”`, style: ts({ fontFamily: 'Lora', fontWeight: 600, fontSize: 56, color: BLK, italic: true, lineHeight: 1.25, balance: true }), x: 0.5, y: 0.47, t0: 0.4, animation: 'word-fade', animationOut: 'fade' },
    { kind: 'text', text: `— ${v.autor}`, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 38, color: '#6B7280' }), x: 0.5, y: f.portrait ? 0.54 : 0.58, t0: 1, animation: 'fade', animationOut: 'fade' },
  ]),
  T('citacao-vidro', 'Citação em vidro', 'texto', 'citacao', 5, 'Frase num cartão de vidro sobre o vídeo.', [P('frase', 'Frase', 'A simplicidade é o último grau de sofisticação.', true), P('autor', 'Autor', 'Autor desconhecido')], (v) => [
    { kind: 'text', text: v.frase, style: ts({ fontFamily: 'Playfair Display', fontWeight: 600, fontSize: 70, color: WHT, italic: true, background: 'rgba(255,255,255,0.14)', backgroundBlur: 28, backgroundRadius: 32, backgroundPadding: 28, lineHeight: 1.25, balance: true }), x: 0.5, y: 0.45, animation: 'blur-in', animationOut: 'fade' },
    { kind: 'text', text: v.autor, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 38, color: WHT, letterSpacing: 4, uppercase: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 10 }), x: 0.5, y: 0.6, t0: 0.9, animation: 'fade', animationOut: 'fade' },
  ]),
  T('citacao-grande', 'Frase de efeito', 'texto', 'citacao', 4, 'Frase curta enorme, palavra a palavra.', [P('frase', 'Frase', 'Comece antes de estar pronto', true)], (v) => [
  { kind: 'text', text: v.frase, style: ts({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 120, color: WHT, uppercase: true, lineHeight: 1.1, balance: true, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 18 }), x: 0.5, y: 0.47, animation: 'word-drop', animationOut: 'fade' },
]),

  /* ===== oferta ===== */
  offer('oferta-de-por', 'De / por', 'Preço antigo pequeno e preço novo grande, lado a lado.', [P('de', 'De', 'R$ 299'), P('por', 'Por', 'R$ 199')], (v, f) => [
    { kind: 'text', text: 'DE', style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 36, color: 'rgba(255,255,255,.8)', letterSpacing: 4 }), x: 0.5, y: 0.37, animation: 'fade', animationOut: 'fade' },
    { kind: 'text', text: v.de, style: ts({ fontFamily: 'Montserrat', fontWeight: 800, fontSize: 80, color: 'rgba(255,255,255,.85)', shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 10 }), x: 0.5, y: 0.42, t0: 0.1, animation: 'fade', animationOut: 'fade' },
    { kind: 'shape', requires: ['de'], shape: 'line', fill: '#E62E2E', box: { cx: 0.5, cy: 0.42, w: f.textW(v.de, { fontFamily: 'Montserrat', fontWeight: 800, fontSize: 80 }) + 0.04, h: fy(9) }, t0: 0.5, rotation: -7, animIn: 'slide-right', animOut: 'fade' },
    { kind: 'text', text: 'POR', style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 40, color: YEL, letterSpacing: 4 }), x: 0.5, y: 0.5, t0: 0.8, animation: 'pop', animationOut: 'fade' },
    { kind: 'text', text: v.por, style: ts({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 190, color: YEL, strokeColor: BLK, strokeWidth: 6, longShadow: { color: 'rgba(0,0,0,.55)', length: 24 } }), x: 0.5, y: 0.59, t0: 0.95, animation: 'stomp', animationOut: 'zoom', animationLoop: 'pop' },
  ]),
  offer('oferta-off', '% OFF', 'Selo explosão com a porcentagem girando.', [P('valor', 'Desconto', '50%'), P('texto', 'Texto', 'OFF em tudo')], (v, f) => {
    const s = sq(f, 0.5);
    return [
      { kind: 'shape', shape: 'star', fill: '#E62E2E', box: { cx: 0.5, cy: 0.45, w: s.w, h: s.h }, animIn: 'spin', animLoop: 'swing', animOut: 'zoom-out' },
      { kind: 'text', text: v.valor, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 190, color: WHT }), x: 0.5, y: 0.44, t0: 0.3, rotation: -8, animation: 'stomp', animationOut: 'fade' },
      { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Montserrat', fontWeight: 900, fontSize: 62, color: BLK, uppercase: true, background: YEL, backgroundRadius: 10, backgroundPadding: 14 }), x: 0.5, y: 0.45 + s.h / 2 + 0.03, t0: 0.6, animation: 'box-reveal', animationOut: 'fade' },
    ];
  }),
  offer('frete-gratis', 'Frete grátis', 'Caminhão e faixa verde de frete grátis.', [P('texto', 'Texto', 'FRETE GRÁTIS'), P('sub', 'Condição', 'acima de R$ 99')], (v) => [
    { kind: 'sticker', emoji: '🚚', cx: 0.5, cy: 0.38, size: 0.2, animIn: 'slide-right', animLoop: 'shake' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 96, color: WHT, background: '#16A34A', backgroundRadius: 14, backgroundPadding: 18, uppercase: true }), x: 0.5, y: 0.5, t0: 0.3, animation: 'box-reveal', animationOut: 'fade' },
    { kind: 'text', text: v.sub, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 44, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 }), x: 0.5, y: 0.58, t0: 0.7, animation: 'fade', animationOut: 'fade' },
  ]),
  offer('cupom', 'Cupom de desconto', 'Código de cupom em caixa tracejada.', [P('codigo', 'Código', 'EDITOR10'), P('texto', 'Texto', 'use o cupom e ganhe 10%')], (v, f) => [
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 52, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 }), x: 0.5, y: 0.4, animation: 'fade', animationOut: 'fade' },
    { kind: 'shape', shape: 'rounded-rect', fill: 'rgba(255,255,255,.95)', stroke: '#F2681F', strokeWidth: 8, radiusPx: 20 * f.H / 1920, box: { cx: 0.5, cy: 0.49, w: f.textW(v.codigo, { fontFamily: 'JetBrains Mono', fontWeight: 800, fontSize: 90 }) + 0.12, h: fy(90) * 1.8 }, t0: 0.3, animIn: 'pop', animOut: 'zoom-out' },
    { kind: 'text', text: v.codigo, style: ts({ fontFamily: 'JetBrains Mono', fontWeight: 800, fontSize: 90, color: BLK, letterSpacing: 6 }), x: 0.5, y: 0.49, t0: 0.45, animation: 'char-typewriter', animationOut: 'fade' },
    { kind: 'sticker', emoji: '✂️', cx: 0.5 - (f.textW(v.codigo, { fontFamily: 'JetBrains Mono', fontWeight: 800, fontSize: 90 }) + 0.12) / 2, cy: 0.49 - fy(90) * 0.9, size: 0.08, t0: 0.6, animIn: 'pop', animLoop: 'swing' },
  ]),
  offer('so-hoje', 'Só hoje', 'Urgência com relógio e faixa vermelha.', [P('texto', 'Texto', 'SÓ HOJE'), P('sub', 'Detalhe', 'termina à meia-noite')], (v) => [
    { kind: 'sticker', emoji: '⏰', cx: 0.5, cy: 0.36, size: 0.16, animIn: 'pop', animLoop: 'shake' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 170, color: WHT, strokeColor: '#E62E2E', strokeWidth: 8, uppercase: true }), x: 0.5, y: 0.48, t0: 0.2, animation: 'stomp', animationLoop: 'pop' },
    { kind: 'text', text: v.sub, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 46, color: WHT, background: '#E62E2E', backgroundRadius: 40, backgroundPadding: 14 }), x: 0.5, y: 0.58, t0: 0.6, animation: 'pop', animationOut: 'fade' },
  ]),
  offer('mega-promocao', 'Mega promoção', 'Título 3D dourado de promoção.', [P('titulo', 'Título', 'MEGA PROMOÇÃO'), P('sub', 'Período', 'de 20 a 30/11')], (v) => [
    { kind: 'text', text: v.titulo, style: ts({ fontFamily: 'Luckiest Guy', fontWeight: 400, fontSize: 130, color: '#FFD84D', strokeColor: '#5A3A00', strokeWidth: 4, extrude: { color: '#B7791F', depth: 18 }, uppercase: true, balance: true }), x: 0.5, y: 0.45, animation: 'pop', animationLoop: 'bounce' },
    { kind: 'text', text: v.sub, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 48, color: WHT, background: BLK, backgroundRadius: 40, backgroundPadding: 14 }), x: 0.5, y: 0.6, t0: 0.5, animation: 'slide-up', animationOut: 'fade' },
  ]),

  /* ===== destaque ===== */
  T('palavra-gigante-3d', 'Palavra gigante 3D', 'texto', 'destaque', 2, 'Uma palavra enorme com extrusão, batendo na tela.', [P('palavra', 'Palavra', 'BOOM')], (v) => [
    { kind: 'text', text: v.palavra, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 300, color: YEL, strokeColor: BLK, strokeWidth: 8, extrude: { color: '#C2410C', depth: 26 }, uppercase: true }), x: 0.5, y: 0.47, animation: 'stomp', animationOut: 'zoom', animationLoop: 'shake' },
  ]),
  T('emoji-texto', 'Emoji + texto', 'texto', 'destaque', 3, 'Emoji grande pulando sobre uma frase curta.', [P('emoji', 'Emoji', '🔥'), P('texto', 'Texto', 'Isso é demais')], (v) => [
    { kind: 'sticker', emoji: v.emoji || '🔥', cx: 0.5, cy: 0.38, size: 0.2, animIn: 'pop', animLoop: 'bounce' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Poppins', fontWeight: 900, fontSize: 96, color: WHT, strokeColor: BLK, strokeWidth: 8, uppercase: true, balance: true }), x: 0.5, y: 0.5, t0: 0.2, animation: 'word-pop', animationOut: 'fade' },
  ]),
  T('palavra-contorno', 'Palavra vazada', 'texto', 'destaque', 3, 'Palavra só com contorno e brilho.', [P('palavra', 'Palavra', 'FOCO')], (v) => [
    { kind: 'text', text: v.palavra, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 260, color: 'rgba(255,255,255,0)', strokeColor: WHT, strokeWidth: 4, glow: { color: 'rgba(255,255,255,.8)', blur: 24 }, uppercase: true }), x: 0.5, y: 0.47, animation: 'scale-in', animationOut: 'fade', animationLoop: 'flicker' },
  ]),
  T('destaque-numero', 'Número de impacto', 'texto', 'destaque', 3.5, 'Número gigante com legenda (ex.: 97%).', [P('numero', 'Número', '97%'), P('texto', 'Texto', 'dos clientes recomendam')], (v) => [
    { kind: 'text', text: v.numero, style: ts({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 280, color: '#3DE0FF', strokeColor: BLK, strokeWidth: 6, longShadow: { color: 'rgba(0,0,0,.5)', length: 30 } }), x: 0.5, y: 0.44, animation: 'stomp', animationOut: 'fade' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 56, color: WHT, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12, balance: true }), x: 0.5, y: 0.57, t0: 0.5, animation: 'word-slide', animationOut: 'fade' },
  ]),
  T('destaque-curvo', 'Selo curvo', 'texto', 'destaque', 3, 'Frase curva sobre um círculo, estilo selo.', [P('texto', 'Texto', 'QUALIDADE GARANTIDA')], (v, f) => {
    const s = sq(f, 0.42);
    return [
      { kind: 'shape', shape: 'circle', fill: '#F2681F', stroke: WHT, strokeWidth: 6, box: { cx: 0.5, cy: 0.47, w: s.w, h: s.h }, animIn: 'spin', animOut: 'zoom-out', animLoop: 'swing' },
      { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Montserrat', fontWeight: 900, fontSize: 52, color: WHT, curve: -150, uppercase: true, letterSpacing: 4 }), x: 0.5, y: 0.47 - s.h * 0.24, t0: 0.3, animation: 'fade', animationOut: 'fade' },
      { kind: 'sticker', emoji: '⭐', cx: 0.5, cy: 0.49, size: 0.12, t0: 0.5, animIn: 'pop' },
    ];
  }),

  /* ===== tutorial ===== */
  tip('tutorial-dica', 'Dica', 'Lâmpada, rótulo DICA e texto em caixa branca.', '💡', 'Dica', '#F2681F', 'Use luz natural de frente'),
  tip('tutorial-atencao', 'Atenção', 'Alerta amarelo para cuidados.', '⚠️', 'Atenção', '#D97706', 'Não pule esta etapa'),
  tip('tutorial-erro', 'Erro comum', 'Aviso vermelho de erro comum.', '❌', 'Erro comum', '#E62E2E', 'Gravar contra a janela'),
  tip('tutorial-certo', 'Jeito certo', 'Confirmação verde do jeito certo.', '✅', 'Jeito certo', '#16A34A', 'Câmera na altura dos olhos'),
  T('tutorial-passo', 'Passo X', 'texto', 'tutorial', 3, 'Número do passo em círculo e título do passo.', [N('numero', 'Passo nº', 1), P('titulo', 'Título', 'Abra o aplicativo')], (v, f) => {
    const c = sq(f, 0.16);
    const y = f.portrait ? 0.2 : 0.22;
    return [
      { kind: 'shape', shape: 'circle', fill: '#F2681F', box: { cx: 0.5, cy: y, w: c.w, h: c.h }, animIn: 'pop', animOut: 'fade' },
      { kind: 'text', text: String(v.numero), style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 120, color: WHT }), x: 0.5, y, t0: 0.1, animation: 'pop', animationOut: 'fade' },
      { kind: 'text', text: v.titulo, style: ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 68, color: WHT, strokeColor: BLK, strokeWidth: 5, balance: true }), x: 0.5, y: y + c.h * 0.8, t0: 0.3, animation: 'slide-up', animationOut: 'fade' },
    ];
  }),

  /* ===== eventos ===== */
  T('evento-convite', 'Convite', 'texto', 'evento', 5, 'Convite elegante: título cursivo, data e local.', [P('titulo', 'Título', 'Você é nosso convidado'), P('data', 'Data', 'Sábado, 12 de dezembro'), P('local', 'Local', 'Espaço Jardim · 20h')], (v) => [
    { kind: 'text', text: v.titulo, style: ts({ fontFamily: 'Dancing Script', fontWeight: 700, fontSize: 120, color: '#FFF4E0', shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 16, balance: true }), x: 0.5, y: 0.4, animation: 'char-fade', animationOut: 'fade' },
    { kind: 'text', text: v.data, style: ts({ fontFamily: 'Cormorant Garamond', fontWeight: 700, fontSize: 60, color: '#F5D58A', uppercase: true, letterSpacing: 4 }), x: 0.5, y: 0.52, t0: 1, animation: 'fade', animationOut: 'fade' },
    { kind: 'text', text: v.local, style: ts({ fontFamily: 'Cormorant Garamond', fontWeight: 600, fontSize: 48, color: WHT, italic: true }), x: 0.5, y: 0.57, t0: 1.4, animation: 'fade', animationOut: 'fade' },
  ]),
  T('save-the-date', 'Save the date', 'texto', 'evento', 5, 'Data em destaque com linhas finas e nomes.', [P('nomes', 'Nomes', 'Ana & Pedro'), P('data', 'Data', '12 · 12 · 2026')], (v) => [
    { kind: 'text', text: 'SAVE THE DATE', style: ts({ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 40, color: WHT, letterSpacing: 14 }), x: 0.5, y: 0.36, animation: 'char-fade', animationOut: 'fade' },
    { kind: 'shape', shape: 'line', fill: 'rgba(255,255,255,.85)', box: { cx: 0.5, cy: 0.4, w: 0.3, h: 0.003 }, t0: 0.5, animIn: 'zoom-in', animOut: 'fade' },
    { kind: 'text', text: v.nomes, style: ts({ fontFamily: 'Pacifico', fontWeight: 400, fontSize: 110, color: WHT, shadowColor: 'rgba(0,0,0,.4)', shadowBlur: 14 }), x: 0.5, y: 0.47, t0: 0.7, animation: 'blur-in', animationOut: 'fade' },
    { kind: 'text', text: v.data, style: ts({ fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 70, color: '#F5D58A', letterSpacing: 6 }), x: 0.5, y: 0.56, t0: 1.2, animation: 'fade', animationOut: 'fade' },
  ]),
  T('ao-vivo', 'Ao vivo', 'motion', 'evento', 4, 'Selo vermelho AO VIVO piscando no canto.', [P('texto', 'Texto', 'AO VIVO')], (v, f) => {
    const st = ts({ fontFamily: 'Inter', fontWeight: 900, fontSize: 44, color: WHT, letterSpacing: 3 });
    const w = f.textW(`● ${v.texto}`, st) + 0.06;
    const x = mx(f) + w / 2;
    const y = f.portrait ? 0.07 : 0.09;
    return [
      { kind: 'shape', shape: 'rounded-rect', fill: '#E62E2E', radiusPx: 12 * f.H / 1920, box: { cx: x, cy: y, w, h: fy(44) * 1.8 }, animIn: 'pop', animOut: 'fade' },
      { kind: 'text', text: `● ${v.texto}`, style: st, x, y, t0: 0.1, animation: 'fade', animationLoop: 'flicker' },
    ];
  }),
  T('evento-ingresso', 'Garanta seu ingresso', 'motion', 'evento', 4, 'Ingresso inclinado com nome do evento e CTA.', [P('evento', 'Evento', 'Festival de Verão'), P('cta', 'Chamada', 'Ingressos no link')], (v, f) => [
    { kind: 'sticker', emoji: '🎟️', cx: 0.5, cy: 0.36, size: 0.22, rotation: -10, animIn: 'pop', animLoop: 'swing' },
    { kind: 'text', text: v.evento, style: ts({ fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 140, color: WHT, letterSpacing: 6, strokes: [{ color: '#F2681F', width: 6 }], strokeColor: BLK, strokeWidth: 3 }), x: 0.5, y: 0.5, t0: 0.3, animation: 'slide-up', animationOut: 'fade' },
    { kind: 'text', text: v.cta, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 50, color: BLK, background: YEL, backgroundRadius: 40, backgroundPadding: 14 }), x: 0.5, y: 0.6, t0: 0.6, animation: 'pop', animationOut: 'fade' },
  ]),

  /* ===== notícias ===== */
  T('noticia-manchete', 'Manchete', 'motion', 'noticia', 5, 'Faixa vermelha "URGENTE" + manchete em faixa branca.', [P('rotulo', 'Rótulo', 'URGENTE'), P('manchete', 'Manchete', 'Nova lei muda tudo a partir de hoje', true)], (v, f) => {
    const y = f.portrait ? 0.76 : 0.8;
    const lab = ts({ fontFamily: 'Oswald', fontWeight: 700, fontSize: 46, color: WHT, uppercase: true, background: '#C8102E', backgroundRadius: 0, backgroundPadding: 12, align: 'left' });
    const hd = ts({ fontFamily: 'Oswald', fontWeight: 600, fontSize: 56, color: BLK, background: 'rgba(255,255,255,0.97)', backgroundRadius: 0, backgroundPadding: 14, align: 'left', balance: true });
    return [
      { kind: 'text', text: v.rotulo, style: lab, x: leftX(f, mx(f), v.rotulo, lab) + 0.02, y: y - fy(56) * 1.25, animation: 'box-reveal', animationOut: 'fade' },
      { kind: 'text', text: v.manchete, style: hd, x: 0.5, y, t0: 0.3, animation: 'box-reveal', animationOut: 'fade' },
    ];
  }),
  T('noticia-plantao', 'Plantão', 'motion', 'noticia', 4, 'Vinheta de plantão em tela cheia.', [P('texto', 'Texto', 'PLANTÃO')], (v, f) => [
    { kind: 'shape', shape: 'rect', fill: '#0B2E5C', box: { cx: 0.5, cy: 0.5, w: 1.02, h: f.portrait ? 0.22 : 0.34 }, animIn: 'slide-right', animInDur: 0.3, animOut: 'slide-left' },
    { kind: 'shape', shape: 'line', fill: '#C8102E', box: { cx: 0.5, cy: 0.5 + (f.portrait ? 0.11 : 0.17), w: 1.3, h: 0.012 }, t0: 0.2, animIn: 'slide-left', animOut: 'fade' },
    { kind: 'text', text: v.texto, style: ts({ fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 170, color: WHT, letterSpacing: 10, uppercase: true }), x: 0.5, y: 0.5, t0: 0.3, animation: 'scale-in', animationOut: 'fade', animationLoop: 'flicker' },
  ]),
  T('noticia-ticker', 'Ticker (letreiro)', 'motion', 'noticia', 8, 'Faixa com texto correndo da direita para a esquerda.', [P('texto', 'Texto', 'Últimas notícias • Mercado em alta • Previsão: sol o dia todo •')], (v, f) => {
    const y = f.portrait ? 0.9 : 0.93;
    const st = ts({ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 52, color: WHT, uppercase: true });
    const w = f.textW(v.texto, st);
    return [
      { kind: 'shape', shape: 'rect', fill: 'rgba(11,46,92,.95)', box: { cx: 0.5, cy: y, w: 1.02, h: fy(52) * 1.9 }, animIn: 'slide-up', animOut: 'fade' },
      { kind: 'text', text: v.texto, style: st, x: 0.5, y, t0: 0.2, animation: 'none',
        keyframes: [{ t: 0, transform: { x: 0.5 + w / 2 } }, { t: f.dur - 0.2, transform: { x: -0.5 - w / 2 } }] },
    ];
  }),
  T('noticia-fonte', 'Fonte / crédito de imagem', 'motion', 'noticia', 4, 'Crédito pequeno no canto superior.', [P('texto', 'Texto', 'Imagem: arquivo pessoal')], (v, f) => {
    const st = ts({ fontFamily: 'Inter', fontWeight: 600, fontSize: 30, color: WHT, background: 'rgba(0,0,0,.55)', backgroundRadius: 6, backgroundPadding: 8, align: 'right' });
    return [{ kind: 'text', text: v.texto, style: st, x: 1 - mx(f) - f.textW(v.texto, st) / 2, y: f.portrait ? 0.06 : 0.08, animation: 'fade', animationOut: 'fade' }];
  }),

  /* ===== finais ===== */
  ending('final-obrigado', 'Obrigado', 'Agradecimento com coração pulando.', 'Obrigado!', 'por assistir até aqui', { fontFamily: 'Pacifico', fontWeight: 400, fontSize: 150, color: WHT, shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 18 }, '💛'),
  ending('final-ate-proxima', 'Até a próxima', 'Despedida com aceno.', 'ATÉ A PRÓXIMA', 'novo vídeo toda semana', { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 160, color: WHT, letterSpacing: 8, strokeColor: BLK, strokeWidth: 3 }, '👋', 'slide-up'),
  ending('final-inscreva', 'Final · inscreva-se', 'Chamada final com sino.', 'Inscreva-se', 'e ative o sininho', { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 130, color: WHT, background: '#E62E2E', backgroundRadius: 20, backgroundPadding: 22 }, '🔔', 'pop'),
  T('final-creditos', 'Créditos rolando', 'texto', 'final', 8, 'Créditos subindo pela tela, estilo cinema.', [P('creditos', 'Créditos (uma linha por item)', 'Direção\nAna Souza\n\nEdição\nEditorPro\n\nMúsica\nTrilha original', true)], (v, f) => [
    { kind: 'text', text: v.creditos, style: ts({ fontFamily: 'Cormorant Garamond', fontWeight: 600, fontSize: 56, color: WHT, lineHeight: 1.45 }), x: 0.5, y: 0.5, animation: 'none',
      keyframes: [{ t: 0, transform: { y: 0.75 } }, { t: f.dur, transform: { y: -0.75 } }] },
  ]),
  ending('final-fim', 'Fim', 'FIM elegante com filete.', 'Fim', 'obrigado pela companhia', { fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 170, color: WHT, italic: true, shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 18 }),
];
