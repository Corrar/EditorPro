## Observações manuais (capturas da rodada)

- **iPhone SE, editor vazio** (`shots/ux3-1-*.png`): o botão flutuante ✦ da IA cobre o cartão "Editar com IA"/"Capa" no início da timeline, e "+ Adicionar legendas" aparece cortado ("+ Adicionar legend"). Donos: **shell** (`components/shell/AiPopupHost.tsx`, posição do `.ep-aifab2`) e **timeline** (`components/timeline/Rows.tsx:502`, faixa de atalhos no celular).
- **Música importada** entra em "Seus áudios" com um "+" pequeno à direita; tocar na linha inteira adiciona no início (0 s), não no cursor. Dono: **shell** (`components/panels/AudioTab.tsx:27`).
- **Export** no Chromium sai com áudio **Opus** dentro de MP4 (sem AAC no navegador do teste). Conferir no Android real. Dono: **export**.
- A transcrição (Whisper) funcionou no container: os vídeos de teste não têm fala, então "Não encontrei fala" é o resultado esperado.
