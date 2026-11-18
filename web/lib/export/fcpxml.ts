/* =====================================================================
   FCPXML 1.9 — abre no DaVinci Resolve, Final Cut Pro e (via conversor) Premiere.
   Estrutura: 1ª trilha de vídeo = storyline principal (spine) com <gap> nos
   buracos; demais trilhas de vídeo, áudio, textos e legendas = clipes
   conectados (lanes), presos ao item da spine que cobre seu início.
   Tempos racionais alinhados a quadro ("n/fps s").
   ===================================================================== */
import type { Clip, MediaAsset, Project, Seconds, TextClip } from '../types';
import { projectDuration } from '../ops';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** base de tempo racional para o fps (29.97 -> 1001/30000) */
export function timebase(fps: number): { num: number; den: number } {
  const ntsc: Record<string, number> = { '23.98': 24, '23.976': 24, '29.97': 30, '59.94': 60 };
  const key = String(Math.round(fps * 1000) / 1000);
  if (ntsc[key] || Math.abs(fps - Math.round(fps)) > 0.001) {
    const base = ntsc[key] ?? Math.round(fps);
    return { num: 1001, den: base * 1000 };
  }
  return { num: 1, den: Math.round(fps) };
}

/** segundos -> "n/d s" alinhado a quadro (simplificado) */
export function rational(sec: Seconds, fps: number): string {
  const { num, den } = timebase(fps);
  const frames = Math.round((Math.max(0, sec) * den) / num);
  if (frames === 0) return '0s';
  let n = frames * num;
  let d = den;
  const g = gcd(n, d);
  n /= g; d /= g;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

const hex2 = (h: string) => parseInt(h, 16) / 255;
/** cor CSS (#rgb/#rrggbb/rgba) -> "r g b a" do FCPXML */
export function fcpColor(css: string | undefined, fallback = '1 1 1 1'): string {
  if (!css) return fallback;
  const c = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((x) => hex2(x + x).toFixed(3)).join(' ') + ' 1';
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) {
    const rgb = [0, 2, 4].map((i) => hex2(m![1].slice(i, i + 2)).toFixed(3)).join(' ');
    return `${rgb} ${m[2] ? hex2(m[2]).toFixed(3) : '1'}`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return `${(p[0] / 255).toFixed(3)} ${(p[1] / 255).toFixed(3)} ${(p[2] / 255).toFixed(3)} ${p[3] ?? 1}`;
  }
  return fallback;
}

interface SpineItem { start: Seconds; end: Seconds; xmlOpen: string; children: string[]; local: (t: Seconds) => Seconds; close: string }

