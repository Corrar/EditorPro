# Relatório E2E — EditorPro

- Commit: `70b8304` · 2026-11-19T03:05:53.276Z
- Alvo: http://localhost:3100 (`next start`, modo demo da IA)
- Navegador: Chromium 157.0.8103.78 (headless, sem GPU)
- Perfis: Desktop 1440×900 · Pixel 7 (escuro) · iPhone SE (claro)
- Duração da rodada: 357 s

## Resumo

| Caso | Desktop 1440×900 | Pixel 7 (escuro) | iPhone SE (claro) |
|---|---|---|---|
| 1. Fluxo principal | ✅ ok | ✅ ok | ✅ ok |
| 2. Reprodução sem tela preta | ❌ falha | ❌ falha | ❌ falha |
| 2b. Reprodução no editor (pós-IA) | ✅ ok | ✅ ok | ✅ ok |
| 3. Fluidez (play 5 s) | ✅ ok | ℹ️ info | ℹ️ info |
| 4. Export | ✅ ok | ✅ ok | ✅ ok |
| 5. Layout (menus + scroll horizontal) | ✅ ok | ✅ ok | ❌ falha |
| 6. Cursor da IA | ✅ ok | ❌ falha | ❌ falha |
| 7. Pop-up da IA | ❌ falha | ✅ ok | ✅ ok |
| 8. Mídia 4K H.264 | ❌ falha | · | · |
| 8. Mídia HEVC 1080×1920 | ❌ falha | · | · |

## Detalhes

### 1. Fluxo principal

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | até Pronto (s): 9.1<br>pulou legendas: false<br>pageerrors: 0<br>console.error: 0 | [desktop-wizard.png](shots/desktop-wizard.png)<br>[desktop-pronto.png](shots/desktop-pronto.png) |  |
| Pixel 7 (escuro) | ✅ ok | até Pronto (s): 5.5<br>pulou legendas: true<br>pageerrors: 0<br>console.error: 0 | [pixel7-wizard.png](shots/pixel7-wizard.png)<br>[pixel7-pronto.png](shots/pixel7-pronto.png) |  |
| iPhone SE (claro) | ✅ ok | até Pronto (s): 5.6<br>pulou legendas: true<br>pageerrors: 0<br>console.error: 0 | [iphonese-wizard.png](shots/iphonese-wizard.png)<br>[iphonese-pronto.png](shots/iphonese-pronto.png) |  |

### 2. Reprodução sem tela preta

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ❌ falha | pretos play: 0/307<br>pretos cutsPlaying: 0/235<br>pretos cutsPaused: 0/219<br>pretos applyLive: 0/307<br>pretos endOfPlayback: 73/193<br>pretos seekEnd: 72/72<br>held total: 7<br>held play: 0<br>held cutsPlaying: 0<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 5<br>held seekEnd: 0 | [desktop-harness-play.png](shots/desktop-harness-play.png)<br>[desktop-harness-cuts.png](shots/desktop-harness-cuts.png)<br>[desktop-harness-fim.png](shots/desktop-harness-fim.png) | endOfPlayback: 1º preto em +2004ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s \| seekEnd: 1º preto em +0ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s |
| Pixel 7 (escuro) | ❌ falha | pretos play: 0/299<br>pretos cutsPlaying: 0/227<br>pretos cutsPaused: 0/219<br>pretos applyLive: 0/307<br>pretos endOfPlayback: 72/185<br>pretos seekEnd: 72/72<br>held total: 8<br>held play: 0<br>held cutsPlaying: 1<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 5<br>held seekEnd: 0 | [pixel7-harness-play.png](shots/pixel7-harness-play.png)<br>[pixel7-harness-cuts.png](shots/pixel7-harness-cuts.png)<br>[pixel7-harness-fim.png](shots/pixel7-harness-fim.png) | endOfPlayback: 1º preto em +2015ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s \| seekEnd: 1º preto em +0ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s |
| iPhone SE (claro) | ❌ falha | pretos play: 0/311<br>pretos cutsPlaying: 0/235<br>pretos cutsPaused: 0/219<br>pretos applyLive: 0/309<br>pretos endOfPlayback: 73/194<br>pretos seekEnd: 72/72<br>held total: 8<br>held play: 0<br>held cutsPlaying: 1<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 5<br>held seekEnd: 0 | [iphonese-harness-play.png](shots/iphonese-harness-play.png)<br>[iphonese-harness-cuts.png](shots/iphonese-harness-cuts.png)<br>[iphonese-harness-fim.png](shots/iphonese-harness-fim.png) | endOfPlayback: 1º preto em +2003ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s \| seekEnd: 1º preto em +0ms, playheads 5.00s,5.00s,5.00s,5.00s,5.00s |

