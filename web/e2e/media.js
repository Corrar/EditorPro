/* gera a mídia de teste com ffmpeg em e2e/.media (ignorada no git) */
const { execFileSync, spawnSync } = require('child_process');
const ffStderr = (args) => spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr || '';
const fs = require('fs');
const path = require('path');
const { MEDIA } = require('./lib');

const FILES = {
  h264: { name: 'h264_1080x1920.mp4', args: (o) => ['-f', 'lavfi', '-i', 'testsrc2=duration=10:size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', o] },
  hevc: { name: 'hevc_1080x1920.mp4', args: (o) => ['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4', '-shortest', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', o] },
  k4: { name: '4k_2160x3840.mp4', args: (o) => ['-f', 'lavfi', '-i', 'testsrc2=duration=3:size=2160x3840:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', o] },
};

function ensureMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const out = {};
  for (const [k, f] of Object.entries(FILES)) {
    const p = path.join(MEDIA, f.name);
    if (!fs.existsSync(p) || fs.statSync(p).size < 1000) {
      try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...f.args(p)], { stdio: 'inherit' }); }
      catch (e) { console.warn(`[media] não gerou ${f.name}: ${e.message}`); continue; }
    }
    out[k] = p;
  }
  return out;
}

/** ffprobe/ffmpeg num arquivo exportado: duração, streams, quadros pretos */
function analyzeExport(file) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = +probe.format.duration || +(v && v.duration) || 0;
  // blackdetect: trechos ≥ 1 quadro com pixels quase pretos
  let black = [];
  black = parseBlack(ffStderr(['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.03:pix_th=0.10:pic_th=0.98', '-an', '-f', 'null', '-']));
  // luminância média por quadro (pega quadro preto parcial/escuro que o blackdetect deixa passar)
  const yavg = [...ffStderr(['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-']).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  const darkFrames = yavg.map((y, i) => [i, y]).filter(([, y]) => y < 20);
  // volume do áudio (detecta faixa muda)
  let meanVolume = null;
  if (a) {
    meanVolume = parseVol(ffStderr(['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']));
  }
  return { duration, video: v ? { codec: v.codec_name, w: v.width, h: v.height, frames: +v.nb_frames || null } : null, audio: a ? { codec: a.codec_name, sr: +a.sample_rate } : null, black, meanVolume, minYavg: yavg.length ? +Math.min(...yavg).toFixed(1) : null, darkFrames: darkFrames.length, firstDark: darkFrames.slice(0, 5).map(([i]) => i) };
}
function parseBlack(s) {
  return [...s.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2], dur: +m[3] }));
}
function parseVol(s) { const m = s.match(/mean_volume:\s*(-?[\d.]+) dB/); return m ? +m[1] : null; }

module.exports = { ensureMedia, analyzeExport, FILES };
