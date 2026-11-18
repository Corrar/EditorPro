/* =====================================================================
   Upload para a Files API do Gemini, sem passar o vídeo inteiro pela função
   (limite de 4,5 MB da Vercel):
   POST /api/ai/upload  {name, mime, size}            -> {uploadUrl, chunkSize}
        o navegador tenta enviar direto para uploadUrl (protocolo resumable);
   PUT  /api/ai/upload?u=<uploadUrl>&offset=N&final=0|1  (corpo = bloco ≤ chunkSize)
        fallback se o navegador não puder falar direto com o Google (CORS);
        no bloco final devolve {file}
   GET  /api/ai/upload?name=files/abc                 -> {file} (espera até ~50 s por ACTIVE;
        se ainda estiver PROCESSING devolve state=PROCESSING e o cliente repete)
   ===================================================================== */
import { AIError, PROXY_CHUNK, UPLOAD_URL_RE, aiConfig, forwardChunk, startResumableUpload, waitActive } from '@/lib/ai/server/gemini';
import { fail, ok, readJson } from '@/lib/ai/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_SIZE = 2 * 1024 ** 3; // limite da Files API (2 GB)
const MIME_OK = /^(video|audio|image)\//;

function requireConfigured() {
  if (!aiConfig().configured) throw new AIError('IA não configurada (modo demo).', 503, 'not_configured');
}

export async function POST(req: Request) {
  try {
    requireConfigured();
    const body = await readJson<{ name?: string; mime?: string; size?: number }>(req);
    const mime = String(body.mime || '');
    const size = Number(body.size);
    if (!MIME_OK.test(mime)) throw new AIError('Tipo de arquivo não suportado pela IA.', 415, 'bad_mime');
    if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) throw new AIError('Arquivo vazio ou maior que 2 GB.', 413, 'bad_size');
    const uploadUrl = await startResumableUpload({ displayName: String(body.name || 'editorpro'), mime, size });
    return ok({ uploadUrl, chunkSize: PROXY_CHUNK });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: Request) {
  try {
    requireConfigured();
    const url = new URL(req.url);
    const uploadUrl = url.searchParams.get('u') || '';
    const offset = Number(url.searchParams.get('offset'));
    const final = url.searchParams.get('final') === '1';
    if (!UPLOAD_URL_RE.test(uploadUrl)) throw new AIError('URL de upload inválida.', 400, 'bad_upload_url');
    if (!Number.isInteger(offset) || offset < 0) throw new AIError('offset inválido.', 400);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > PROXY_CHUNK) throw new AIError('Bloco grande demais.', 413);
    if (!final && buf.byteLength % (256 * 1024) !== 0) throw new AIError('Bloco intermediário deve ser múltiplo de 256 KiB.', 400);
    const res = await forwardChunk(uploadUrl, offset, final, buf);
    return ok(res);
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: Request) {
  try {
    requireConfigured();
    const name = new URL(req.url).searchParams.get('name') || '';
    const file = await waitActive(name, 45_000);
    return ok({ file });
  } catch (e) {
    return fail(e);
  }
}
