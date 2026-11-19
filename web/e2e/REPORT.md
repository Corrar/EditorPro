# Relatório E2E — EditorPro

- Commit: `a74fa55` · 2026-11-19T10:45:45.392Z
- Alvo: http://localhost:3100 (`next start`, modo demo da IA)
- Navegador: Chromium 157.0.8103.78 (headless, sem GPU)
- Perfis: Desktop 1440×900 · Pixel 7 (escuro) · iPhone SE (claro)
- Duração da rodada: 314 s

## Resumo

| Caso | Desktop 1440×900 | Pixel 7 (escuro) | iPhone SE (claro) |
|---|---|---|---|
| 1. Fluxo principal | ✅ ok | ✅ ok | ✅ ok |
| 2. Reprodução sem tela preta | ✅ ok | ✅ ok | ✅ ok |
| 2b. Reprodução no editor (pós-IA) | ✅ ok | ✅ ok | ✅ ok |
| 3. Fluidez (play 5 s) | ✅ ok | ℹ️ info | ℹ️ info |
| 4. Export | ✅ ok | ✅ ok | ✅ ok |
| 5. Layout (menus + scroll horizontal) | ✅ ok | ❌ falha | ❌ falha |
| 6. Cursor da IA | ✅ ok | ❌ falha | ❌ falha |
| 7. Pop-up da IA | ✅ ok | ✅ ok | ✅ ok |
| 8. Mídia 4K H.264 | ✅ ok | · | · |
| 8. Mídia HEVC 1080×1920 | ❌ falha | · | · |
| 9. FX: efeito 'snow' + transição 'cube-left' | ✅ ok | ✅ ok | ✅ ok |
| 10. COR: colorGrade gain R −0,4 | ✅ ok | ✅ ok | ✅ ok |

## Detalhes

### 1. Fluxo principal

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | até Pronto (s): 10.8<br>pulou legendas: false<br>pageerrors: 0<br>console.error: 0 | [desktop-wizard.png](shots/desktop-wizard.png)<br>[desktop-pronto.png](shots/desktop-pronto.png) |  |
| Pixel 7 (escuro) | ✅ ok | até Pronto (s): 7.1<br>pulou legendas: true<br>pageerrors: 0<br>console.error: 0 | [pixel7-wizard.png](shots/pixel7-wizard.png)<br>[pixel7-pronto.png](shots/pixel7-pronto.png) |  |
| iPhone SE (claro) | ✅ ok | até Pronto (s): 6.8<br>pulou legendas: true<br>pageerrors: 0<br>console.error: 0 | [iphonese-wizard.png](shots/iphonese-wizard.png)<br>[iphonese-pronto.png](shots/iphonese-pronto.png) |  |

### 2. Reprodução sem tela preta

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | pretos play: 0/260<br>pretos cutsPlaying: 0/195<br>pretos cutsPaused: 0/219<br>pretos applyLive: 0/281<br>pretos endOfPlayback: 0/172<br>pretos seekEnd: 0/72<br>held total: 7<br>held play: 0<br>held cutsPlaying: 0<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 5<br>held seekEnd: 0 | [desktop-harness-play.png](shots/desktop-harness-play.png)<br>[desktop-harness-cuts.png](shots/desktop-harness-cuts.png)<br>[desktop-harness-fim.png](shots/desktop-harness-fim.png) |  |
| Pixel 7 (escuro) | ✅ ok | pretos play: 0/256<br>pretos cutsPlaying: 0/193<br>pretos cutsPaused: 0/217<br>pretos applyLive: 0/291<br>pretos endOfPlayback: 0/180<br>pretos seekEnd: 0/72<br>held total: 8<br>held play: 0<br>held cutsPlaying: 0<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 6<br>held seekEnd: 0 | [pixel7-harness-play.png](shots/pixel7-harness-play.png)<br>[pixel7-harness-cuts.png](shots/pixel7-harness-cuts.png)<br>[pixel7-harness-fim.png](shots/pixel7-harness-fim.png) |  |
| iPhone SE (claro) | ✅ ok | pretos play: 0/260<br>pretos cutsPlaying: 0/202<br>pretos cutsPaused: 0/218<br>pretos applyLive: 0/301<br>pretos endOfPlayback: 0/178<br>pretos seekEnd: 0/72<br>held total: 12<br>held play: 0<br>held cutsPlaying: 5<br>held cutsPaused: 0<br>held applyLive: 2<br>held endOfPlayback: 5<br>held seekEnd: 0 | [iphonese-harness-play.png](shots/iphonese-harness-play.png)<br>[iphonese-harness-cuts.png](shots/iphonese-harness-cuts.png)<br>[iphonese-harness-fim.png](shots/iphonese-harness-fim.png) |  |

