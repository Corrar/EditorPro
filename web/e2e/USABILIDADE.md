# Usabilidade por persona — EditorPro

- Commit: `a66f491` · 2026-11-19T11:07:07.547Z
- Ambiente: Chromium headless, IA em modo demo, sem acesso a huggingface/jsdelivr (transcrição indisponível).
- Métricas: tempo total, toques/cliques (inclui seleção de arquivo e digitação como 1 toque), teclas, passos concluídos, alvos < 44 px (só celular) e botões sem nome.

## Resumo

| Persona | Perfil | Passos ok | Tempo | Toques | Teclas | Alvos < 44 px | Fricções |
|---|---|---|---|---|---|---|---|
| Criadora iniciante (Pixel 7): Reels de 15 s com legenda, música e 1 transição | Pixel 7 (escuro) | 6/6 | 46 s | 22 | 0 | 17 | 7 |
| Editor de desktop com teclado: 5 cortes, volume, keyframe de zoom e exportar | Desktop 1440×900 | 5/5 | 34 s | 17 | 57 | 0 | 2 |
| Só quer legendas (iPhone SE): importar, gerar legenda, trocar estilo e exportar | iPhone SE (claro) | 4/4 | 24 s | 14 | 0 | 15 | 4 |
| Usa a IA (Pixel 7): 3 pedidos no pop-up e desfazer um | Pixel 7 (escuro) | 5/5 | 28 s | 14 | 0 | 10 | 5 |

## Fricções priorizadas