### 2b. Reprodução no editor (pós-IA)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | amostras: 242<br>pretos: 0<br>held: 0<br>p95 draw (ms): 34.2 | [desktop-editor-play.png](shots/desktop-editor-play.png) |  |
| Pixel 7 (escuro) | ✅ ok | amostras: 243<br>pretos: 0<br>held: 0<br>p95 draw (ms): 33.6 | [pixel7-editor-play.png](shots/pixel7-editor-play.png) |  |
| iPhone SE (claro) | ✅ ok | amostras: 242<br>pretos: 0<br>held: 0<br>p95 draw (ms): 33.5 | [iphonese-editor-play.png](shots/iphonese-editor-play.png) |  |

### 3. Fluidez (play 5 s)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | p95 (ms): 37.5<br>p50 (ms): 33.3<br>maior intervalo (ms): 50<br>draws: 156<br>held: 0 |  | meta p95 ≤ 50 ms |
| Pixel 7 (escuro) | ℹ️ info | p95 (ms): 41<br>p50 (ms): 33.3<br>maior intervalo (ms): 61<br>draws: 154<br>held: 0 |  | meta só p/ desktop (CPU emulada não reflete o aparelho) |
| iPhone SE (claro) | ℹ️ info | p95 (ms): 37.9<br>p50 (ms): 33.3<br>maior intervalo (ms): 57<br>draws: 155<br>held: 0 |  | meta só p/ desktop (CPU emulada não reflete o aparelho) |

