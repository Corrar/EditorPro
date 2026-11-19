# EditorPro — memória do projeto

> Editor de vídeo com IA: o usuário descreve o vídeo, envia material + vídeo-exemplo e a
> IA edita **ao vivo** (timeline/preview mudando passo a passo), com chat para correções.
> Design v2 "app de banco premium" (pedido do Bruno: nível PicPay) sobre a base do Radar Local:
> laranja `#F2681F`, blocos cinza arredondados, Plus Jakarta Sans — ver `docs/superpowers/specs/2026-11-19-design-v2.md`.
> Spec: `docs/superpowers/specs/2026-11-18-editorpro-design.md`.
> **Regra do Bruno:** ao fim de cada fase, pare e confira o plano (checkpoint).

## Stack
- `web/` — Next.js 14 (app router) + TypeScript + zustand. Vitest p/ testes.
- IA: **Claude (API da Anthropic)** via rotas server-side `/api/ai/*` (`ANTHROPIC_API_KEY` só no
  servidor; modelo `claude-opus-5-5`; ver `web/.env.example`). Claude não recebe vídeo/áudio: o
  navegador extrai quadros (vídeo-exemplo/material) e transcreve com Whisper local
  (transformers.js, grátis). Sem chave → modo demo (planejador local).
- Sem CapCut: não há API pública. Ponte com outros editores = export MP4/SRT/FCPXML.

## Contrato (NÃO quebrar)
- `web/lib/types.ts` — `Project`, `Track`, `Clip` (video/image/audio/text), `Captions`,
  `StyleProfile`, `MediaAsset`, `ChatMessage`. Tempo em segundos; posições normalizadas 0..1.
- `web/lib/ops.ts` — `EditOp` + `applyOp`/`applyOps` (puro, imutável, testado). Toda edição
  (manual ou IA) é uma op. `opFocus()` diz onde a op mexe (p/ animar ao vivo).
- `web/lib/events.ts` — eventos entre módulos (`emit`/`on`): open-export, start-ai-edit, generate-captions, attach-files, toast.
- `web/lib/store.ts` — `useEditor`: `project`, `assets`, `dispatch`, `undo/redo`,
  `playhead/playing/zoom/selection`, `messages`, `applyLive(ops)` (edição ao vivo, 1 desfazer).
- Mudanças no contrato só aditivas (campo opcional / op nova + teste em `ops.test.ts`).

## PWA (instalável) e design
- `web/public/manifest.webmanifest`, `web/public/sw.js` (shell offline; nunca cacheia `/api/`),
  ícones gerados (play + ponto, no estilo da marca do Radar). `web/lib/pwa.ts` = `registerPWA()`
  (chamado em `app/pwa-register.tsx`) + hook `useInstallPrompt()` p/ o botão "Instalar app".
- Responsivo em tudo (desktop, Android, iPhone/iPad, app instalado). Breakpoints: ≥1440 · 1100–1439 ·
  900–1099 (chat/painel viram gavetas) · ≤899 empilhado tipo CapCut mobile (preview em cima, timeline
  embaixo, barra inferior + bottom-sheets) · ≤480 · paisagem no celular. Toque via Pointer Events,
  long-press no lugar do botão direito, alvos ≥44px, nada depende de hover, safe-area, sem scroll horizontal.
- Modelo visual: `design/radar-reference/` (cópia somente leitura do painel Radar Local).

## Módulos (cada um com dono; não editar pasta alheia)
- Timeline: `components/timeline/**`, `lib/timeline/**`, `styles/timeline.css`
- Engine/Preview/Export: `lib/engine/**`, `lib/export/**`, `components/preview/**`, `styles/preview.css`
- IA/Chat: `app/api/**`, `lib/ai/**`, `components/chat/**`, `styles/chat.css`, `prompts/**`
- Shell/Mídia/Painéis/Persistência: `components/{shell,media,panels}/**`, `lib/{media,persist}/**`,
  `app/page.tsx`, `styles/{shell,media,panels}.css`
- Classes CSS: `.ep-*` compartilhadas em `app/globals.css` (tokens em `.ep-root`, `--green` = laranja).

## Deploy (Vercel)
- Projeto Vercel **`editor-pro`** (`prj_4ow4vaCopsLqpdQbcUuBrdyRbspF`, team `team_boHR5HKaBgxuWff3stQypEfG`),
  Root Directory = `web`. URL: **https://editorpro-ia.vercel.app** (público, com login próprio;
  previews ficam atrás do login da Vercel). Produção acompanha a branch `claude/ai-video-editor-r0tr67`
  (push nela = deploy). Envs: `ANTHROPIC_MODEL`, `DASH_PASSWORD` (sensível), `ANTHROPIC_API_KEY` (Bruno coloca).
- Login por senha (`middleware.ts` + `lib/auth.ts`, portado do Radar) protege `/`, `/dev/*` e `/api/ai/*`.
- Sem backend extra: as rotas `/api/ai/*` do Next rodam como funções da Vercel. Render/Neon/R2 só
  quando houver salvar na nuvem (projetos em Neon, mídia/efeitos em R2) — hoje tudo fica no navegador.

## Branches
- Integração: `claude/ai-video-editor-r0tr67`. Sessões de módulo: `claude/ai-video-editor-r0tr67-<módulo>`.

## Estado (2026-11-18, 1ª integração)
- As 4 sessões de módulo foram integradas na `claude/ai-video-editor-r0tr67` e publicadas: 181 testes, build ok,
  fluxo wizard → IA (demo) → editor validado no Playwright (14 ops ao vivo, sem erros), desktop + iPhone sem overflow.
- IA real depende de `ANTHROPIC_API_KEY` na Vercel (status hoje: demo). Hosts externos usados no navegador:
  cdn.jsdelivr.net (transformers.js/MediaPipe), huggingface.co (Whisper), storage.googleapis.com (MediaPipe).
- Sessões de módulo seguem nas branches `-timeline/-engine/-ai/-shell`; integrar de novo com merge (sem rebase).

## Como rodar/validar
```
cd web && npm install
npm test            # vitest
npm run build       # sempre antes de commitar
npm run dev         # http://localhost:3000
```
Playwright/Chromium já instalados no container (não reinstalar). Vídeo de teste:
`ffmpeg -f lavfi -i testsrc2=duration=10:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=10 -shortest /tmp/teste.mp4`
(se `ffmpeg` não existir, gere com canvas+MediaRecorder no Playwright).

## Convenções
- Responder ao Bruno em **português**, direto. UI 100% em PT-BR.
- Commits com rodapé `Co-Authored-By`/`Claude-Session`; **nunca** identificador de modelo em
  arquivo versionado.