### 2b. Reprodução no editor (pós-IA)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | amostras: 242<br>pretos: 0<br>held: 0<br>p95 draw (ms): 33.5 | [desktop-editor-play.png](shots/desktop-editor-play.png) |  |
| Pixel 7 (escuro) | ✅ ok | amostras: 242<br>pretos: 0<br>held: 0<br>p95 draw (ms): 33.5 | [pixel7-editor-play.png](shots/pixel7-editor-play.png) |  |
| iPhone SE (claro) | ✅ ok | amostras: 242<br>pretos: 0<br>held: 0<br>p95 draw (ms): 33.5 | [iphonese-editor-play.png](shots/iphonese-editor-play.png) |  |

### 3. Fluidez (play 5 s)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | p95 (ms): 50<br>p50 (ms): 33.4<br>maior intervalo (ms): 134<br>draws: 146<br>held: 0 |  | meta p95 ≤ 50 ms |
| Pixel 7 (escuro) | ℹ️ info | p95 (ms): 56.2<br>p50 (ms): 33.4<br>maior intervalo (ms): 67<br>draws: 150<br>held: 0 |  | meta só p/ desktop (CPU emulada não reflete o aparelho) |
| iPhone SE (claro) | ℹ️ info | p95 (ms): 50.1<br>p50 (ms): 33.3<br>maior intervalo (ms): 125<br>draws: 145<br>held: 0 |  | meta só p/ desktop (CPU emulada não reflete o aparelho) |

