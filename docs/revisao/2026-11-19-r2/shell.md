# Revisão de código r2 — área shell

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Servidor :3100 está servindo um .next desatualizado (chunks dão 400, a página fica em branco). Validei no :3101, que roda o mesmo worktree ep-int (área shell idêntica a 3090724; só o AudioTab difere, pelo catálogo de música). Scripts e testes estão em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/shell/ (t_commit.js, t_remove_undo.js, t_rename.js, t_wizard.js, toolsheet.test.ts). Riscos que não viraram bug: (1) putBlob que falha por cota (iOS) só gera console.warn, então a mídia some em silêncio ao recarregar; (2) 'Limpar mídia sem uso' durante uma importação apaga o blob ainda não referenciado; (3) asset restaurado dos Recentes não gera nem reutiliza o proxy 720p (vídeo 4K roda pesado no celular); (4) Slider não trata pointercancel, então um gesto cancelado funde o próximo arraste no mesmo passo de desfazer; (5) undo devolve updatedAt antigo e a ordem de 'Meus projetos' pode ficar estranha; (6) o autosave regrava o registro inteiro (com miniaturas data-URL de todos os assets) a cada edição, o que é pesado em projetos grandes no celular.

## 1. [media] Texto digitado no inspector é aplicado ao clipe errado ao trocar de seleção (TextEditor sem key no painel Texto/ToolSheet)

- **Arquivo:** `web/components/panels/TextTab.tsx:181`

**Cenário:** Confirmado com Playwright (desktop): no painel Texto, com o texto A selecionado, digito '0:08' em 'Início' (CommitInput) e sem Enter clico no texto B da timeline. O pointerdown do clipe chama preventDefault, então o foco fica no campo. O React já re-renderizou o TextEditor (a mesma instância, sem key) com o B, e no blur o commit() roda com o onCommit/value do B. Resultado salvo: clip_a@0, clip_b@8, ou seja, o B foi movido e o A não. O mesmo vale para 'Duração', para o valor digitado no Slider ('Toque para digitar', estado `editing` preso) e para o gesto do TextField (`started` continua true, então a 1ª edição do B entra sem passo de desfazer). Também acontece no ToolSheet do celular (ToolSheet.tsx:55, corpo sem key) e em AudioTab/TransitionsTab, que montam VolumeSection/Slider sem key.

**Correção proposta:** Remontar por clipe: `<TextEditor key={clip.id} clip={clip} />` no TextTab e `key={clip.id}` no corpo do ToolSheet, em `<VolumeSection key={clip.id}>` (AudioTab) e no conteúdo do TransitionsTab, como o EditTab já faz. Para reforçar, o CommitInput e o Slider podem guardar o alvo (onCommit/clipId) no onFocus/início da edição e descartar o commit se o alvo mudou.

**Correção refinada pelo verificador:** Remontar a árvore do inspector quando o clipe muda:
- TextTab.tsx:181: `<TextEditor key={clip.id} clip={clip} />`.
- ToolSheet.tsx: `<div className="ep-toolsheet-body ep-insp" key={clip.id}>` (ou key no `body`).
- AudioTab/TransitionsTab: key={clip.id} no conteúdo dependente do clipe, como o EditTab já faz.

Defesa extra nos controles (vale para qualquer outro lugar que reaproveite a instância):
- CommitInput: guardar o onCommit/value vigentes em um ref no onFocus e usá-los no commit do blur.
- Slider: o mesmo, capturando onChange/value ao entrar em `editing`.
- Assim o valor digitado vai para o clipe em que o usuário começou a editar, não para o que ficou selecionado depois. | Use `<TextEditor key={clip.id} clip={clip} />` in TextTab.tsx:181 and add `key={clip.id}` to the ToolSheet body wrapper (e.g. `<div key={clip.id} className="ep-toolsheet-body ...">`), the same way EditTab does. That way the pending input is discarded instead of being applied to another clip. To preserve what the user typed, CommitInput and Slider can capture `onCommit`/`onChange` in a ref on focus or when editing starts, and use that ref in `commit()`. The value then goes to the clip the user was editing (A), even if the selection changed before the blur.

## 2. [alta] Remover mídia da biblioteca e depois Desfazer traz os clipes de volta sem o asset (mídia perdida e salva assim)

