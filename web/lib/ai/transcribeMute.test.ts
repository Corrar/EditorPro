/* review r3 (legendas): vídeo sem faixa de áudio = "sem fala", não falha da transcrição */
import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '../types';

const h = vi.hoisted(() => ({ decode: vi.fn() }));
// medido no Chromium (Playwright): decodeAudioData de um mp4 sem áudio → "EncodingError: Unable to decode audio data"
vi.mock('./analysis', async (orig) => ({ ...(await orig<typeof import('./analysis')>()), decodeAudio: h.decode }));

import { transcribeMedia, type TranscribeInfo } from './whisper';

const asset: MediaAsset = { id: 'b', kind: 'video', role: 'source', name: 'broll.mp4', mime: 'video/mp4', size: 1, duration: 5, url: 'blob:x' };

describe('transcribeMedia com vídeo sem faixa de áudio', () => {
  it('devolve [] e avisa "sem fala" (antes: lançava "Unable to decode audio data" e a legenda de TODOS os vídeos caía)', async () => {
    h.decode.mockRejectedValueOnce(new DOMException('Unable to decode audio data', 'EncodingError'));
    let info: TranscribeInfo | undefined;
    await expect(transcribeMedia(asset, { onInfo: (i) => { info = i; } })).resolves.toEqual([]);
    expect(info?.label).toBe('sem fala');
  });
  it('outros erros continuam sendo erro (arquivo grande demais etc.)', async () => {
    h.decode.mockRejectedValueOnce(new Error('arquivo grande demais para analisar no navegador'));
    await expect(transcribeMedia(asset)).rejects.toThrow(/grande demais/);
  });
});
