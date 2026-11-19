# Módulo IA + Chat

**Claude (Anthropic)** via rotas server-side (`ANTHROPIC_API_KEY` só no servidor; `ANTHROPIC_MODEL`,
padrão `claude-opus-5-5`). Sem chave → **modo demo** local. O Claude só recebe texto e imagens:
- vídeo-exemplo → o navegador extrai ~1 quadro/s (JPEG ≤512 px) + mede os cortes de cena;
- fala → **Whisper no navegador** (transformers.js num Web Worker, grátis, sem chave), em ambos os modos.

## Rotas (`app/api/ai/*`, runtime nodejs, `maxDuration` 300)
| rota | entrada | saída |
|---|---|---|
| `GET status` | — | `{configured, provider: 'anthropic'\|'demo', model?}` |
| `POST analyze-reference` | `{frames: [{t, data, mediaType}], metrics: {duration, cuts, avgShotLength, pacing, aspect}}` | `{style: StyleProfile}` (métricas medidas prevalecem) |
| `POST edit` | `{project, assets, messages, userText, mode: 'first'\|'chat'\|'comments', frames, context?}` | `{reply, ops, dropped, comments}` — ops já sanitizadas |
| `POST translate` | `{segments: [{id, text}], to, from?}` | `{segments}` |

Chamadas: `client.beta.messages.stream` + `finalMessage()`, saída estruturada (`betaZodOutputFormat`),
`effort` high (1ª edição) / medium (chat, estilo), `fallbacks: "default"` (recusa), prompt de sistema
estável com `cache_control`. Corpo < 4 MB (o cliente reduz quadros se preciso).
Prompts em `web/prompts/*.md` (incluídos no bundle via `outputFileTracingIncludes`).

## Cliente (`lib/ai`)
- `client.ts` — `getStatus`, `analyzeReference(sample)`, `requestEdit(req)`.
- `pipeline.ts` — `runFirstEdit({brief, …})`, `generateCaptions({language})`, `chatEdit(text)`; tudo via `store.applyLive`, agrupado num único desfazer. Opções: `onStatus`, `onLog`, `ask` (perguntas com botões), `skippable` (botão "Pular"), `whisper`.
- `chatStore.ts` — `useAIChat`: narração, passos ao vivo, perguntas, pular transcrição, "Desfazer esta edição", preferência CC (Whisper on/off, `localStorage ep_ai_whisper`).
- `frames.ts` — amostragem de quadros (Safari iOS ok: `muted`+`playsInline`, seek+`seeked`, `toBlob`), perfil do aparelho.
- `whisper.ts` + `whisper.worker.ts` — WebGPU (f16) → WASM; celular/aparelho fraco = `whisper-tiny` (~41 MB), desktop = `whisper-base` (~77 MB); áudio em pedaços de ~60 s cortados no silêncio; transformers.js carregado do CDN (versão fixa) dentro do worker.
- `words.ts` — palavras do Whisper → frases; `validate.ts`, `sanitize.ts`, `timemap.ts`, `summary.ts`, `schemas.ts` (zod).
- `demo.ts` (puro) + `analysis.ts` (navegador) — silêncios por RMS, ritmo do exemplo, plano da 1ª edição, comandos do chat.

## Recursos estilo CapCut (`features.ts`, puro + `reframe.ts`/`analysis.ts` no navegador)
- **Cortar vícios** (né/tipo/éé/hum…) por ids de palavra do Whisper → `remove_words` (exato, grátis, nos dois modos).
- **Destaques** (melhores trechos pela transcrição até N s), **capítulos** (`add_marker` kind `chapter`), **gancho** (título + zoom + flash).
- **Batidas**: usa `asset.beats` ou detecta no navegador (`detectBeats`) e guarda no asset; **sincronizar cortes na batida** e **marcar batidas**.
- **Auto-reframe**: MediaPipe FaceDetector (CDN, versão fixa) nos quadros amostrados; sem rosto, "centro de detalhe"; keyframes de `transform.x` (engine: `cx = W/2 + x·W`).
- **Traduzir legendas**: rota `POST /api/ai/translate` (Claude); no demo avisa que precisa da chave.
- Palavras ganham ids `w00001…` em todo `set_captions`; o resumo manda `[w00012 4.20-4.45] né` ao Claude.
- **Apontar para qualquer coisa**: `store.chatContext` vira chip acima do campo e vai junto do pedido (`context`); **Aplicar comentários** (`markers` kind `comment`) → Claude/demo aplica, marca `resolved` e responde cada um.

## UI
`components/chat/ChatPanel.tsx` (default export) — coluna no desktop ou bottom-sheet no celular
(container query no próprio painel; fonte 16 px e alvos de 44 px no toque; safe-area). Escuta
`ep:start-ai-edit` e `ep:generate-captions`; anexar emite `ep:attach-files`. Harness: `/dev/chat` (`?lang=en-US`).
