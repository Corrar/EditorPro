# Módulo IA + Chat

Gemini via rotas server-side (`GEMINI_API_KEY` só no servidor). Sem chave → **modo demo** local.

## Rotas (`app/api/ai/*`, runtime nodejs)
| rota | entrada | saída |
|---|---|---|
| `GET status` | — | `{configured, provider: 'gemini'\|'demo', model?}` |
| `POST upload` | `{name, mime, size}` | `{uploadUrl, chunkSize}` — sessão resumable da Files API (a URL não contém a chave) |
| `PUT upload?u=&offset=&final=` | bloco ≤ 3,75 MiB | `{done, file?}` — fallback quando o navegador não consegue enviar direto (CORS) |
| `GET upload?name=files/x` | — | `{file}` — espera até ~45 s por `ACTIVE` (cliente repete se `PROCESSING`) |
| `POST analyze-reference` | `{fileUri, mime, duration}` | `{style: StyleProfile}` |
| `POST transcribe` | `{fileUri, mime, duration, language}` | `{segments}` — tempos **da mídia**, validados/ordenados/divididos |
| `POST edit` | `{project, assets, messages, userText, mode, media}` | `{reply, ops, dropped}` — ops já sanitizadas |

Prompts em `web/prompts/*.md` (incluídos no bundle via `outputFileTracingIncludes`).
`GEMINI_API_BASE` (opcional) aponta o servidor para um mock em testes locais.

## Cliente (`lib/ai`)
- `client.ts` — `getStatus`, `uploadForAI` (direto → fallback por blocos → espera ACTIVE), `analyzeReference`, `transcribe`, `requestEdit`.
- `pipeline.ts` — `runFirstEdit({brief, onStatus, onLog, apply})`, `generateCaptions({language})`, `chatEdit(text)`; tudo aplicado com `store.applyLive` e agrupado num único desfazer.
- `chatStore.ts` — `useAIChat`: narração, passos ao vivo e "Desfazer esta edição" por mensagem.
- `validate.ts` — `sanitizeOps(raw, project, assets)`; `sanitize.ts` — transcrição/estilo/valores; `timemap.ts` — mídia ↔ timeline.
- `demo.ts` (puro) + `analysis.ts` (navegador) — silêncios por RMS, ritmo do exemplo por diferença de quadros, plano da 1ª edição e comandos do chat.

## UI
`components/chat/ChatPanel.tsx` (default export) — escuta `ep:start-ai-edit` e `ep:generate-captions`; anexar emite `ep:attach-files`.
Harness: `/dev/chat`.
