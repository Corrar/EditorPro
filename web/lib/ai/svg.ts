/* =====================================================================
   Gráficos por código (add_graphic / update_graphic): a IA escreve SVG e o
   navegador sanitiza, rasteriza em PNG nítido e vira um MediaAsset image
   (role 'graphic', com `svg` guardado p/ re-rasterizar e persistir).
   Segurança em camadas:
     1) sanitizeSvgString (puro, roda em qualquer lugar): tira script,
        foreignObject, iframe/object/embed, on*, javascript:, href externo,
        <image>/<use> externos, @import/url() externos em CSS
     2) no navegador, DOMParser + a mesma limpeza nó a nó
     3) o SVG é carregado em <img> (sem scripts nem rede, por especificação)
   ===================================================================== */
import type { Id, MediaAsset, Project } from '../types';

export const MAX_SVG_BYTES = 200_000;

const BAD_TAGS = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base', 'handler', 'listener'];
const SAFE_DATA_IMG = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function safeRef(v: string, tag: string): boolean {
  const s = v.trim();
  if (s.startsWith('#')) return true;
  return tag === 'image' && SAFE_DATA_IMG.test(s);
}

function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript:/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
}

/** limpeza por texto (sem DOM) — também usada como 2ª passada no navegador */
export function sanitizeSvgString(svg: string): string {
  let s = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const t of BAD_TAGS) {
    s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<${t}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // eventos on*
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // href/xlink:href externos (mantém #id e data:image em <image>)
  s = s.replace(/<([a-z:]+)\b([^>]*)>/gi, (whole, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    const cleaned = attrs.replace(/\s+((?:xlink:)?href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, _name: string, _q, a?: string, b?: string, c?: string) => (safeRef(a ?? b ?? c ?? '', t) ? m : ''))
      .replace(/\s+style\s*=\s*("([^"]*)"|'([^']*)')/gi, (_m, _q, a?: string, b?: string) => ` style="${cleanCss(a ?? b ?? '').replace(/"/g, "'")}"`);
    return `<${tag}${cleaned}>`;
  });
  // animações que trocam href (<set attributeName="href" to="javascript:…">)
  s = s.replace(/<(set|animate)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href["']?[^>]*\/?>/gi, '');
  s = s.replace(/javascript:/gi, '');
  // <style> interno: sem @import / url() externo
  s = s.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, a: string, css: string) => `<style${a}>${cleanCss(css)}</style>`);
  return s.trim();
}

/** limpeza nó a nó no navegador (DOMParser); cai na versão texto se não houver DOM */
export function sanitizeSvg(svg: string): { ok: true; svg: string; width: number; height: number } | { ok: false; error: string } {
  if (typeof svg !== 'string' || !svg.trim()) return { ok: false, error: 'SVG vazio' };
  if (svg.length > MAX_SVG_BYTES) return { ok: false, error: 'SVG grande demais (máx. 200 KB)' };
  let out = sanitizeSvgString(svg);
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) return { ok: false, error: `SVG inválido: ${(err.textContent ?? '').trim().slice(0, 200)}` };
    const root = doc.documentElement;
    if (root.nodeName.toLowerCase() !== 'svg') return { ok: false, error: 'a raiz precisa ser <svg>' };
    const walk = (el: Element) => {
      for (const child of Array.from(el.children)) {
        const tag = child.nodeName.toLowerCase();
        if (BAD_TAGS.includes(tag)) { child.remove(); continue; }
        for (const at of Array.from(child.attributes)) {
          const n = at.name.toLowerCase();
          if (n.startsWith('on')) child.removeAttribute(at.name);
          else if ((n === 'href' || n === 'xlink:href' || n === 'src') && !safeRef(at.value, tag)) child.removeAttribute(at.name);
          else if (n === 'style') child.setAttribute(at.name, cleanCss(at.value));
          else if (/javascript:/i.test(at.value)) child.removeAttribute(at.name);
        }
        if ((tag === 'set' || tag === 'animate') && /href/i.test(child.getAttribute('attributeName') ?? '')) { child.remove(); continue; }
        if (tag === 'style') child.textContent = cleanCss(child.textContent ?? '');
        walk(child);
      }
    };
    for (const at of Array.from(root.attributes)) if (at.name.toLowerCase().startsWith('on')) root.removeAttribute(at.name);
    walk(root);
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    out = sanitizeSvgString(new XMLSerializer().serializeToString(root));
  } else if (!/^\s*<svg[\s>]/i.test(out)) {
    return { ok: false, error: 'a raiz precisa ser <svg>' };
  }
  if (!/xmlns\s*=/.test(out)) out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const { width, height } = svgSize(out);
  return { ok: true, svg: out, width, height };
}

