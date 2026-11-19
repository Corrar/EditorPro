/* =====================================================================
   Autoteste do encoder antes do export: codifica 2 quadros de uma imagem
   conhecida com a config escolhida, decodifica de volta e confere que não
   saiu preto. Alguns encoders de hardware no Android (MediaCodec) aceitam a
   config mas geram quadros pretos/verdes a partir de canvas — aí o export
   troca para a próxima config (sem aceleração) em vez de entregar MP4 preto.
   ===================================================================== */
import { lumaStats } from './blackCheck';

/** true = imagem ok; false = saiu preto/errado; null = não deu p/ testar (sem decoder, timeout) */
export async function encoderProducesImage(config: VideoEncoderConfig, timeoutMs = 4000): Promise<boolean | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const W = config.width, H = config.height;
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const cx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!cx) return null;
  // laranja da marca + faixa branca: luma média bem acima de preto
  cx.fillStyle = '#F2681F';
  cx.fillRect(0, 0, W, H);
  cx.fillStyle = '#FFFFFF';
  cx.fillRect(0, Math.round(H * 0.4), W, Math.round(H * 0.2));

  const chunks: EncodedVideoChunk[] = [];
  let decCfg: VideoDecoderConfig | undefined;
  let enc: VideoEncoder | null = null;
  let dec: VideoDecoder | null = null;
  const work = (async (): Promise<boolean | null> => {
    let failed = false;
    enc = new VideoEncoder({
      output: (c, meta) => { chunks.push(c); if (meta?.decoderConfig) decCfg = meta.decoderConfig; },
      error: () => { failed = true; },
    });
    enc.configure(config);
    for (let i = 0; i < 2; i++) {
      const f = new VideoFrame(canvas, { timestamp: i * 33_333, duration: 33_333, alpha: 'discard' });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await enc.flush();
    if (failed) return false;
    if (!chunks.length) return false;
    if (!decCfg) return null;
    let out: VideoFrame | null = null;
    dec = new VideoDecoder({ output: (f) => { if (!out) out = f; else f.close(); }, error: () => { failed = true; } });
    const ok = await VideoDecoder.isConfigSupported(decCfg).catch(() => ({ supported: false }));
    if (!ok.supported) return null;
    dec.configure(decCfg);
    for (const c of chunks) dec.decode(c);
    await dec.flush();
    if (failed || !out) return null; // nosso decoder falhou: não condena o encoder
    const frame = out as VideoFrame;
    const probe: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(16, 16)
      : Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const pc = probe.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    pc.drawImage(frame, 0, 0, 16, 16);
    frame.close();
    const { avg } = lumaStats(pc.getImageData(0, 0, 16, 16).data);
    // esperado ≈ 150 (laranja 125 + faixa branca); preto/verde-escuro fica < 60
    return avg > 60;
  })().catch(() => null);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    try { (enc as VideoEncoder | null)?.state !== 'closed' && (enc as VideoEncoder | null)?.close(); } catch { /* ok */ }
    try { (dec as VideoDecoder | null)?.state !== 'closed' && (dec as VideoDecoder | null)?.close(); } catch { /* ok */ }
  }
}
