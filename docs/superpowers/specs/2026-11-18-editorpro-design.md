# EditorPro — editor de vídeo com IA (design)

Data: 2026-11-18 · Dono: Bruno · Sessão principal: orquestra e integra.

## Intenção
O usuário **descreve** como quer o vídeo, **envia o material bruto** e um **vídeo-exemplo**
(referência de estilo). A IA entende o pedido + o estilo do exemplo e **edita ao vivo**: a
timeline e o preview vão mudando passo a passo na frente do usuário, com narração no chat.
O usuário corrige pelo chat ("tira esse zoom", "legenda maior", "corta o começo") e a IA
aplica de novo. Tudo também pode ser editado à mão, como num CapCut.

## Decisão: conectar ao CapCut?
O CapCut **não tem API pública de edição** e os rascunhos (`draft_content.json`) das versões
atuais são criptografados — integração direta é frágil/inviável. Decisão: **editor próprio,
profissional, no navegador**, com legendas. Ponte com outros editores via **exportação**:
MP4 (final), **SRT** (legendas) e **FCPXML** (abre no DaVinci Resolve, Final Cut, Premiere
via import). Exportar rascunho CapCut fica como experimento futuro.

## Objetivos
- Fluxo "descreva + envie + IA edita" funcionando ponta a ponta.
- Preview em tempo real (canvas) fiel ao export.
- Timeline multipista (vídeo, texto, áudio) com cortar/aparar/mover/dividir, zoom, snapping.
- Legendas automáticas (transcrição) com estilos (bold-pop, karaokê, caixa, neon...).
- Chat de ordens com desfazer por mensagem.
- Export MP4 no navegador; SRT; FCPXML.
- Design do Radar Local (laranja `#D9641E`, marrom quente no escuro, Poppins).

## Não-objetivos (agora)
Colaboração multiusuário, contas/login, armazenamento em nuvem, apps móveis nativos,
renderização em servidor.

## Anti-objetivos
- IA que edita "às cegas" sem mostrar o passo a passo.
- Chave da IA exposta no navegador.
- Formato de projeto diferente por módulo (tudo fala `lib/types.ts` + `lib/ops.ts`).

## Arquitetura
- **Next.js 14 (app router) + TypeScript**, em `web/`. Estado em **zustand** (`lib/store.ts`).
- **Documento**: `Project` (`lib/types.ts`). Só muda via **`EditOp`** (`lib/ops.ts`,
  reducer puro e testado). UI manual e IA usam as mesmas ops → desfazer/refazer grátis.
- **Edição ao vivo**: a IA devolve `{ reply, ops[] }`, cada op com `explain`.
  `store.applyLive(ops)` aplica uma a uma (~450 ms), move o playhead para o ponto
  afetado e destaca o clipe (`live.highlightClipId`); o chat narra `op.explain`.
  O lote inteiro é UM passo de desfazer.
- **Preview/engine**: `lib/engine.renderFrame(ctx, project, t, media)` desenha o quadro
  (vídeo/imagem com transform/keyframes/filtros/transições, textos, legendas animadas).
  `<Preview>` usa elementos `<video>` sincronizados + requestAnimationFrame.
- **Export**: mesmo `renderFrame` quadro a quadro → WebCodecs/MediaRecorder (+ ffmpeg.wasm
  se precisar de MP4) e mix de áudio via OfflineAudioContext.
- **IA**: **Claude (API da Anthropic, modelo `claude-opus-5-5`)** — decisão do Bruno — via rotas
  server-side `/api/ai/*` (chave `ANTHROPIC_API_KEY` só no servidor). O Claude recebe texto e
  imagens (não vídeo/áudio), então: o navegador amostra quadros do vídeo-exemplo (+ detecção local
  de cortes) e o Claude devolve o `StyleProfile`; a transcrição roda **no navegador com Whisper**
  (transformers.js, gratuito). Sem chave → **modo demo**
  com planejador heurístico local (corta silêncios por análise de áudio, título, legenda de
  exemplo), para o app funcionar e ser testável sem custo.
  - `GET  /api/ai/status` → `{configured, provider, model}`
  - `POST /api/ai/analyze-reference` (quadros JPEG + métricas de corte, < 4 MB) → `StyleProfile`
  - transcrição: local (Web Worker + Whisper), sem rota
  - `POST /api/ai/edit` → `{reply, ops}` (saída estruturada JSON, validada no servidor)
- **Persistência**: IndexedDB (projeto + blobs de mídia), autosave.

## Módulos e donos (sessões paralelas)
| Módulo | Pastas (exclusivas) | Sessão |
|---|---|---|
| Timeline | `components/timeline/**`, `lib/timeline/**`, `styles/timeline.css` | timeline |
| Engine + Preview + Export | `lib/engine/**`, `lib/export/**`, `components/preview/**`, `styles/preview.css` | engine |
| IA + Chat | `app/api/**`, `lib/ai/**`, `components/chat/**`, `styles/chat.css`, `prompts/**` | ai |
| Shell + Mídia + Painéis + Persistência | `components/shell/**`, `components/media/**`, `components/panels/**`, `lib/media/**`, `lib/persist/**`, `app/page.tsx`, `styles/shell.css`, `styles/media.css`, `styles/panels.css` | shell |
| Contrato (`lib/types.ts`, `lib/ops.ts`, `lib/store.ts`, `lib/defaults.ts`, `lib/util.ts`, `app/globals.css`, `app/layout.tsx`) | — | principal |

Mudanças no contrato: só **aditivas** (campo opcional / op nova) e descritas no resumo final
da sessão; a principal integra.

## Fluxo do usuário
1. Tela inicial (wizard): descrição + material bruto + vídeo-exemplo (opcional) + formato
   (9:16, 16:9, 1:1, 4:5).
2. "Editar com IA": envia mídia → analisa exemplo → transcreve → pede o plano → aplica ao vivo.
3. Usuário ajusta pelo chat ou à mão (timeline + inspetor).
4. Exporta MP4 / SRT / FCPXML.

## Eventos entre módulos (`web/lib/events.ts`)
`emit()/on()` tipados, para os módulos não importarem uns aos outros enquanto são construídos
em paralelo: `ep:open-export` (shell→engine), `ep:start-ai-edit` (shell→ai),
`ep:generate-captions` (shell→ai), `ep:attach-files` (ai→shell), `ep:toast` (todos→shell).
Atalhos de teclado do editor são TODOS da timeline (espaço, S, Delete, Ctrl+Z, setas).