### 4. Export

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | qualidade: fhd<br>tempo (s): 31.5<br>duração: 5.02/5.00 s<br>vídeo: h264 1080×1920<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.4<br>webcodecs: true | [desktop-export-mid.png](shots/desktop-export-mid.png)<br>[desktop-export.mp4](shots/desktop-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |
| Pixel 7 (escuro) | ✅ ok | qualidade: hd<br>tempo (s): 28.5<br>duração: 5.02/5.00 s<br>vídeo: h264 720×1280<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.3<br>webcodecs: true | [pixel7-export-mid.png](shots/pixel7-export-mid.png)<br>[pixel7-export.mp4](shots/pixel7-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |
| iPhone SE (claro) | ✅ ok | qualidade: hd<br>tempo (s): 28.4<br>duração: 5.02/5.00 s<br>vídeo: h264 720×1280<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.2<br>webcodecs: true | [iphonese-export-mid.png](shots/iphonese-export-mid.png)<br>[iphonese-export.mp4](shots/iphonese-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |

### 5. Layout (menus + scroll horizontal)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | menus: 6<br>ok: 3<br>falhas: 0<br>sem pop-up: 0<br>scroll horizontal: não |  | pilula-resolucao:n/a, dialogo-exportar:ok, timeline-mais:ok, timeline-trilha:n/a, timeline-velocidade:ok, ia-fab2:n/a |
| Pixel 7 (escuro) | ✅ ok | menus: 21<br>ok: 18<br>falhas: 0<br>sem pop-up: 0<br>scroll horizontal: não |  | pilula-resolucao:ok, dialogo-exportar:ok, timeline-mais:ok, preview-mais:ok, ia-fab2:ok, barra-Editar:nível 2, barra-Áudio:nível 2, barra-Texto:nível 2, barra-Efeitos:ok, barra-Legendas:ok, barra-Filtros:ok, barra-Ajustar:ok, barra-Stickers:ok, barra-Modelos:ok, barra-Gerar com IA:ok, barra-Proporção:ok, barra-Fundo:ok, barra-Transições:ok, barra-Mídia:ok, barra-Revisão:ok, barra-Mais:ok |
| iPhone SE (claro) | ❌ falha | menus: 21<br>ok: 17<br>falhas: 1<br>sem pop-up: 0<br>scroll horizontal: não | [iphonese-menu-preview_mais.png](shots/iphonese-menu-preview_mais.png) | pilula-resolucao:ok, dialogo-exportar:ok, timeline-mais:ok, preview-mais:falha(ep-pv-menu {"l":54,"t":156,"r":327,"b":264} vw320×568), ia-fab2:ok, barra-Editar:nível 2, barra-Áudio:nível 2, barra-Texto:nível 2, barra-Efeitos:ok, barra-Legendas:ok, barra-Filtros:ok, barra-Ajustar:ok, barra-Stickers:ok, barra-Modelos:ok, barra-Gerar com IA:ok, barra-Proporção:ok, barra-Fundo:ok, barra-Transições:ok, barra-Mídia:ok, barra-Revisão:ok, barra-Mais:ok |

### 6. Cursor da IA

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | amostras: 86<br>visível: 29<br>fora da tela: 0<br>balão fora: 0 |  |  |
| Pixel 7 (escuro) | ❌ falha | amostras: 51<br>visível: 28<br>fora da tela: 0<br>balão fora: 19 |  | balão: {"l":-16,"r":216,"t":386,"b":434,"vw":412,"vh":839} |
| iPhone SE (claro) | ❌ falha | amostras: 51<br>visível: 28<br>fora da tela: 0<br>balão fora: 19 |  | balão: {"l":-21,"r":171,"t":259,"b":307,"vw":320,"vh":568} |

### 7. Pop-up da IA

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ❌ falha | variante: chat lateral (desktop)<br>opened: true<br>typed: true<br>sent: true<br>replyMs: 60077<br>cursor: {"polls":601,"seen":16,"out":0,"outs":[],"running":0}<br>edited: false<br>newPronto: false | [desktop-chat-resposta.png](shots/desktop-chat-resposta.png) |  |
| Pixel 7 (escuro) | ✅ ok | opened: true<br>textarea: true<br>typed: true<br>sent: true<br>replyMs: 1528<br>cursor: {"polls":15,"seen":15,"out":0,"outs":[],"running":0}<br>edited: true<br>minimized: true<br>fabOrBadgeBack: true | [pixel7-popup-aberto.png](shots/pixel7-popup-aberto.png)<br>[pixel7-popup-min.png](shots/pixel7-popup-min.png) |  |
| iPhone SE (claro) | ✅ ok | opened: true<br>textarea: true<br>typed: true<br>sent: true<br>replyMs: 1529<br>cursor: {"polls":15,"seen":15,"out":0,"outs":[],"running":0}<br>edited: true<br>minimized: true<br>fabOrBadgeBack: true | [iphonese-popup-aberto.png](shots/iphonese-popup-aberto.png)<br>[iphonese-popup-min.png](shots/iphonese-popup-min.png) |  |

### 8. Mídia 4K H.264

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ❌ falha | até Pronto (s): 9.3<br>pretos: 24/207<br>held: 0<br>menor luminância: 0<br>pageerrors: 0<br>vídeo decodificado: 2160×3840 | [desktop-k4-editor-play.png](shots/desktop-k4-editor-play.png)<br>[desktop-k4-final.png](shots/desktop-k4-final.png) | playheads pretos: +3150ms,+3166ms,+3183ms,+3200ms,+3216ms |

### 8. Mídia HEVC 1080×1920

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ❌ falha | até Pronto (s): 7.9<br>pretos: 7/212<br>held: 0<br>menor luminância: 0<br>pageerrors: 0<br>vídeo decodificado: 0×0 | [desktop-hevc-editor-play.png](shots/desktop-hevc-editor-play.png)<br>[desktop-hevc-final.png](shots/desktop-hevc-final.png) | playheads pretos: +0ms,+17ms,+33ms,+50ms,+67ms |

## Como rodar

```
cd web && npm run build && npm run e2e
# só alguns: node e2e/run.js --profiles=pixel7 --cases=flow,layout
```

Critérios: quadro preto = luminância média < 6 e máxima < 24 (0–255) no canvas `[data-ep-preview]` amostrado a cada rAF; `held` = quadros segurados (`__epPreviewStats.held`); fluidez = intervalos entre *draws* do preview (resolução de 1 rAF); export = `blackdetect` (pix_th 0.10, pic_th 0.98, ≥ 0,03 s), `volumedetect` e duração ±0,25 s.

## Bugs encontrados (rodada 1 — integração `70b8304`)

> QA só documenta: nenhum destes foi corrigido aqui. Arquivo:linha é o ponto provável.

### B1 — Preview fica PRETO ao terminar a reprodução (e ao arrastar a agulha até o fim) · alta
- **Passos:** abrir qualquer projeto → ▶ e deixar tocar até o fim (ou arrastar o playhead até o final da timeline).
- **Esperado:** o último quadro fica na tela. **Obtido:** canvas preto (luminância 0) e fica preto até o usuário mexer no playhead.
- **Evidência:** caso 2, fases `endOfPlayback` e `seekEnd` (harness: 72/72 amostras pretas com `playhead = 5.00 s`, sem fade-out no projeto);
  caso 8 (4K no app real): toca normal e fica preto a partir de +3,15 s = fim do clipe de 3 s. Capturas `*-harness-fim.png`, `desktop-k4-editor-play.png`.
- **Causa provável:** no fim, `tick` faz `st.setPlayhead(d)` + `setPlaying(false)` (`components/preview/Preview.tsx:268-274`); a mudança
  dispara `requestStill()` (`Preview.tsx:~157`) que desenha em `t = d`, e o engine só considera clipes com `t < start + duration`
  (`lib/engine/index.ts:74`, `lib/engine/timing.ts:60`) → nenhum clipe ativo → quadro preto. O `draw(d - 1/fps)` do fim é sobrescrito
  pelo still. Mesmo efeito com `setPlayhead(duração)` pausado. (Sugestão: desenhar o still em `min(playhead, d - 1/fps)`.)
- Provável parte das "telas pretas" relatadas pelo Bruno no Android (vídeo curto → chega ao fim toda hora).

### B2 — Balão do cursor da IA sai pela borda esquerda no celular · média
- **Passos:** celular (Pixel 7 / iPhone SE) → wizard → "Editar com IA" → observar o balão de explicação do cursor.
- **Obtido:** balão com `left = -16 px` (Pixel 7, 412 px) e `-21 px` (iPhone SE, 320 px) em ~19 de 28 amostras; texto cortado.
- **Causa provável:** `components/shell/AiCursor.tsx:144` — `flip` só testa se cabe à direita; ao virar (`right:6px`,
  `styles/shell.css:641`) não testa se cabe à esquerda. Com o cursor no meio de tela estreita, nenhum dos dois lados cabe
  (balão até `min(240px, 62vw)`). Precisa limitar/clampar a posição horizontal do balão.

### B3 — Menu "⋯" do preview cortado à direita no iPhone SE · média
- **Passos:** iPhone SE (320 px) → editor → faixa sob o vídeo → "⋯ Mais opções".
- **Obtido:** `.ep-pv-menu` vai de x=54 a x=327 (viewport 320) — "ou toque longo" cortado. Captura `iphonese-menu-preview_mais.png`.
- **Causa provável:** `styles/preview.css:212` — `left:0` ancorado no botão (que está a ~54 px da borda) + `min-width:260px`;
  o `max-width: calc(100vw - 24px)` não desconta o deslocamento do botão.

### B4 — Vídeo que o navegador não decodifica (HEVC) entra calado e fica preto · média
- **Passos:** wizard com um MP4 HEVC (`hvc1`) num navegador sem HEVC (Chromium do container; Chrome em aparelho sem decodificador HEVC).
- **Obtido:** "Pronto!", clipe na timeline, miniatura e preview pretos; `videoWidth = 0`. Nenhum aviso ao usuário.
- **Causa provável:** `lib/media/ingest.ts:162` aceita `videoWidth = 0` (grava `width: undefined`) sem avisar nem tentar alternativa.
  Vídeos do iPhone costumam ser HEVC. (O proxy de preview — `lib/media/proxy.ts` — ainda não tem `makePreviewProxy` publicado pelo engine,
  então hoje nenhum proxy é gerado para HEVC/4K.)

### Observações (não são falhas)
- Export no Chromium sai com **áudio Opus dentro de MP4** (sem encoder AAC). Toca no Chrome/Android; pode não tocar em players
  do iOS/WhatsApp antigos. Conferir no aparelho real se o Chrome do Android oferece AAC (`AudioEncoder.isConfigSupported`).
- Fluidez no Chromium headless (sem GPU): p95 ≈ 38–43 ms, dentro da meta no desktop. No celular a CPU não é emulada: métrica só informativa.
- Transcrição (Whisper/HF) é pulada nos testes ("Pular legendas"): hosts externos ficam fora do container.

