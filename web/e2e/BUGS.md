## Bugs encontrados (rodada 6 — `b145e3e`; anteriores: `d3e295e`, `5c3b0e6`, `48c7e7e`, `71e9ee2`, `70b8304`)

> Rodada 6: **regressão 32/32 ok** nos 3 perfis e **personas 20/20 passos**. B1–B9 corrigidos.
> Desfazer edição antiga: link "Ver as N edições desta conversa (desfazer qualquer uma)" → "Voltar para antes desta edição" (3 botões) funciona;
> ~~B10~~: era erro do teste (escolhia o botão errado pela posição). A P4 agora usa `[data-edit="2"]` (ai @0690788) e exige o estado exato de logo após a 1ª edição — confirmar na próxima rodada.
> Pendentes para a próxima rodada (combinado com a principal): catálogo de músicas (library), fluidez p95 no desktop (50–56 ms nas rodadas anteriores; 32/32 nesta), itens 3/5/6 de usabilidade (shell/ia).

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

### ✅ B2 (corrigido na rodada 5) — Balão do cursor da IA sai pela borda esquerda no celular · média
- **Passos:** celular (Pixel 7 / iPhone SE) → wizard → "Editar com IA" → observar o balão de explicação do cursor.
- **Obtido:** balão com `left = -16 px` (Pixel 7, 412 px) e `-21 px` (iPhone SE, 320 px) em ~19 de 28 amostras; texto cortado.
- **Causa provável:** `components/shell/AiCursor.tsx:144` — `flip` só testa se cabe à direita; ao virar (`right:6px`,
  `styles/shell.css:641`) não testa se cabe à esquerda. Com o cursor no meio de tela estreita, nenhum dos dois lados cabe
  (balão até `min(240px, 62vw)`). Precisa limitar/clampar a posição horizontal do balão. Dono: **shell**.

### ✅ B3 (corrigido na rodada 5) — Menu "⋯" do preview sai da tela · alta (piorou na rodada 3)
- Rodada 3/4: o menu cresceu (Velocidade, Zoom, Repetir, Antes/depois, Grade, Zonas, Mostrar desempenho) e abre para cima sem limite: Pixel 7 top −43 px; iPhone SE top −134 px e direita +7 px; a pílula "IA: N edições feitas" fica por cima. Sem `max-height`/rolagem. Captura `pixel7-menu-preview_mais.png`.
- **Passos:** iPhone SE (320 px) → editor → faixa sob o vídeo → "⋯ Mais opções".
- **Obtido:** `.ep-pv-menu` vai de x=54 a x=327 (viewport 320) — "ou toque longo" cortado. Captura `iphonese-menu-preview_mais.png`.
- **Causa provável:** `styles/preview.css:214` — `left:0` ancorado no botão (que está a ~54 px da borda) + `min-width:260px`;
  o `max-width: calc(100vw - 24px)` não desconta o deslocamento do botão. Dono: **engine** (preview).

### ✅ B4 (corrigido na rodada 5) — Vídeo que o navegador não decodifica (HEVC) entra calado e fica preto · média
- **Passos:** wizard com um MP4 HEVC (`hvc1`) num navegador sem HEVC (Chromium do container; Chrome em aparelho sem decodificador HEVC).
- **Obtido:** "Pronto!", clipe na timeline, miniatura e preview pretos; `videoWidth = 0`. Nenhum aviso ao usuário.
- **Causa provável:** `lib/media/ingest.ts:163` aceita `videoWidth = 0` (grava `width: undefined`) sem avisar nem tentar alternativa.
  Vídeos do iPhone costumam ser HEVC. (O proxy de preview — `lib/media/proxy.ts` — ainda não tem `makePreviewProxy` publicado pelo engine,
  então hoje nenhum proxy é gerado para HEVC/4K.) Rodada 2: o proxy 720p já existe e funciona para o 4K (vídeo decodificado 720×1280),
  mas o HEVC continua 0×0 e 100% preto (o proxy também precisa decodificar). Dono: **shell** (ingestão) / **export** (proxy).