- **Arquivo:** `web/components/media/MediaBin.tsx:61`

**Cenário:** Confirmado com Playwright: o projeto tem uma imagem na timeline. Mídia → Remover → confirmar → Desfazer no header. Os clipes voltam (o remove_clip estava no histórico), mas `removeAsset` fica fora do histórico, então o asset some de vez. A timeline mostra 1 clipe e a biblioteca 0 assets, e o autosave grava clips=['clip_img->asset_img'] com assets=[]. Depois de recarregar, o clipe fica preto. 'Limpar mídia sem uso' passa a considerar o blob órfão e o apaga (se ele não estiver nos Recentes). Na mesma função, `project.canvas.assetId` (fundo em imagem) também não é limpo, e o object URL/proxyUrl do asset removido nunca é revogado (o Blob do proxy fica preso na memória).

**Correção proposta:** Tornar a remoção desfazível: guardar o asset removido (lixeira em memória, por id) e restaurá-lo quando um undo/redo trouxer de volta um clipe cujo assetId não está em `assets`. Alternativa: só tirar o asset do store quando nenhum projeto do histórico (past/future) o referenciar. Juntar remove_clip, referenceAssetId e canvas.assetId num único dispatch (1 passo) e revogar url/proxyUrl apenas quando o asset sair de vez.

**Correção refinada pelo verificador:** Manter no store uma lixeira de assets removidos (`trash: Record<Id, MediaAsset>`). `removeAsset` move o asset para `trash` em vez de descartá-lo e não revoga url/proxyUrl. Em `undo`/`redo` (e no fechamento de lote do `applyLive`), percorrer o projeto restaurado com `usedAssetIds(project)`, mais `canvas.assetId` e os stickers, e devolver para `assets` todo id que estiver em `trash`. Revogar url/proxyUrl e esvaziar a lixeira só quando o id não aparecer mais em nenhum projeto de past/future, ou em `loadProject`/`newProject`, que zeram o histórico. Em `remove()`, juntar num único `dispatch` os `remove_clip`, o `set_project {referenceAssetId: undefined}` e a limpeza do `canvas.assetId`, para virar 1 passo de desfazer. Também proteger os ids da lixeira na chamada de `gcBlobs` do SettingsModal (keep = assets + trash). | No store (lib/store.ts), manter uma lixeira em memória, por exemplo `trash: Record<Id, MediaAsset>`. `removeAsset(id)` passa a mover o asset para a lixeira em vez de descartá-lo. Em `undo`/`redo` (e em `cancelLive`, quando ele restaura um `before`), depois de definir `project`, varrer os assetIds referenciados pelo projeto (clips com assetId, `referenceAssetId`, `canvas.assetId`): o que estiver na lixeira volta para `assets`. Esvaziar a lixeira em `loadProject`/`newProject`, e só aí revogar url/proxyUrl dos assets que ficaram nela. Também dá para revogar quando o asset já não aparece em nenhum projeto de `past`/`future`.

Em MediaBin.remove: juntar os `remove_clip`, o `set_project{referenceAssetId: undefined}` e a limpeza de `canvas` (quando `canvas.assetId === asset.id`) num único `dispatch([...])`, para que um desfazer só restaure tudo junto. Assim, enquanto houver como desfazer, nem o autosave nem o gcBlobs (que protege os assets em memória) perdem o arquivo.

## 3. [media] Renomear pela tela inicial o projeto que está aberto não salva (a lista mostra o nome antigo e o nome se perde ao recarregar)

- **Arquivo:** `web/lib/persist/index.ts:164`

**Cenário:** Confirmado com Playwright: o app restaura o 'Projeto Alfa' e eu vou para Meus projetos. ⋯ → Renomear → 'Alfa Renomeado' → Enter. Para o projeto aberto, renameProject só faz `dispatch(set_project)` e retorna, mas o autosave está desligado na view 'home' (EditorShell só chama startAutosave com view==='editor'). O reload() relê o IndexedDB e a lista continua 'Projeto Alfa', parecendo que o rename falhou. Se a página for recarregada ou fechada sem voltar ao editor, o rename some (IndexedDB e header continuam 'Projeto Alfa'). Pelo mesmo motivo, Duplicar esse projeto copia o nome antigo.

