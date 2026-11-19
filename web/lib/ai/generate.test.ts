import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenClientError, requestGeneration } from './generate';
import { genProvider, httpProvider } from './server/gen';
import { POST as startRoute } from '../../app/api/gen/start/route';
import { GET as statusRoute } from '../../app/api/gen/status/route';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('rotas /api/gen (sem GPU)', () => {
  it('start e status respondem 501 "GPU não configurada"; probe diz configured:false', async () => {
    vi.stubEnv('GEN_PROVIDER', '');
    const r1 = await startRoute(new Request('http://x/api/gen/start', { method: 'POST', body: JSON.stringify({ kind: 'text-to-video', params: {} }) }));
    expect(r1.status).toBe(501);
    expect(await r1.json()).toEqual({ configured: false, motivo: 'GPU não configurada' });
    const r2 = await statusRoute(new Request('http://x/api/gen/status?jobId=abc'));
    expect(r2.status).toBe(501);
    const r3 = await statusRoute(new Request('http://x/api/gen/status?probe=1'));
    expect(await r3.json()).toMatchObject({ configured: false, capabilities: [] });
  });

  it('com GEN_PROVIDER=http repassa ao endpoint e valida o tipo', async () => {
    vi.stubEnv('GEN_PROVIDER', 'http');
    vi.stubEnv('GEN_ENDPOINT', 'https://gpu.example/run');
    vi.stubEnv('GEN_API_KEY', 'segredo');
    vi.stubEnv('GEN_CAPABILITIES', 'text-to-video,image-to-video');
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, auth: new Headers(init.headers).get('Authorization') });
      return body.action === 'start' ? json({ jobId: 'job_1' }) : json({ status: 'running', progress: 0.4 });
    }));
    expect(genProvider()?.capabilities).toEqual(['text-to-video', 'image-to-video']);
    const probe = await (await statusRoute(new Request('http://x/api/gen/status?probe=1'))).json();
    expect(probe).toMatchObject({ configured: true, capabilities: ['text-to-video', 'image-to-video'] });

    const bad = await startRoute(new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'avatar', params: {} }) }));
    expect(bad.status).toBe(400); // fora das capacidades

    const ok = await startRoute(new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'text-to-video', params: { prompt: 'padaria de manhã', duration: 999, aspect: '9:16', lixo: 1 } }) }));
    expect(await ok.json()).toEqual({ jobId: 'job_1' });
    expect(calls[0]).toMatchObject({ url: 'https://gpu.example/run', auth: 'Bearer segredo' });
    expect(calls[0].body).toEqual({ action: 'start', kind: 'text-to-video', params: { prompt: 'padaria de manhã', duration: 60, aspect: '9:16' } });

    const st = await (await statusRoute(new Request('http://x/api/gen/status?jobId=job_1'))).json();
    expect(st).toEqual({ status: 'running', progress: 0.4 });
  });

  it('httpProvider propaga erro do worker e ignora url inválida', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      return b.action === 'start' ? json({ error: 'sem GPU livre' }, 503) : json({ status: 'done', url: 'javascript:alert(1)' });
    }) as unknown as typeof fetch;
    const p = httpProvider('https://gpu.example', '', f);
    await expect(p.start({ kind: 'extend', params: {} })).rejects.toThrow('sem GPU livre');
    expect(await p.poll('j')).toEqual({ status: 'done' });
  });
});

describe('cliente requestGeneration', () => {
  it('inicia, faz polling com progresso e devolve a url', async () => {
    const seq = [{ status: 'queued' }, { status: 'running', progress: 0.5 }, { status: 'done', url: 'https://cdn.example/v.mp4' }];
    const f = vi.fn(async (url: string) => (url === '/api/gen/start' ? json({ jobId: 'j9' }) : json(seq.shift()))) as unknown as typeof fetch;
    const progress: string[] = [];
    const r = await requestGeneration('text-to-video', { prompt: 'x' }, { fetchImpl: f, sleep: async () => {}, onProgress: (s, p) => progress.push(`${s}${p ?? ''}`) });
    expect(r).toEqual({ url: 'https://cdn.example/v.mp4', jobId: 'j9' });
    expect(progress).toEqual(['queued', 'running0.5', 'done']);
  });

  it('501 vira erro com o motivo; erro do job vira exceção', async () => {
    const f1 = vi.fn(async () => json({ configured: false, motivo: 'GPU não configurada' }, 501)) as unknown as typeof fetch;
    await expect(requestGeneration('avatar', {}, { fetchImpl: f1 })).rejects.toThrow('GPU não configurada');
    const f2 = vi.fn(async (url: string) => (url === '/api/gen/start' ? json({ jobId: 'j' }) : json({ status: 'error', error: 'OOM' }))) as unknown as typeof fetch;
    await expect(requestGeneration('extend', {}, { fetchImpl: f2, sleep: async () => {} })).rejects.toBeInstanceOf(GenClientError);
  });
});