### ✅ B5 (corrigido na rodada 5) — IA demo não entende o imperativo "corte/tire/remova" · alta (rodada 2, usabilidade P4)
- **Passos:** pop-up da IA → "corte os primeiros 2 segundos".
- **Obtido:** resposta com a lista de comandos e nada muda — embora a própria IA sugira "corta os primeiros 2 s".
- **Causa:** `lib/ai/demo.ts:784-785` aceita só `corta|cortar|tira|tirar|remove|remover|apaga|apagar`. Dono: **ai**.

### ✅ B6 (corrigido na rodada 4) — Sem caminho para aplicar transição no celular · alta (rodada 2, usabilidade P1)
- **Passos:** celular → barra "Transições" → gaveta diz "Selecione um clipe"; selecionar o clipe troca a barra para a do clipe (Dividir, Velocidade, Volume, Animações…), que não tem "Transições".
- **Causa provável:** `components/shell/MobileToolbar.tsx:135-170` (itens do clipe sem `transitions`); timeline sem botão entre clipes. Dono: **shell** (+ **timeline**).

### ✅ B7 (corrigido na rodada 4) — Mudar "Escala" com keyframes não cria/atualiza keyframe · alta (rodada 2, usabilidade P2)
- **Passos:** desktop → selecionar clipe → K em 2 s → cursor em 3 s → Editar › Posição › Escala.
- **Obtido:** continua 1 keyframe; o slider muda o transform base (sobreposto pelos keyframes): zoom animado só pelo "Zoom punch-in aqui".
- **Causa provável:** `components/panels/ClipSections.tsx:406` (`setTf` → `patch({ transform })`). Dono: **shell** (painéis).

### ✅ B8 (corrigido na rodada 5) — "Gerar legendas com IA" (gaveta Legendas) pergunta num pop-up que não abre · alta (rodada 2, usabilidade P3)
- **Passos:** celular → Legendas → "Gerar legendas com IA".
- **Obtido:** a gaveta continua na frente; só aparece a pílula "IA aguardando você" (a pergunta "Transcrever (~41 MB)?" está no pop-up fechado).
- **Arquivo provável:** `components/panels/CaptionsTab.tsx` (emite generate-captions) / `components/shell/AiPopupHost.tsx`. Dono: **shell**.

### ✅ B9 (corrigido na rodada 6) — Desktop: "Importar" no editor vazio não põe as mídias na timeline · média (rodada 4)
- **Passos:** desktop → Começar → Abrir editor vazio → Importar → escolher 2 vídeos.
- **Obtido:** cards "Pronto para editar" na biblioteca; timeline vazia 25 s depois. É preciso passar o mouse em cada card e achar o "+" (title "Adicionar no fim da timeline").
- **Arquivo provável:** `components/media/MediaBin.tsx` (importFiles) / `lib/media/ingest.ts`. Dono: **shell**. (No celular o seletor "Adicionar mídia" já coloca na timeline.)

### Observações (não são falhas)
- Export no Chromium sai com **áudio Opus dentro de MP4** (sem encoder AAC). Toca no Chrome/Android; pode não tocar em players
  do iOS/WhatsApp antigos. Conferir no aparelho real se o Chrome do Android oferece AAC (`AudioEncoder.isConfigSupported`).
- Fluidez no Chromium headless (sem GPU): p95 ≈ 38–43 ms, dentro da meta no desktop. No celular a CPU não é emulada: métrica só informativa.
- A suíte de regressão pula a transcrição ("Pular legendas") para ser rápida; a de usabilidade aceita transcrever e o Whisper funciona no container (vídeos de teste sem fala → "Não encontrei fala").
- Detalhes de usabilidade (tempo, toques, alvos < 44 px, fricções por dono): `USABILIDADE.md`.