**Correção proposta:** No ramo do projeto aberto: despachar e chamar `await saveNow()` (exportada no mesmo módulo) antes de retornar, ou também atualizar o registro (`saveProjectRecord({...rec, name, project:{...rec.project, name}})`). Assim o reload() da Home já vê o nome novo.

**Correção refinada pelo verificador:** Em web/lib/persist/index.ts, no ramo do projeto aberto, despachar e salvar já, para que o reload() da Home leia o nome novo:

if (st.project.id === id) {
  st.dispatch({ op: 'set_project', patch: { name } });
  if (!(await saveNow())) {
    const rec = await getProjectRecord(id);
    if (rec) await saveProjectRecord({ ...rec, name, project: { ...rec.project, name } });
  }
  return;
}

O fallback cobre o caso em que saveNow() devolve false porque isBlank (projeto sem clipes, legendas, mídia, mensagens nem brief) mas já existe um registro salvo. Também fica bom despachar com { history: false } (o desfazer do editor não deve desfazer um rename feito na Home) e chamar saveSoon.cancel() antes, para não haver gravação concorrente pendente. | Em `web/lib/persist/index.ts`, no ramo do projeto aberto de `renameProject`, despachar a op e gravar na hora antes de retornar:
`if (st.project.id === id) { st.dispatch({ op: 'set_project', patch: { name } }); await saveNow(); return; }`

Assim o `reload()` da Home já lê o nome novo, e o Duplicar logo em seguida copia o nome certo. Um projeto aberto e vazio não aparece na lista, então o `isBlank` dentro de `saveNow` não atrapalha. Para ficar mais robusto, se `saveNow()` retornar false, dá para cair no caminho do registro salvo (`getProjectRecord` + `saveProjectRecord({...rec, name, project:{...rec.project, name}})`), garantindo que o IndexedDB fique atualizado mesmo nesse caso.

## 4. [media] ↺ 'Redefinir' do ToolSheet não desfaz nada (ou desfaz só uma parte) quando o histórico está no limite de 100 passos

- **Arquivo:** `web/components/shell/ToolSheet.tsx:26`

**Cenário:** Confirmado em vitest com o store real. O ToolSheet guarda `start = past.length` e o reset faz undo enquanto `past.length > start`. Como o store corta `past` em 100 (slice(-100)), com o histórico cheio past.length continua 100 depois de cada edição. Depois de 100+ edições numa sessão longa no celular: abro Opacidade/Transformar, mudo escala e rotação e toco em ↺, e nada é revertido (scale=2, rotation=45 continuam). Com start=98 e 5 mudanças, o ↺ reverte só 2 (rotation=30 em vez de undefined). O confirm (✓) usa o mesmo índice deslocado (`past.slice(0, start+1)`) e mantém passos intermediários, então desfazer depois não volta ao estado de antes do sheet.

**Correção proposta:** Guardar na abertura a referência do projeto (`before = useRef(useEditor.getState().project)`). No ↺, restaurar esse snapshot (`useEditor.setState({ project: before, future: [] })` e retirar de `past` as entradas posteriores a ele via `past.lastIndexOf(before)`). No ✓, cortar `past` em `past.lastIndexOf(before) + 1` em vez de usar a contagem.

**Correção refinada pelo verificador:** Na abertura (e no useEffect de kind/clip.id), guardar a referência do projeto: `before.current = useEditor.getState().project`.

**Reset:**
```ts
const s = useEditor.getState();
const i = s.past.lastIndexOf(before.current);
if (s.project === before.current) return;
useEditor.setState({ project: before.current, past: i >= 0 ? s.past.slice(0, i) : s.past, future: [] });
```

**Confirm:**
```ts
const s = useEditor.getState();
const i = s.past.lastIndexOf(before.current);
if (i >= 0 && i < s.past.length - 1) useEditor.setState({ past: s.past.slice(0, i + 1) });
```

Por que funciona: o primeiro dispatch do sheet empilha exatamente essa referência em `past`. Assim o índice continua certo mesmo depois de o slice(-100) descartar entradas da frente.

Alternativa equivalente: contar os pushes feitos enquanto o sheet está aberto, com `useEditor.subscribe` comparando as referências de `past`, em vez de usar `past.length`. | Identificar o ponto de partida pela referência do projeto, não pela contagem. Ao abrir (e no efeito de [kind, clip.id]), guardar `before.current = useEditor.getState().project`.