/** tamanho intrínseco: width/height ou viewBox (padrão 1000×1000) */
export function svgSize(svg: string): { width: number; height: number } {
  const head = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const num = (name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*["']?([0-9.]+)(px)?["']?`, 'i').exec(head); return m ? parseFloat(m[1]) : NaN; };
  const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(head);
  let w = num('width'), h = num('height');
  if ((!w || !h) && vb) { const vw = parseFloat(vb[1]), vh = parseFloat(vb[2]); if (!w && !h) { w = vw; h = vh; } else if (!w) w = (h * vw) / vh; else h = (w * vh) / vw; }
  return { width: w > 0 ? w : 1000, height: h > 0 ? h : 1000 };
}

/** tamanho do PNG: altura ≥ altura do quadro do projeto, proporção do SVG, lado máx. 4096 */
export function rasterSize(svgW: number, svgH: number, p: Pick<Project, 'width' | 'height'>): { width: number; height: number } {
  const ratio = svgW / svgH;
  let h = Math.max(p.height, 512);
  let w = h * ratio;
  const max = 4096;
  if (w > max) { w = max; h = w / ratio; }
  if (h > max) { h = max; w = h * ratio; }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** navegador: SVG (já saneado) -> PNG Blob nítido */
export async function rasterizeSvg(svg: string, size: { width: number; height: number }): Promise<Blob> {
  // força o tamanho de saída no próprio SVG (nitidez real, não ampliação)
  const sized = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const a = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const vb = /viewBox=/i.test(a) ? '' : ` viewBox="0 0 ${svgSize(svg).width} ${svgSize(svg).height}"`;
    return `<svg${a}${vb} width="${size.width}" height="${size.height}">`;
  });
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('o navegador não conseguiu desenhar esse SVG')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas indisponível');
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('falha ao gerar o PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const fileName = (name: string) => `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'Gráfico'}.png`;

/** navegador: cria o asset do gráfico (ingere o PNG como imagem, role 'graphic', guarda o svg) */
export async function createGraphicAsset(svgRaw: string, name: string, p: Project): Promise<MediaAsset> {
  const s = sanitizeSvg(svgRaw);
  if (!s.ok) throw new Error(s.error);
  const blob = await rasterizeSvg(s.svg, rasterSize(s.width, s.height, p));
  const [{ ingestFile }, { useEditor }] = await Promise.all([import('../media/ingest'), import('../store')]);
  const asset = await ingestFile(new File([blob], fileName(name), { type: 'image/png' }), 'graphic');
  useEditor.getState().updateAsset(asset.id, { svg: s.svg, role: 'graphic' });
  return { ...asset, svg: s.svg, role: 'graphic' };
}

/** navegador: re-rasteriza um gráfico existente com SVG novo (mesmo asset: os clipes atualizam sozinhos) */
export async function updateGraphicAsset(assetId: Id, svgRaw: string, p: Project): Promise<MediaAsset> {
  const s = sanitizeSvg(svgRaw);
  if (!s.ok) throw new Error(s.error);
  const blob = await rasterizeSvg(s.svg, rasterSize(s.width, s.height, p));
  const [{ useEditor }, { putBlob }] = await Promise.all([import('../store'), import('../persist/db')]);
  const st = useEditor.getState();
  const old = st.assets[assetId];
  if (!old) throw new Error('gráfico não encontrado');
  await putBlob(assetId, blob).catch(() => {});
  const url = URL.createObjectURL(blob);
  const size = rasterSize(s.width, s.height, p);
  st.updateAsset(assetId, { url, svg: s.svg, size: blob.size, width: size.width, height: size.height, thumbnails: undefined });
  if (old.url?.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old.url!), 4000);
  return { ...old, url, svg: s.svg };
}