export function toFCPXML(p: Project, assets: Record<string, MediaAsset>): string {
  const fps = p.fps || 30;
  const R = (s: Seconds) => rational(s, fps);
  const { num, den } = timebase(fps);
  const total = Math.max(projectDuration(p), 1 / fps);

  /* ---------- resources ---------- */
  const res: string[] = [];
  let nextId = 1;
  const fmtId = `r${nextId++}`;
  res.push(`<format id="${fmtId}" name="FFVideoFormat${p.width}x${p.height}p${Math.round(fps)}" frameDuration="${num === 1 ? `1/${den}s` : `${num}/${den}s`}" width="${p.width}" height="${p.height}" colorSpace="1-1-1 (Rec. 709)"/>`);

  const used = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if ('assetId' in c && c.assetId) used.add(c.assetId);
  const assetRef = new Map<string, string>();
  const formatsBySize = new Map<string, string>();
  for (const id of used) {
    const a = assets[id];
    if (!a) continue;
    const ref = `r${nextId++}`;
    assetRef.set(id, ref);
    const hasVideo = a.kind !== 'audio';
    const hasAudio = a.kind !== 'image';
    let fmtAttr = '';
    if (hasVideo) {
      const w = a.width || p.width, h = a.height || p.height;
      const key = `${w}x${h}`;
      let f = formatsBySize.get(key);
      if (!f) {
        if (w === p.width && h === p.height) f = fmtId;
        else {
          f = `r${nextId++}`;
          res.push(`<format id="${f}" name="FFVideoFormat${w}x${h}" ${a.kind === 'image' ? '' : `frameDuration="${num === 1 ? `1/${den}s` : `${num}/${den}s`}" `}width="${w}" height="${h}"/>`);
        }
        formatsBySize.set(key, f);
      }
      fmtAttr = ` format="${f}"`;
    }
    const dur = a.kind === 'image' ? '0s' : R(a.duration);
    res.push(
      `<asset id="${ref}" name="${esc(a.name)}" start="0s" duration="${dur}" hasVideo="${hasVideo ? 1 : 0}" hasAudio="${hasAudio ? 1 : 0}"${fmtAttr}` +
        `${hasAudio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ''}>` +
        `<media-rep kind="original-media" src="file:///${esc(encodeURI(a.name))}"/></asset>`,
    );
  }
  const titleRef = `r${nextId++}`;
  res.push(`<effect id="${titleRef}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`);

  /* ---------- spine (1ª trilha de vídeo) ---------- */
  const videoTracks = p.tracks.filter((t) => t.kind === 'video');
  const main = videoTracks[0];
  const spine: SpineItem[] = [];
  let cursor = 0;
  const pushGap = (from: Seconds, to: Seconds) => {
    if (to - from < 0.5 / fps) return;
    spine.push({
      start: from, end: to,
      xmlOpen: `<gap name="Vão" offset="${R(from)}" start="${R(from)}" duration="${R(to - from)}">`,
      children: [], close: '</gap>', local: (t) => t,
    });
  };
  const clipAttrs = (c: Clip, offsetAttr: string, lane?: number) => {
    const aid = 'assetId' in c ? c.assetId : undefined;
    const a = aid ? assets[aid] : undefined;
    const ref = aid ? assetRef.get(aid) : undefined;
    const name = esc(c.label || a?.name || c.type);
    const srcIn = c.type === 'video' || c.type === 'audio' ? c.in : 0;
    const laneAttr = lane !== undefined ? ` lane="${lane}"` : '';
    return { ref, open: `<asset-clip ref="${ref}"${laneAttr} name="${name}" ${offsetAttr} start="${R(srcIn)}" duration="${R(c.duration)}"${a && a.kind !== 'image' ? ' audioRole="dialogue"' : ''}>`, srcIn };
  };
  const clipInner = (c: Clip): string[] => {
    const inner: string[] = [];
    if ((c.type === 'video' || c.type === 'audio') && c.speed && Math.abs(c.speed - 1) > 1e-3) {
      inner.push(`<timeMap><timept time="0s" value="${R(c.in)}" interp="linear"/><timept time="${R(c.duration)}" value="${R(c.in + c.duration * c.speed)}" interp="linear"/></timeMap>`);
    }
    if (c.type === 'video' || c.type === 'image') {
      const tf = c.transform;
      if (tf && (tf.scale !== 1 || tf.rotation || tf.x || tf.y)) {
        // posição no FCP: % da altura do quadro (100 = altura inteira)
        const px = ((tf.x * p.width) / p.height) * 100;
        const py = -tf.y * 100;
        inner.push(`<adjust-transform position="${px.toFixed(2)} ${py.toFixed(2)}" scale="${tf.scale.toFixed(3)} ${tf.scale.toFixed(3)}" rotation="${(-tf.rotation).toFixed(2)}"/>`);
      }
    }
    if ((c.type === 'video' || c.type === 'audio') && c.volume !== undefined && Math.abs(c.volume - 1) > 1e-3) {
      const db = c.volume <= 0 ? -96 : 20 * Math.log10(c.volume);
      inner.push(`<adjust-volume amount="${db.toFixed(1)}dB"/>`);
    }
    return inner;
  };

  if (main) {
    for (const c of main.clips) {
      if (c.type !== 'video' && c.type !== 'image') continue;
      if (!assetRef.has(c.assetId)) continue;
      if (c.start + c.duration <= cursor + 1e-6) continue;
      const start = Math.max(c.start, cursor);
      pushGap(cursor, start);
      const { open, srcIn } = clipAttrs({ ...c, start, duration: c.start + c.duration - start } as Clip, `offset="${R(start)}"`);
      const speed = c.type === 'video' ? c.speed || 1 : 1;
      const clipStart = start;
      spine.push({
        start, end: c.start + c.duration, xmlOpen: open, children: clipInner(c), close: '</asset-clip>',
        local: (t) => srcIn + (t - clipStart) * speed,
      });
      cursor = c.start + c.duration;
    }
  }
  pushGap(cursor, total);
  if (!spine.length) pushGap(0, total);

  const attach = (t: Seconds, build: (localOffset: string) => string) => {
    const host = spine.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? spine[spine.length - 1];
    host.children.push(build(R(host.local(t))));
  };

  /* ---------- conectados ---------- */
  let lane = 1;
  for (const tr of videoTracks.slice(1)) {
    for (const c of tr.clips) {
      if ((c.type !== 'video' && c.type !== 'image') || !assetRef.has(c.assetId)) continue;
      const l = lane;
      attach(c.start, (off) => {
        const { open } = clipAttrs(c, `offset="${off}"`, l);
        return `${open}${clipInner(c).join('')}</asset-clip>`;
      });
    }
    lane++;
  }
  let tsId = 1;
  const title = (text: string, start: Seconds, dur: Seconds, l: number, st: TextClip['style'] | Project['captions']['style'], name: string) => {
    const id = `ts${tsId++}`;
    const shown = st.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
    attach(start, (off) =>
      `<title ref="${titleRef}" lane="${l}" name="${esc(name)}" offset="${off}" start="3600s" duration="${R(dur)}">` +
        `<text><text-style ref="${id}">${esc(shown)}</text-style></text>` +
        `<text-style-def id="${id}"><text-style font="${esc(st.fontFamily || 'Poppins')}" fontSize="${Math.round(st.fontSize * 1080 / 1920 * (p.height / 1080))}" fontColor="${fcpColor(st.color)}"` +
        `${st.fontWeight >= 600 ? ' bold="1"' : ''}${st.strokeColor && st.strokeWidth ? ` strokeColor="${fcpColor(st.strokeColor, '0 0 0 1')}" strokeWidth="${st.strokeWidth}"` : ''}` +
        ` alignment="${st.align || 'center'}"/></text-style-def></title>`,
    );
  };
  for (const tr of p.tracks.filter((t) => t.kind === 'text')) {
    for (const c of tr.clips) if (c.type === 'text' && c.text.trim()) title(c.text, c.start, c.duration, lane, c.style, c.label || c.text.slice(0, 32));
    lane++;
  }
  if (p.captions.enabled) {
    for (const s of p.captions.segments) if (s.text.trim() && s.end > s.start) title(s.text, s.start, s.end - s.start, lane, p.captions.style, 'Legenda');
    lane++;
  }
  let alane = -1;
  for (const tr of p.tracks.filter((t) => t.kind === 'audio')) {
    for (const c of tr.clips) {
      if (c.type !== 'audio' || !assetRef.has(c.assetId)) continue;
      const l = alane;
      attach(c.start, (off) => {
        const { open } = clipAttrs(c, `offset="${off}"`, l);
        return `${open}${clipInner(c).join('')}</asset-clip>`;
      });
    }
    alane--;
  }

  const spineXml = spine.map((s) => `${s.xmlOpen}${s.children.join('')}${s.close}`).join('\n          ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    ${res.join('\n    ')}
  </resources>
  <library>
    <event name="EditorPro">
      <project name="${esc(p.name || 'EditorPro')}">
        <sequence format="${fmtId}" duration="${R(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
          ${spineXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