Reset:
```ts
const s = useEditor.getState();
const i = s.past.lastIndexOf(before.current);
useEditor.setState({
  project: before.current,
  past: i >= 0 ? s.past.slice(0, i) : s.past,
  future: [],
});
```
Antes, se `live.running`, chamar `cancelLive()`. Se `s.project === before.current`, não fazer nada.

Confirm:
```ts
const i = past.lastIndexOf(before.current);
if (i >= 0) useEditor.setState({ past: past.slice(0, i + 1) });
```

Se o sheet fizer mais de 100 mudanças, `before` sai de `past` (i = -1). Nesse caso o reset restaura o snapshot sem mexer em `past`, e o confirm empilha `before` de novo (`past: [...past, before].slice(-100)` não basta; o mais simples é `past: [...past.slice(-99), before]` mais a remoção dos intermediários).

Alternativa mais robusta: o store expõe um contador monotônico de passos (`historySeq`, que só cresce) e o ToolSheet usa o delta desse contador em vez de `past.length`.

## 5. [media] Wizard: voltar durante 'Preparando mídia…' e abrir outro projeto faz o material, o brief e a edição de IA caírem nesse projeto, sem desfazer

- **Arquivo:** `web/components/shell/EditorShell.tsx:221`

**Cenário:** Confirmado com Playwright: no wizard escolho 3 vídeos → 'Editar com IA' → 'Preparando mídia 1/3…'. O botão Voltar (Home.tsx:116) continua habilitado, então toco nele e abro o 'Projeto Beta', já existente, na lista. Quando a ingestão termina, startWizard faz `useEditor.getState()` e despacha `sequenceOps(...)` + `set_project{brief}` com `history:false` no Beta. O Beta salvo fica com brief='Video novo do wizard…' (o original foi sobrescrito), 3 clipes de vídeo novos (um deles apontando para um asset que não está no Beta, porque openProject revogou e trocou os assets) e assets v2/v3. Desfazer fica desabilitado, e `pendingBrief` dispara a edição da IA no Beta na próxima entrada no editor. O MediaBin.importFiles tem a mesma corrida (o sequenceOps vai para o projeto que estiver aberto quando a importação termina).

**Correção proposta:** Guardar o id do projeto criado por resetWorkspace no início de startWizard e, depois de cada await, abortar (ou descartar o material) se `useEditor.getState().project.id` mudou. Desabilitar Voltar/abrir projeto enquanto `busy`. No ingestFile, receber o projectId alvo e não chamar addAsset/updateAsset se o projeto ativo for outro.

**Correção refinada pelo verificador:** A correção mais segura é combinar três medidas.

(1) No startWizard, logo depois do resetWorkspace, guardar `const pid = useEditor.getState().project.id`. Depois de cada await (ingestFiles, ingestFile da referência), se `useEditor.getState().project.id !== pid`, abortar: não despachar ops, não setar `pendingBrief`, não chamar setView/setTool e não mexer nos painéis. Só limpar `busy` no finally.

(2) Na UI, enquanto `busy`:
- tratar Voltar como cancelamento, com um flag/token de cancelamento que o startWizard confere;
- ou desabilitar Voltar (Home.tsx:116), além de `open`, `openEmpty`, `fromTemplate` e `importNew` no EditorShell.

(3) No `ingestFile`, gravar o `project.id` alvo no início. Antes de `addAsset`/`updateAsset`, se o projeto ativo for outro, não mexer no store e revogar a URL que o próprio ingestFile criou. O mesmo vale para o `listenAttachFiles`/MediaBin, que só deve fazer `dispatch(sequenceOps)` se o projeto ainda for o de origem. | Em startWizard, logo depois de resetWorkspace, guardar `const pid = useEditor.getState().project.id`. Depois de cada await (ingestFiles e ingestFile da referência), fazer `if (useEditor.getState().project.id !== pid) return;`, sem dispatch, sem pendingBrief e sem setView. Assim o material que já entrou no projeto do wizard (não salvo) é simplesmente descartado.

