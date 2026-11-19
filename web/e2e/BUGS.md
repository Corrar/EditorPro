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