| # | Sev. | Dono | Persona | Passo | Tipo | Descrição | Arquivo provável | Captura |
|---|---|---|---|---|---|---|---|---|
| 1 | alta | **library** | P1 | Adicionar música | beco | "Músicas" não tem catálogo: só "Importar música"/"Gravar narração" e "Nenhum áudio ainda". Iniciante sem arquivo de música fica sem saída. | components/panels (painel Áudio) / lib/library (sons) | [img](shots/ux1-4-Adicionar_m_sica_udio_M_sicas_.png) |
| 2 | média | **ai** | P1 | Conferir o que a IA fez | fluxo | Pedido citou "música animada", mas a IA (demo) não colocou música e não avisou que não há música disponível. | lib/ai/demo.ts | [img](shots/ux1-4-Adicionar_m_sica_udio_M_sicas_.png) |
| 3 | média | **ai** | P4 | Desfazer | fluxo | O pop-up mostra só a última resposta (1 botão "Desfazer"): para desfazer uma edição anterior específica é preciso abrir a conversa completa. | components/chat/AiPopup.tsx | [img](shots/ux4-5-Desfazer_a_2_edi_o_Desfazer_es.png) |
| 4 | média | **ai** | P4 | Desfazer | beco | Nem na conversa completa há "Desfazer" para edições anteriores (1 botão): só a última pode ser desfeita. | components/chat/ChatPanel.tsx | [img](shots/ux4-5-Desfazer_a_2_edi_o_Desfazer_es.png) |
| 5 | média | **library** | P3 | vários | alvo | 7 alvo(s) de toque < 44 px: Nenhuma (91×40), TikTok (69×40), Reels (63×40), Shorts (71×40), YouTube (85×40), Palavras-chave (130×40), Emoji (64×40) | lib/library/** |  |
| 6 | média | **shell** | P1 | Adicionar música | fluxo | Música importada não foi para a timeline (ficou só na lista de áudios). | components/panels (Áudio) / lib/media/place.ts | [img](shots/ux1-4-Adicionar_m_sica_udio_M_sicas_.png) |
| 7 | média | **shell** | P1 | Transição | beco | "Transições" abre vazio com "Selecione um clipe" — não há como escolher o corte ali; o usuário precisa fechar a gaveta, achar o 2º clipe na timeline e reabrir. | components/panels (Inspector transições) / components/shell/MobileToolbar.tsx | [img](shots/ux1-5-Transi_o_entre_os_clipes_Trans.png) |
| 8 | média | **shell** | P2 | Importar | fluxo | Desktop, editor vazio: "Importar" só coloca as mídias na biblioteca (25 s depois, timeline ainda vazia); é preciso achar o "+" que só aparece no hover do card (title "Adicionar no fim da timeline") para cada mídia. No celular o seletor "Adicionar mídia" já põe na timeline. | components/media/MediaBin.tsx:93 | [img](shots/ux2-1-Abrir_editor_vazio_e_importar.png) |
| 9 | média | **shell** | P1 | vários | alvo | 16 alvo(s) de toque < 44 px: Remover h264_1080x1920.mp4 (22×22), Resolução de exportação: 1080p, 30 fps (88×40), Exportar (93×38), Fechar (36×36), Pedir à IA para este clipe (52×28), Músicas e voz (102×27), Efeitos sonoros (114×27), ▾Gravar narração (128×40)… | components/{shell,media,panels}/** |  |
| 10 | baixa | **ai** | P3 | Gerar legendas | fluxo | Vídeo sem fala: a IA responde "Não encontrei fala para legendar neste vídeo." e para — não oferece criar legendas manualmente/digitar o texto. | lib/ai/pipeline.ts (resposta sem fala) | [img](shots/ux3-2-Gerar_legendas_Legendas_Gerar_.png) |
| 11 | baixa | **ai** | P4 | vários | alvo | 4 alvo(s) de toque < 44 px: Ver as 2 edições desta conversa (desfaze (342×36), Ver as 3 edições desta conversa (desfaze (343×36), Ver as 4 edições desta conversa (desfaze (343×36), Transcrição no aparelho (38×34) | app/api/**, lib/ai/**, components/chat/** |  |
| 12 | baixa | **shell** | P1 | Exportar | rótulo | O diálogo abre em 1080p (padrão da pílula) mas avisa "No celular, 1080p/4K podem ficar sem memória. Recomendado: HD 720p" — padrão contradiz a recomendação. | components/shell/exportPref.ts:17 (padrão fhd) / components/preview/ExportDialog.tsx | [img](shots/ux1-6-Exportar.png) |
| 13 | baixa | **shell** | P3 | vários | alvo | 4 alvo(s) de toque < 44 px: Resolução de exportação: 1080p, 30 fps (88×40), Exportar (93×38), Fechar (14×23), Fechar (36×36) | components/{shell,media,panels}/** |  |
| 14 | baixa | **shell** | P4 | vários | alvo | 3 alvo(s) de toque < 44 px: Resolução de exportação: 1080p, 30 fps (88×40), Exportar (93×38), Fechar (36×36) | components/{shell,media,panels}/** |  |
| 15 | baixa | **timeline** | P2 | Cortar 5 trechos | fluxo | Não há atalho para selecionar o clipe sob o cursor (ex.: D/Enter) nem para "excluir trecho entre marcas": cada corte exige 1 clique do mouse. | components/timeline/useShortcuts.ts | [img](shots/ux2-2-Cortar_5_trechos_s_com_teclado.png) |
| 16 | baixa | **timeline** | P1 | vários | alvo | 1 alvo(s) de toque < 44 px: Mais opções da timeline (30×30) | components/timeline/** |  |
| 17 | baixa | **timeline** | P3 | vários | alvo | 4 alvo(s) de toque < 44 px: Mais opções da timeline (30×30), + Adicionar legendas (182×22), + Adicionar texto (157×26), + Adicionar áudio (159×32) | components/timeline/** |  |
| 18 | baixa | **timeline** | P4 | vários | alvo | 3 alvo(s) de toque < 44 px: Mais opções da timeline (30×30), + Adicionar texto (157×30), + Adicionar áudio (159×34) | components/timeline/** |  |

## Por dono

- **library**: #1, #5
- **ai**: #2, #3, #4, #10, #11
- **shell**: #6, #7, #8, #9, #12, #13, #14
- **timeline**: #15, #16, #17, #18

## Passo a passo

### P1 — Criadora iniciante (Pixel 7): Reels de 15 s com legenda, música e 1 transição

| Passo | Resultado | Tempo | Toques | Nota | Captura |
|---|---|---|---|---|---|
| Começar + descrever + anexar 2 vídeos | ✅ | 0.7 s | 3 |  | [img](shots/ux1-1-Come_ar_descrever_anexar_2_v_d.png) |
| Editar com IA (aceita transcrever) | ✅ | 14.0 s | 2 | 13.6 s | [img](shots/ux1-2-Editar_com_IA_aceita_transcrev.png) |
| Conferir o que a IA fez | ✅ | 0.0 s | 0 | {"dur":"16.0","legendas":7,"música":0,"transições":1} | [img](shots/ux1-3-Conferir_o_que_a_IA_fez.png) |
| Adicionar música (Áudio → Músicas) | ✅ | 6.8 s | 4 | faixas de áudio: 1 | [img](shots/ux1-4-Adicionar_m_sica_udio_M_sicas_.png) |
| Transição entre os clipes (Transições) | ✅ | 9.5 s | 6 | transições: fade | [img](shots/ux1-5-Transi_o_entre_os_clipes_Trans.png) |
| Exportar | ✅ | 9.8 s | 2 | 8.9 s · pronto | [img](shots/ux1-6-Exportar.png) |

Alvos < 44 px: `Remover h264_1080x1920.mp4` 22×22 · `Resolução de exportação: 1080p, 30 fps` 88×40 · `Exportar` 93×38 · `Mais opções da timeline` 30×30 · `Fechar` 36×36 · `Pedir à IA para este clipe` 52×28 · `Músicas e voz` 102×27 · `Efeitos sonoros` 114×27 · `▾Gravar narração` 128×40 · `▾Volume` 71×40 · `Redefinir Volume` 36×36 · `Volume: 100%. Toque para digitar` 30×32 · `Volume` 380×28 · `Fade de entrada: 0.0s. Toque para digita` 30×32 · `Fade de entrada` 380×28 · `▾Transição de entrada` 160×40 · `Fechar` 14×23

### P2 — Editor de desktop com teclado: 5 cortes, volume, keyframe de zoom e exportar

| Passo | Resultado | Tempo | Toques | Nota | Captura |
|---|---|---|---|---|---|
| Abrir editor vazio e importar | ✅ | 17.3 s | 5 | clipes: 2, duração 16.0 s | [img](shots/ux2-1-Abrir_editor_vazio_e_importar.png) |
| Cortar 5 trechos só com teclado (S, setas, Shift+Delete) | ✅ | 3.8 s | 6 | duração 16.0 → 11.0 s | [img](shots/ux2-2-Cortar_5_trechos_s_com_teclado.png) |
| Ajustar volume do clipe | ✅ | 2.2 s | 2 | volume 0.95 | [img](shots/ux2-3-Ajustar_volume_do_clipe.png) |
| Keyframe de zoom (K + escala) | ✅ | 2.9 s | 2 | keyframes: 2 | [img](shots/ux2-4-Keyframe_de_zoom_K_escala_.png) |
| Exportar | ✅ | 6.7 s | 2 | 5.7 s · pronto | [img](shots/ux2-5-Exportar.png) |

### P3 — Só quer legendas (iPhone SE): importar, gerar legenda, trocar estilo e exportar

| Passo | Resultado | Tempo | Toques | Nota | Captura |
|---|---|---|---|---|---|
| Importar vídeo (editor vazio + galeria) | ✅ | 6.4 s | 5 | clipes na timeline: 1 | [img](shots/ux3-1-Importar_v_deo_editor_vazio_ga.png) |
| Gerar legendas (Legendas → Gerar com IA) | ✅ | 6.7 s | 3 | transcrição ok — vídeo de teste sem fala (esperado) | [img](shots/ux3-2-Gerar_legendas_Legendas_Gerar_.png) |
| Trocar estilo da legenda (Karaokê) | ✅ | 2.6 s | 3 | preset karaoke-acendendo (sem legendas para ver o efeito) | [img](shots/ux3-3-Trocar_estilo_da_legenda_Karao.png) |
| Exportar (vídeo) | ✅ | 7.5 s | 2 | 4.6 s · pronto | [img](shots/ux3-4-Exportar_v_deo_.png) |

Alvos < 44 px: `Resolução de exportação: 1080p, 30 fps` 88×40 · `Exportar` 93×38 · `Mais opções da timeline` 30×30 · `+ Adicionar legendas` 182×22 · `+ Adicionar texto` 157×26 · `+ Adicionar áudio` 159×32 · `Fechar` 14×23 · `Fechar` 36×36 · `Nenhuma` 91×40 · `TikTok` 69×40 · `Reels` 63×40 · `Shorts` 71×40 · `YouTube` 85×40 · `Palavras-chave` 130×40 · `Emoji` 64×40

### P4 — Usa a IA (Pixel 7): 3 pedidos no pop-up e desfazer um

| Passo | Resultado | Tempo | Toques | Nota | Captura |
|---|---|---|---|---|---|
| Wizard → Editar com IA | ✅ | 7.3 s | 5 | 6.0 s | [img](shots/ux4-1-Wizard_Editar_com_IA.png) |
| Pedido 1: "deixe a legenda maior" | ✅ | 4.7 s | 3 | 3.8 s | [img](shots/ux4-2-Pedido_1_deixe_a_legenda_maior.png) |
| Pedido 2: "corte os primeiros 2 segundos" | ✅ | 4.3 s | 2 | 3.8 s | [img](shots/ux4-3-Pedido_2_corte_os_primeiros_2_.png) |
| Pedido 3: "deixe as cores mais quentes" | ✅ | 6.1 s | 2 | 5.7 s | [img](shots/ux4-4-Pedido_3_deixe_as_cores_mais_q.png) |
| Desfazer a 2ª edição ("Desfazer esta edição") | ✅ | 2.2 s | 2 | desfez via conversa completa | [img](shots/ux4-5-Desfazer_a_2_edi_o_Desfazer_es.png) |

Alvos < 44 px: `Resolução de exportação: 1080p, 30 fps` 88×40 · `Exportar` 93×38 · `Mais opções da timeline` 30×30 · `+ Adicionar texto` 157×30 · `+ Adicionar áudio` 159×34 · `Ver as 2 edições desta conversa (desfaze` 342×36 · `Ver as 3 edições desta conversa (desfaze` 343×36 · `Ver as 4 edições desta conversa (desfaze` 343×36 · `Fechar` 36×36 · `Transcrição no aparelho` 38×34

## Observações manuais (capturas da rodada)

- **iPhone SE, editor vazio** (`shots/ux3-1-*.png`): o botão flutuante ✦ da IA cobre o cartão "Editar com IA"/"Capa" no início da timeline, e "+ Adicionar legendas" aparece cortado ("+ Adicionar legend"). Donos: **shell** (`components/shell/AiPopupHost.tsx`, posição do `.ep-aifab2`) e **timeline** (`components/timeline/Rows.tsx:502`, faixa de atalhos no celular).
- **Música importada** entra em "Seus áudios" com um "+" pequeno à direita; tocar na linha inteira adiciona no início (0 s), não no cursor. Dono: **shell** (`components/panels/AudioTab.tsx:27`).
- **Export** no Chromium sai com áudio **Opus** dentro de MP4 (sem AAC no navegador do teste). Conferir no Android real. Dono: **export**.
- A transcrição (Whisper) funcionou no container: os vídeos de teste não têm fala, então "Não encontrei fala" é o resultado esperado.