Também desabilitar Voltar quando `busy` (Home.tsx:116: `disabled={!!busy}`) e ignorar `open`/`fromTemplate`/`importNew`/`openEmpty` enquanto busy estiver setado. Isso fecha também o caminho pelo Sidebar/MobileNav.

Para fechar a raiz em ingest.ts: ingestFile captura o `project.id` no início, e antes de cada addAsset/updateAsset confere se ainda é o mesmo. Se mudou, não toca no store e revoga a URL. O mesmo vale para MediaBin.importFiles: comparar o project.id de antes e de depois do await antes de chamar sequenceOps.

## 6. [media] Waveform/batidas/extrair áudio decodificam o arquivo inteiro sem limite de duração: áudio longo comprimido estoura a memória do celular

- **Arquivo:** `web/lib/media/ingest.ts:111`

**Cenário:** O único limite é o tamanho do arquivo (350 MB), mas decodeAudioData expande o áudio comprimido para PCM Float32 na taxa do contexto (48 kHz). Importar um podcast MP3 de 1 h (~57 MB) gera 3600·48000·2·4 ≈ 1,4 GB de AudioBuffer, mais o ArrayBuffer do arquivo. No Android isso derruba a aba (OOM) durante 'Analisando áudio…'. Em lib/media/tools.ts:23 (decodeAsset, usado por 'Detectar batidas' e por 'Extrair áudio' do painel Editar, também acessível no celular via ToolSheet→Substituir) não há limite nenhum: `fetch(url).arrayBuffer()` de um vídeo 4K de 1–2 GB mais a decodificação completa.

**Correção proposta:** Limitar pela duração já conhecida (ex.: pular se duration·48000·canais·4 > ~150 MB), ou decodificar com `new OfflineAudioContext(1, 1, 8000).decodeAudioData(...)`, que reamostra para 8 kHz mono e reduz o PCM cerca de 12×. Para 'Extrair áudio', reutilizar o mesmo asset como clipe de áudio (como detachAudioOps faz) em vez de decodificar e gerar um WAV inteiro.

**Correção refinada pelo verificador:** Gate the decode on the duration that is already known, not only on file size.

1. waveformOf (ingest.ts:110): estimate `duration * 48000 * 2 * 4 * 2.5` (the decoder's peak) and return undefined when it exceeds a budget of about 300–400 MB. That works out to about 10–12 min.
2. decodeAsset (tools.ts:19): before the fetch, check `a.duration` and `a.size` and throw a clear message, e.g. 'Áudio longo demais para analisar no celular'. Do not reuse the misleading "sem áudio" message.
3. extractAudio: reuse the same asset as an audio clip (as detachAudioOps does) instead of decoding and writing a full WAV.
4. To still get a waveform for long files, decode in chunks with WebCodecs AudioDecoder (demux, then decode per chunk, computing peaks incrementally and dropping each chunk). This keeps memory constant.

Do not rely on OfflineAudioContext at 8 kHz: it does not reduce Chrome's peak memory, as measured above. | 1) Em `waveformOf` (`ingest.ts`), estimar o PCM antes de decodificar e pular a waveform acima de um orçamento, por exemplo `if (duration * 48000 * 2 * 4 > 200 * 1024 * 1024) return undefined`. Melhor ainda: decodificar num `OfflineAudioContext` de taxa baixa (por exemplo 11025 ou 16000 Hz, ou 22050 no `webkitOfflineAudioContext` do Safari antigo), que reduz 3–4× e basta para picos. Aplicar o orçamento em cima disso.

2) Em `decodeAsset` (`tools.ts`), aplicar o mesmo orçamento a partir de `a.duration`. Acima dele, mostrar um erro claro ("arquivo longo demais para analisar no aparelho") em vez de tentar. Para `analyzeBeats`, usar `OfflineAudioContext` a 22050 Hz e, se possível, decodificar só o trecho do clipe (`clip.in` .. `clip.in + duration·speed`).

3) Em `extractAudio`, não decodificar nem gerar WAV. Criar o clipe de áudio apontando para o mesmo `assetId` do vídeo (como `detachAudioOps` já faz). Assim a nova chamada de `ingestFile`, que decodificaria o WAV de novo em `waveformOf`, também desaparece.

## 7. [baixa] Congelar quadro / Extrair áudio do painel Editar ignoram reverso e curva de velocidade