### 4. Export

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | qualidade: fhd<br>tempo (s): 8.5<br>duração: 5.02/5.00 s<br>vídeo: h264 1080×1920<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.4<br>webcodecs: true | [desktop-export-mid.png](shots/desktop-export-mid.png)<br>[desktop-export.mp4](shots/desktop-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |
| Pixel 7 (escuro) | ✅ ok | qualidade: hd<br>tempo (s): 4.6<br>duração: 5.02/5.00 s<br>vídeo: h264 720×1280<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.3<br>webcodecs: true | [pixel7-export-mid.png](shots/pixel7-export-mid.png)<br>[pixel7-export.mp4](shots/pixel7-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |
| iPhone SE (claro) | ✅ ok | qualidade: hd<br>tempo (s): 4.8<br>duração: 5.02/5.00 s<br>vídeo: h264 720×1280<br>áudio: opus -21.1 dB<br>preto (s): 0<br>quadros escuros (Y<20): 0<br>Y mín: 111.2<br>webcodecs: true | [iphonese-export-mid.png](shots/iphonese-export-mid.png)<br>[iphonese-export.mp4](shots/iphonese-export.mp4) | obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade |

### 5. Layout (menus + scroll horizontal)

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | menus: 6<br>ok: 3<br>falhas: 0<br>sem pop-up: 0<br>scroll horizontal: não |  | pilula-resolucao:n/a, dialogo-exportar:ok, timeline-mais:ok, timeline-trilha:n/a, timeline-velocidade:ok, ia-fab2:n/a |
| Pixel 7 (escuro) | ❌ falha | menus: 22<br>ok: 18<br>falhas: 1<br>sem pop-up: 0<br>scroll horizontal: não | [pixel7-menu-preview_mais.png](shots/pixel7-menu-preview_mais.png) | pilula-resolucao:ok, dialogo-exportar:ok, timeline-mais:ok, preview-mais:falha(ep-pv-menu {"l":54,"t":-43,"r":327,"b":441} vw412×839), ia-fab2:ok, barra-Editar:nível 2, barra-Áudio:nível 2, barra-Texto:nível 2, barra-Efeitos:ok, barra-Legendas:ok, barra-Filtros:ok, barra-Ajustar:ok, barra-Cor:ok, barra-Stickers:ok, barra-Modelos:ok, barra-Gerar com IA:ok, barra-Proporção:ok, barra-Fundo:ok, barra-Transições:ok, barra-Mídia:ok, barra-Revisão:ok, barra-Mais:ok |
| iPhone SE (claro) | ❌ falha | menus: 22<br>ok: 18<br>falhas: 1<br>sem pop-up: 0<br>scroll horizontal: não | [iphonese-menu-preview_mais.png](shots/iphonese-menu-preview_mais.png) | pilula-resolucao:ok, dialogo-exportar:ok, timeline-mais:ok, preview-mais:falha(ep-pv-menu {"l":54,"t":-134,"r":327,"b":264} vw320×568), ia-fab2:ok, barra-Editar:nível 2, barra-Áudio:nível 2, barra-Texto:nível 2, barra-Efeitos:ok, barra-Legendas:ok, barra-Filtros:ok, barra-Ajustar:ok, barra-Cor:ok, barra-Stickers:ok, barra-Modelos:ok, barra-Gerar com IA:ok, barra-Proporção:ok, barra-Fundo:ok, barra-Transições:ok, barra-Mídia:ok, barra-Revisão:ok, barra-Mais:ok |

### 6. Cursor da IA

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | amostras: 101<br>visível: 30<br>fora da tela: 0<br>balão fora: 0 |  |  |
| Pixel 7 (escuro) | ❌ falha | amostras: 68<br>visível: 31<br>fora da tela: 0<br>balão fora: 22 |  | balão: {"l":-16,"r":216,"t":386,"b":434,"vw":412,"vh":839} |
| iPhone SE (claro) | ❌ falha | amostras: 64<br>visível: 27<br>fora da tela: 0<br>balão fora: 18 |  | balão: {"l":-22,"r":171,"t":258,"b":307,"vw":320,"vh":568} |

### 7. Pop-up da IA

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | variante: chat lateral (desktop)<br>opened: true<br>typed: true<br>sent: true<br>replyMs: 1213<br>cursor: {"polls":12,"seen":12,"out":0,"outs":[],"running":0}<br>edited: true<br>newPronto: false | [desktop-chat-resposta.png](shots/desktop-chat-resposta.png) |  |
| Pixel 7 (escuro) | ✅ ok | opened: true<br>textarea: true<br>typed: true<br>sent: true<br>replyMs: 1528<br>cursor: {"polls":15,"seen":15,"out":0,"outs":[],"running":0}<br>edited: true<br>minimized: true<br>fabOrBadgeBack: true | [pixel7-popup-aberto.png](shots/pixel7-popup-aberto.png)<br>[pixel7-popup-min.png](shots/pixel7-popup-min.png) |  |
| iPhone SE (claro) | ✅ ok | opened: true<br>textarea: true<br>typed: true<br>sent: true<br>replyMs: 1529<br>cursor: {"polls":15,"seen":15,"out":0,"outs":[],"running":0}<br>edited: true<br>minimized: true<br>fabOrBadgeBack: true | [iphonese-popup-aberto.png](shots/iphonese-popup-aberto.png)<br>[iphonese-popup-min.png](shots/iphonese-popup-min.png) |  |

### 8. Mídia 4K H.264

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | até Pronto (s): 11.4<br>pretos: 0/212<br>held: 0<br>menor luminância: 125.7<br>pageerrors: 0<br>vídeo decodificado: 720×1280 | [desktop-k4-editor-play.png](shots/desktop-k4-editor-play.png)<br>[desktop-k4-final.png](shots/desktop-k4-final.png) |  |

### 8. Mídia HEVC 1080×1920

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ❌ falha | até Pronto (s): 8.1<br>pretos: 212/212<br>held: 105<br>menor luminância: 0<br>pageerrors: 0<br>vídeo decodificado: 0×0 | [desktop-hevc-editor-play.png](shots/desktop-hevc-editor-play.png)<br>[desktop-hevc-final.png](shots/desktop-hevc-final.png) | playheads pretos: +0ms,+16ms,+33ms,+50ms,+66ms |

### 9. FX: efeito 'snow' + transição 'cube-left'

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | pixels mudados pelo efeito (%): 2<br>pretos pausado na transição: 0/3<br>pretos tocando: 0/85<br>modo do preview: canvas<br>export: preto 0 s, escuros 0<br>pageerrors: 0 | [desktop-fx-snow.png](shots/desktop-fx-snow.png)<br>[desktop-fx-cube.png](shots/desktop-fx-cube.png) |  |
| Pixel 7 (escuro) | ✅ ok | pixels mudados pelo efeito (%): 1.7<br>pretos pausado na transição: 0/3<br>pretos tocando: 0/90<br>modo do preview: canvas<br>export: preto 0 s, escuros 0<br>pageerrors: 0 | [pixel7-fx-snow.png](shots/pixel7-fx-snow.png)<br>[pixel7-fx-cube.png](shots/pixel7-fx-cube.png) |  |
| iPhone SE (claro) | ✅ ok | pixels mudados pelo efeito (%): 4<br>pretos pausado na transição: 0/3<br>pretos tocando: 0/93<br>modo do preview: canvas<br>export: preto 0 s, escuros 0<br>pageerrors: 0 | [iphonese-fx-snow.png](shots/iphonese-fx-snow.png)<br>[iphonese-fx-cube.png](shots/iphonese-fx-cube.png) |  |

### 10. COR: colorGrade gain R −0,4

| Perfil | Resultado | Métricas | Capturas | Observações |
|---|---|---|---|---|
| Desktop 1440×900 | ✅ ok | queda R preview: 48.7<br>queda G preview: -0.2<br>queda R export: 47.1<br>queda G export: -0.1<br>preview R/G/B: 77.4/129.5/125.1<br>export R/G/B: 80.7/130.9/126.6 | [desktop-cor-gainR.png](shots/desktop-cor-gainR.png) |  |
| Pixel 7 (escuro) | ✅ ok | queda R preview: 48.8<br>queda G preview: 0.1<br>queda R export: 47<br>queda G export: -0.1<br>preview R/G/B: 78.6/130/124.9<br>export R/G/B: 80.8/130.9/126.5 | [pixel7-cor-gainR.png](shots/pixel7-cor-gainR.png) |  |
| iPhone SE (claro) | ✅ ok | queda R preview: 47.8<br>queda G preview: 0<br>queda R export: 47<br>queda G export: -0.1<br>preview R/G/B: 77.9/130.3/123.9<br>export R/G/B: 80.8/130.9/126.5 | [iphonese-cor-gainR.png](shots/iphonese-cor-gainR.png) |  |

## Como rodar

```
cd web && npm run build && npm run e2e
# só alguns: node e2e/run.js --profiles=pixel7 --cases=flow,layout
```

Critérios: quadro preto = luminância média < 6 e máxima < 24 (0–255) no canvas `[data-ep-preview]` amostrado a cada rAF; `held` = quadros segurados (`__epPreviewStats.held`); fluidez = intervalos entre *draws* do preview (resolução de 1 rAF); export = `blackdetect` (pix_th 0.10, pic_th 0.98, ≥ 0,03 s), `volumedetect` e duração ±0,25 s.

## Bugs encontrados (rodada 3 — `48c7e7e`, inclui `0df4eca`; rodada 2 em `71e9ee2`; rodada 1 em `70b8304`)

> Rodada 3: **B1 corrigido** (0 quadros pretos no fim/seek no fim) e 4K passou. **B3 piorou**: o menu ⋯ do preview cresceu e agora sai pelo TOPO no Pixel 7 (top −43 px) e no iPhone SE (top −134 px, direita +7 px); a pílula "IA: N edições feitas" fica por cima do menu. B2, B4 seguem. B5–B8 não foram reverificados (usabilidade fica para a próxima rodada).

> Rodada 2: preview híbrido (`<video>` nativo + canvas transparente). A medição de tela preta compõe os `<video>` visíveis + canvas e confere com captura real da área `.ep-pv-frame`. B1–B4 continuam. Export ficou ~4× mais rápido (31 s → 8 s a 1080p).

> QA só documenta: nenhum destes foi corrigido aqui. Arquivo:linha é o ponto provável.

### ✅ B1 (corrigido na rodada 3) — Preview fica PRETO ao terminar a reprodução (e ao arrastar a agulha até o fim) · alta
- **Passos:** abrir qualquer projeto → ▶ e deixar tocar até o fim (ou arrastar o playhead até o final da timeline).
- **Esperado:** o último quadro fica na tela. **Obtido:** canvas preto (luminância 0) e fica preto até o usuário mexer no playhead.
- **Evidência:** caso 2, fases `endOfPlayback` e `seekEnd` (harness: 72/72 amostras pretas com `playhead = 5.00 s`, sem fade-out no projeto);
  caso 8 (4K no app real): toca normal e fica preto a partir de +3,15 s = fim do clipe de 3 s. Capturas `*-harness-fim.png`, `desktop-k4-editor-play.png`.
- **Causa provável:** no fim, `tick` faz `st.setPlayhead(d)` + `setPlaying(false)` (`components/preview/Preview.tsx:294-299` na rodada 2); a mudança
  dispara `requestStill()` (`Preview.tsx:178`) que desenha em `t = d`, e o engine só considera clipes com `t < start + duration`
  (`lib/engine/index.ts:74`, `lib/engine/timing.ts:60`) → nenhum clipe ativo → quadro preto. O `draw(d - 1/fps)` do fim é sobrescrito
  pelo still. Mesmo efeito com `setPlayhead(duração)` pausado. (Sugestão: desenhar o still em `min(playhead, d - 1/fps)`.)
- Provável parte das "telas pretas" relatadas pelo Bruno no Android (vídeo curto → chega ao fim toda hora).
- Rodada 2: confirmado também por captura real da área do preview (luminância 0 com `playhead = 5.00`, modo `canvas`). Dono: **engine**.

### B2 — Balão do cursor da IA sai pela borda esquerda no celular · média
- **Passos:** celular (Pixel 7 / iPhone SE) → wizard → "Editar com IA" → observar o balão de explicação do cursor.
- **Obtido:** balão com `left = -16 px` (Pixel 7, 412 px) e `-21 px` (iPhone SE, 320 px) em ~19 de 28 amostras; texto cortado.
- **Causa provável:** `components/shell/AiCursor.tsx:144` — `flip` só testa se cabe à direita; ao virar (`right:6px`,
  `styles/shell.css:641`) não testa se cabe à esquerda. Com o cursor no meio de tela estreita, nenhum dos dois lados cabe
  (balão até `min(240px, 62vw)`). Precisa limitar/clampar a posição horizontal do balão. Dono: **shell**.

### B3 — Menu "⋯" do preview cortado à direita no iPhone SE · média
- **Passos:** iPhone SE (320 px) → editor → faixa sob o vídeo → "⋯ Mais opções".
- **Obtido:** `.ep-pv-menu` vai de x=54 a x=327 (viewport 320) — "ou toque longo" cortado. Captura `iphonese-menu-preview_mais.png`.
- **Causa provável:** `styles/preview.css:214` — `left:0` ancorado no botão (que está a ~54 px da borda) + `min-width:260px`;
  o `max-width: calc(100vw - 24px)` não desconta o deslocamento do botão. Dono: **engine** (preview).

### B4 — Vídeo que o navegador não decodifica (HEVC) entra calado e fica preto · média
- **Passos:** wizard com um MP4 HEVC (`hvc1`) num navegador sem HEVC (Chromium do container; Chrome em aparelho sem decodificador HEVC).
- **Obtido:** "Pronto!", clipe na timeline, miniatura e preview pretos; `videoWidth = 0`. Nenhum aviso ao usuário.
- **Causa provável:** `lib/media/ingest.ts:163` aceita `videoWidth = 0` (grava `width: undefined`) sem avisar nem tentar alternativa.
  Vídeos do iPhone costumam ser HEVC. (O proxy de preview — `lib/media/proxy.ts` — ainda não tem `makePreviewProxy` publicado pelo engine,
  então hoje nenhum proxy é gerado para HEVC/4K.) Rodada 2: o proxy 720p já existe e funciona para o 4K (vídeo decodificado 720×1280),
  mas o HEVC continua 0×0 e 100% preto (o proxy também precisa decodificar). Dono: **shell** (ingestão) / **export** (proxy).

### B5 — IA demo não entende o imperativo "corte/tire/remova" · alta (rodada 2, usabilidade P4)
- **Passos:** pop-up da IA → "corte os primeiros 2 segundos".
- **Obtido:** resposta com a lista de comandos e nada muda — embora a própria IA sugira "corta os primeiros 2 s".
- **Causa:** `lib/ai/demo.ts:784-785` aceita só `corta|cortar|tira|tirar|remove|remover|apaga|apagar`. Dono: **ai**.

### B6 — Sem caminho para aplicar transição no celular · alta (rodada 2, usabilidade P1)
- **Passos:** celular → barra "Transições" → gaveta diz "Selecione um clipe"; selecionar o clipe troca a barra para a do clipe (Dividir, Velocidade, Volume, Animações…), que não tem "Transições".
- **Causa provável:** `components/shell/MobileToolbar.tsx:135-170` (itens do clipe sem `transitions`); timeline sem botão entre clipes. Dono: **shell** (+ **timeline**).

### B7 — Mudar "Escala" com keyframes não cria/atualiza keyframe · alta (rodada 2, usabilidade P2)
- **Passos:** desktop → selecionar clipe → K em 2 s → cursor em 3 s → Editar › Posição › Escala.
- **Obtido:** continua 1 keyframe; o slider muda o transform base (sobreposto pelos keyframes): zoom animado só pelo "Zoom punch-in aqui".
- **Causa provável:** `components/panels/ClipSections.tsx:406` (`setTf` → `patch({ transform })`). Dono: **shell** (painéis).

### B8 — "Gerar legendas com IA" (gaveta Legendas) pergunta num pop-up que não abre · alta (rodada 2, usabilidade P3)
- **Passos:** celular → Legendas → "Gerar legendas com IA".
- **Obtido:** a gaveta continua na frente; só aparece a pílula "IA aguardando você" (a pergunta "Transcrever (~41 MB)?" está no pop-up fechado).
- **Arquivo provável:** `components/panels/CaptionsTab.tsx` (emite generate-captions) / `components/shell/AiPopupHost.tsx`. Dono: **shell**.

### Observações (não são falhas)
- Export no Chromium sai com **áudio Opus dentro de MP4** (sem encoder AAC). Toca no Chrome/Android; pode não tocar em players
  do iOS/WhatsApp antigos. Conferir no aparelho real se o Chrome do Android oferece AAC (`AudioEncoder.isConfigSupported`).
- Fluidez no Chromium headless (sem GPU): p95 ≈ 38–43 ms, dentro da meta no desktop. No celular a CPU não é emulada: métrica só informativa.
- A suíte de regressão pula a transcrição ("Pular legendas") para ser rápida; a de usabilidade aceita transcrever e o Whisper funciona no container (vídeos de teste sem fala → "Não encontrei fala").
- Detalhes de usabilidade (tempo, toques, alvos < 44 px, fricções por dono): `USABILIDADE.md`.