- **Arquivo:** `web/components/panels/ClipSections.tsx:73`

**Cenário:** Num clipe de vídeo com `reverse: true` (ou com speedCurve), coloco o playhead 1 s depois do início de um clipe de 5 s e toco em Congelar. O tempo capturado é `clip.in + (playhead - start)·speed` = in+1, mas o quadro que aparece ali é in+4 (mapSourceTime inverte), então a imagem congelada inserida não bate com o que estava na tela. Em 'Extrair áudio' (linha 86), o clipe de áudio criado recebe só in/speed/volume, sem reverse/speedCurve/fades, enquanto o vídeo é mutado: o áudio toca para frente e fora de sincronia com o vídeo invertido ou curvado.

**Correção proposta:** Usar `sourceTime(clip, playhead)` de '@/lib/engine/timing' no captureFrame. Na extração, copiar `reverse`, `speedCurve`/`speedPreset`, `fadeIn`/`fadeOut` e o `linkId` (ou simplesmente usar `detachAudioOps` de lib/timeline/edit).

**Correção refinada pelo verificador:** Congelar: em ClipSections.tsx:73 e lib/timeline/actions.ts:142, trocar o cálculo por `captureFrame(asset, sourceTime(clip, playhead))`, importando `sourceTime` de '@/lib/engine/timing'. Extrair: em ClipSections, substituir a montagem manual por `dispatch(detachAudioOps(useEditor.getState().project, clip.id))`. Isso já dá reverse, os fades, o linkId e a posição na trilha via placeClip. Também é preciso acrescentar em `detachAudioOps` a cópia de `speedCurve`/`speedPreset`, que hoje falta lá também. Se o painel precisar mesmo do asset de áudio vindo de `extractAudio`, trocar só o `assetId` no clipe gerado por `detachAudioOps`. | Congelar: em ClipSections.tsx:73 e em lib/timeline/actions.ts:142, trocar a conta por `sourceTime(clip, playhead)` de '@/lib/engine/timing' (ou `mapSourceTime` de lib/engine/speed). Extrair áudio: trocar o dispatch manual por `dispatch(detachAudioOps(useEditor.getState().project, clip.id))`, que já copia reverse, fades e linkId e posiciona com placeClip. Também convém incluir `speedCurve`/`speedPreset` em `detachAudioOps`, que hoje não os copia, para o áudio não sair fora de sincronia com o vídeo curvado.

## 8. [baixa] Narração: microfone e MediaRecorder ficam ligados para sempre se o painel desmontar enquanto getUserMedia está pendente

- **Arquivo:** `web/components/panels/AudioTab.tsx:59`

**Cenário:** Toco em 'Gravar a partir do playhead', a contagem termina e aparece a bolha de permissão do microfone (no desktop a página continua interativa). Antes de permitir, troco de ferramenta no rail: o Inspector remonta e o cleanup roda com `rec.current` ainda null. Ao permitir, `rec.current = await startRecording()` atribui o gravador a um componente desmontado e inicia um setInterval que nunca é limpo. O indicador de microfone fica aceso, e o MediaRecorder (start(250)) acumula chunks na memória até recarregar a página.

**Correção proposta:** Usar uma flag `alive` (ref zerada no cleanup) e, depois do `await startRecording()`, se o componente já desmontou, chamar `recorder.cancel()` e retornar sem criar o intervalo.

**Correção refinada pelo verificador:** Adicionar `const alive = useRef(true)` e mudar o cleanup para `useEffect(() => { alive.current = true; return () => { alive.current = false; clear(); rec.current?.cancel(); }; }, [])`. Em `begin`, ler `const r = await startRecording(); if (!alive.current) { r.cancel(); return; } rec.current = r;` antes de criar o intervalo. Também convém sair cedo depois da contagem se `!alive.current`. | Adicionar `const alive = useRef(true)` e mudar o useEffect para `useEffect(() => { alive.current = true; return () => { alive.current = false; clear(); rec.current?.cancel(); rec.current = null; }; }, [])`. Em `begin`, retornar se `!alive.current` logo após a contagem. Depois trocar a atribuição por `const r = await startRecording(); if (!alive.current) { r.cancel(); return; } rec.current = r;`, antes de criar o intervalo.
