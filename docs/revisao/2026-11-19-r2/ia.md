# Revisão de código r2 — área ia

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Riscos que não entraram como bug:
(1) frameCache (pipeline.ts:134) e colorCache são indexados por blob URL e nunca esvaziam. Cada abertura de projeto gera chaves novas (até ~900 KB por mídia quando amostrada), crescimento lento no celular.
(2) useAIChat.runs guarda before/after/final de toda execução, inclusive de projetos já fechados, sem limite.
(3) translate: a rota corta em 600 segmentos e o cliente responde 'Traduzi N legendas' contando todas.
(4) No SDK 1.10, o timeout de 240 s só cobre até chegarem os headers. Um stream longo (1ª edição, effort high, max_tokens 32000) passa dos 300 s e a Vercel derruba a função; o cliente ainda mostra 'demorou demais'.
(5) /api/login não tem rate-limit nem atraso, então dá para tentar senhas em força bruta contra o DASH_PASSWORD.
(6) O wrapper do withSingleUndo junta num único passo as edições manuais que o usuário fizer enquanto espera a IA.
A chave nunca vai ao cliente (status só expõe configured/model) e o middleware cobre /api/ai/* e /api/gen/*.
Os testes que reproduzem os bugs estão em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/ia/ia.review.test.ts (rodar com a vitest.config.mts da mesma pasta).

## 1. [alta] Execução da IA não fica presa ao projeto: depois de trocar de projeto, as ops caem no projeto errado e a IA pode ficar 'Trabalhando…' para sempre

- **Arquivo:** `web/lib/ai/chatStore.ts:129`

**Cenário:** O usuário pede uma edição (chat ou 1ª edição; Whisper + Claude levam minutos). Nesse meio-tempo ele vai ao Início e abre outro projeto B (openProject → loadProject) ou cria um projeto novo pelo assistente (resetWorkspace). Quando a resposta chega, claudeChat/runFirstEdit roda sanitizeOps(res.ops, store().project) já contra B, e o wrapper `apply` chama applyLive em B. As ops sem id (ripple_delete por tempo, set_captions, set_caption_style, add_clip de texto, apply_look, set_aspect) são aplicadas em B. Reproduzi num teste: um ripple_delete 2–6 s pedido em A encurtou B de 30 para 26 s e trocou a cor das legendas de B. Pior ainda: se a execução estava esperando um `ask` (aparelho fraco: 'Transcrever (~41 MB) / Pular legendas'), as mensagens de A somem com a troca e ninguém mais consegue responder. A promise nunca resolve e `busy` fica true até recarregar. Nesse estado o firstEdit do projeto novo é ignorado em silêncio (linha 298, `if (get().busy) return`). E o withSingleUndo (pipeline.ts:126) ainda pode gravar `past=[projeto A]` dentro de B: um desfazer em B carrega o conteúdo de A.

**Correção proposta:** Em run(), guardar `const pid = editor().project.id` e criar um AbortController por execução. Assinar useEditor e abortar quando `project.id !== pid`. No wrapper `apply`, conferir `editor().project.id === pid` antes de aplicar e lançar AbortError se for diferente. Resolver o `ask` pendente com 'skip' e rejeitar no abort, para liberar `busy`. Repassar o signal ao requestEdit e ao Whisper. No withSingleUndo, só reescrever o histórico se `store().project.id === projectBefore.id`.

**Correção refinada pelo verificador:** In run() (chatStore.ts), save `const pid = editor().project.id` and create an AbortController for the run. Subscribe to useEditor so that when `project.id !== pid` the run: aborts the controller, resolves the pending `answers.get(msgId)` with 'skip', and aborts `skips.get(msgId)`. In the `apply` wrapper, before `applyLive`, throw `new DOMException('Projeto trocado','AbortError')` if `editor().project.id !== pid`, and finish with `busy:false` and no "error" message, because the message no longer exists. In withSingleUndo, add `&& s.project.id === projectBefore.id` to the condition. Also, more simply, in EditorShell `open`/`startWizard`/`openEmpty`/`importNew`/`fromTemplate`, check `useAIChat.getState().busy` and either show a toast ("Wait for the AI to finish or stop it") or ask for confirmation and cancel the run before switching. Pass the signal to requestEdit and transcribeMedia to save tokens and CPU on mobile. | Prender a execução ao projeto dentro de run() (chatStore.ts):
1. Guardar `const pid = editor().project.id` e criar um AbortController por execução. Assinar useEditor e, quando `project.id !== pid`, chamar abort, resolver o ask pendente com 'skip' e abortar o skippable atual.
2. No wrapper `apply`, se `editor().project.id !== pid`, lançar DOMException('AbortError') antes de chamar applyLive. No catch de run(), tratar o AbortError em silêncio (sem updateMessage, que já não existe) e sempre liberar `busy` no finally. Cancelar a assinatura também no finally.
3. Repassar o signal para requestEdit/analyzeReference/transcribeMedia, se aceitarem, para não gastar mais tempo à toa.
4. Em withSingleUndo (pipeline.ts:122), só reescrever past/future se `store().project.id === projectBefore.id`.

Opcional, e mais simples como camada extra: em goHome/open/resetWorkspace, se useAIChat.busy, confirmar ou bloquear a troca ('A IA ainda está editando este projeto').

## 2. [media] colorGrade parcial da IA apaga toda a correção de cor do usuário (LUT, curvas, rodas, HSL)

- **Arquivo:** `web/lib/ai/validate.ts:295`

**Cenário:** O usuário gradua um clipe no painel Cor (LUT .cube + curvas + lift) e pede à IA 'deixa um pouco mais quente'. O prompt manda usar colorGrade com ajustes finos, então o Claude envia update_clip {colorGrade:{temperature:0.15}}. O buildClipPatch troca o colorGrade inteiro e o clipe fica só com {temperature:0.15}: LUT, curvas e rodas somem (testado). A IA também não teria como preservar, porque summary.ts/clipLine não manda o colorGrade atual. O mesmo acontece no 'combina a cor com o modelo' local: colormatch.ts:70 envia `{colorGrade: g}`, substituindo o grade inteiro.

**Correção proposta:** Em buildClipPatch, mesclar com o atual: `out.colorGrade = { ...clip.colorGrade, ...cg }`, mesclando também curves e hsl por chave, e manter `null` = remover. Fazer o mesmo merge em colorGradeOps. Incluir no clipLine um resumo do colorGrade (lut id, campos ligados) para a IA saber o que existe.

**Correção refinada pelo verificador:** In buildClipPatch (validate.ts:295), when COLOR_GRADE_LIVE is on, merge with the clip's current grade instead of replacing it. Wheels (lift/gamma/gain/offset), curves and hsl merge by key, and lut replaces only when the AI sends one: `out.colorGrade = mergeGrade(clip.colorGrade, cg)`. Keep `colorGrade: null` = remove everything. sanitizeColorGrade drops values of 0 (`x !== 0`), so the AI could never zero out a single field once grades merge. Accept 0 and turn it into a deletion of that field (or allow `lut: null` / `curves: null`). Also add to clipLine in summary.ts a compact summary of the current grade, for example `colorGrade: {lut:'look:x@0.8', temperature:0.1, curves:['master'], wheels:['lift']}`, so the model knows what already exists. Adjust the prompt to say that update_clip.colorGrade only changes the fields it sends. In colormatch.ts, keep the replacement (the match is computed on the raw clip), or at most keep the user's lut/curves and replace only offset/exposure/temperature/saturation. Do not do a blind merge there. | Em buildClipPatch (validate.ts:292), quando cg não for null e COLOR_GRADE_LIVE estiver ligado, mesclar com o grade atual em vez de trocar:
`const cur = ('colorGrade' in clip && clip.colorGrade) || {}`
`out.colorGrade = { ...cur, ...cg, curves: cg.curves || cur.curves ? { ...cur.curves, ...cg.curves } : undefined, hsl: cg.hsl || cur.hsl ? { ...cur.hsl, ...cg.hsl } : undefined }`
`null` continua removendo tudo.

Cuidado: sanitizeColorGrade descarta valores 0 (`x !== 0`) e rodas zeradas. Com o merge, a IA não conseguiria zerar um campo. Então, se `raw.colorGrade[k] === 0`, ou vier `null` num campo, gravar `undefined` naquela chave do merge. O mesmo vale para `lut: null`.

Em summary.ts/clipLine, incluir um resumo do colorGrade (lut.id e intensity, mais as chaves ligadas com os valores escalares) para a IA saber o que existe.

Opcional: em colorGradeOps (colormatch.ts:70), preservar lut, curves e hsl do usuário e trocar só os campos do match: `{ colorGrade: { ...c.colorGrade, offset: undefined, exposure: undefined, contrast: undefined, saturation: undefined, ...g } }`.

## 3. [media] 'Parar', desfazer ou edição manual durante a IA só cancelam o lote atual: a execução continua e aplica os próximos lotes

- **Arquivo:** `web/lib/ai/pipeline.ts:224`

**Cenário:** Na 1ª edição, o usuário vê a IA colocando o material e toca em 'Parar' (LiveBanner → cancelLive) ou dá Ctrl+Z. O applyLive para, mas runFirstEdit segue: analisa o exemplo, baixa e roda o Whisper, chama o Claude (minutos, custo) e aplica as legendas (l.252) e a edição inteira (l.277) em cima do projeto que o usuário queria deixar como estava. O mesmo vale para chatEdit (ensureWords → Claude → marcador). Não há como cancelar a chamada: requestEdit/call (client.ts:61) não recebe AbortSignal do usuário, só o timer de 295 s.

**Correção proposta:** Fazer o cancelamento parar a execução inteira. O store expõe que o lote foi cancelado (ex.: `live.cancelled` ou applyLive devolvendo {applied, cancelled}). O wrapper `apply` do chatStore aborta um AbortController da execução e lança AbortError. Passar esse signal a requestEdit/analyzeReference/translate (fetch) e ao Whisper. O run() trata o AbortError como 'Edição parada'.

**Correção refinada pelo verificador:** 1. Expor o cancelamento no store sem confundir com op inválida. Hoje uma op que lança erro também fica fora de `applied`, então comparar o número de ids não serve. Duas opções:
   - um contador `liveCancels` incrementado em cancelLive, undo/redo/dispatch-com-histórico, loadProject e newProject;
   - ou applyLive devolver `{ applied, cancelled }`.
   Mantenha a assinatura `Promise<Id[]>` e adicione `get().live.cancelled = true` dentro de cancelLive. É uma mudança aditiva: um lote novo zera o flag ao começar.

2. No chatStore.run, criar um `runCtrl = new AbortController()` por execução:
   - No wrapper `apply`, depois de `applyLive`: se `editor().live.cancelled`, chamar `runCtrl.abort()` e lançar `new DOMException('Edição parada', 'AbortError')`.
   - Também abortar quando houver undo ou edição manual enquanto `busy`, mesmo fora de lote. Para isso, assinar `useEditor.subscribe` enquanto a execução roda: se `project` mudar e não for por applyLive, aborta.

3. Propagar `runCtrl.signal` em PipelineOptions (`signal?`):
   - em requestEdit, analyzeReference e translateSegments: `postJson(path, body, signal)` → `call(path, { ..., signal: anySignal(signal, timeoutCtrl.signal) })`;
   - em transcribeMedia/whisperCaptions, combinando com o signal do "Pular";
   - e checar `signal.throwIfAborted()` entre as etapas de runFirstEdit, chatEdit e applyComments.

4. No catch de run(), quando for AbortError: `updateMessage(msgId, { text: 'Edição parada.', status: 'done' })`, sem marcar como erro. O withSingleUndo continua juntando o que já foi aplicado num único passo de desfazer. | 1) No store, fazer o cancelamento ser visível: applyLive passa a resolver com { applied, cancelled } (ou cancelLive marca live.cancelled=true), distinguindo o cancelamento do usuário (Parar/undo/redo/dispatch/troca de projeto) de um lote novo que fecha o anterior. 2) No chatStore, criar um AbortController por execução em run(). O wrapper `apply` aborta esse controller e lança DOMException('AbortError') quando o lote volta cancelado. Passar `signal` em PipelineOptions e checar `signal.throwIfAborted()` antes de cada etapa e de cada apply em runFirstEdit, chatEdit, applyModelStyle e applyComments. Repassar o signal ao fetch de requestEdit/analyzeReference/translateSegments (client.ts `call`, combinado com o timer de 295 s) e ao transcribeMedia. 3) No catch de run(), tratar AbortError como "Edição parada" (status done, sem erro, after = projeto atual) em vez de "Não consegui concluir". 4) Mostrar um "Parar" da execução no balão do chat enquanto busy, chamando o mesmo controller, para as fases sem lote ao vivo (análise, Whisper, Claude). 5) Em applyModelStyle, não chamar chatEdit (nem usar o texto "cores JÁ combinadas") se o lote de cor foi cancelado.

## 4. [media] remove_words descarta palavras de legendas corrigidas pela IA (id de palavra truncado em 20 caracteres)

- **Arquivo:** `web/lib/ai/validate.ts:494`

**Cenário:** A IA corrige uma legenda (update_caption com text, ex.: 'é Bruno, não Bruna'). As palavras novas ganham ids `${segmentId}_${i}` (l.527), como 'cap_mwni9qwp53gpwb7_1' (21–25 caracteres). O resumo mostra esses ids à IA. Depois, 'corta o né dessa frase' gera remove_words com esse id, e `str(r.fromWordId, 20)` trunca para 'cap_mwni9qwp53gpwb7_'. Resultado: 'palavras não encontradas' e a op é descartada (testado). O 'cortar vícios' local (fillerOps) também perde esses trechos, e a resposta ainda diz 'Cortei N vícios'. Além disso, o update_caption redistribui as palavras de forma uniforme, perdendo os tempos reais do Whisper.

**Correção proposta:** Usar `str(r.fromWordId, 80)`/`str(r.toWordId, 80)`. No update_caption, se o número de palavras não mudou, manter os ids e tempos originais de cada palavra (só trocar o texto). Se mudou, gerar ids curtos que continuam a numeração global ('w' + próximo número).

**Correção refinada pelo verificador:** Em validate.ts:494-495, trocar para `str(r.fromWordId, 80)` e `str(r.toWordId, 80)`, o mesmo limite usado para os outros ids. Opcionalmente, em pipeline.ts:543 e no modo demo, montar a resposta com o número de ops que sobraram depois do `sanitizeOps` (clean), e não com o `count` bruto. Se quiserem preservar os tempos: no `update_caption`, quando o número de palavras do texto novo for igual ao de `seg.words`, manter id/start/end de cada palavra e trocar só o `text`. | Correções sugeridas, em ordem de prioridade:

1. Em `validate.ts:494-495`, trocar para `str(r.fromWordId, 80)` e `str(r.toWordId, 80)`, o mesmo limite usado para os outros ids.

2. No `update_caption` (`validate.ts:522-528`):
   - se o número de palavras não mudar, manter `id`, `start` e `end` de cada palavra de `seg.words` e trocar só o texto;
   - se mudar, gerar ids que continuem a numeração `wNNNNN` (maior número em `allWords(p)` + 1), para manter os ids curtos e no mesmo formato que o prompt documenta.

3. Em `pipeline.ts:542` (e no `demo.ts:1032`, se usar a mesma lógica), montar a resposta com as ops que sobraram depois do `sanitizeOps` (`clean`). Se nenhuma sobrou, dizer que nada foi cortado, em vez de usar o `count` de `fillerOps`.

## 5. [media] Zoom de ênfase, zoom/tirar zoom e reenquadrar substituem os keyframes do clipe e apagam o trabalho anterior

- **Arquivo:** `web/lib/ai/features.ts:164`

**Cenário:** O usuário pede 'reenquadra seguindo o rosto' (16:9 → 9:16). O reframeOps grava keyframes de transform.x. Depois pede 'zoom automático nas frases de ênfase'. O emphasisZoomOps envia update_clip {keyframes: só escala}, e os keyframes de x somem: o rosto sai do quadro 9:16 (testado; os keyframes resultantes só têm scale). O inverso também vale: reframeOps (l.353) apaga os zooms. O mesmo ocorre com zoomOps/removeZoomOps do demo (demo.ts:396 e 411, `keyframes: []`). E com o Claude, porque o resumo só manda `keyframes: <contagem>`, então qualquer punch-in da IA apaga o reenquadramento.

**Correção proposta:** Mesclar em vez de substituir. Ao gerar os keyframes de escala, avaliar os keyframes existentes em cada t e copiar x/y (e vice-versa no reframe, preservando scale). Em removeZoomOps, remover só o campo scale. Opcional: o validate mescla keyframes por campo e o resumo envia os keyframes (ou ao menos quais propriedades animam).

**Correção refinada pelo verificador:** Não é preciso amostrar valores. O motor já interpola cada propriedade de forma independente (easing.ts:41), então basta mesclar por campo.

Criar em features.ts um helper `mergeKfs(existing, incoming)`:
1. Pegar as chaves que aparecem em `incoming`, por exemplo `{'scale'}`.
2. Remover essas chaves de cada keyframe de `existing` e descartar os keyframes que ficarem com `transform` vazio.
3. Concatenar com `incoming` e ordenar por `t`.

Onde aplicar:
- `emphasisZoomOps` (l.164): `keyframes: mergeKfs(clip.keyframes ?? [], sorted)`.
- `reframeOps` (l.353): `mergeKfs(c.keyframes ?? [], reframeKeyframes(...))`.
- `hookOps` (l.304): mesma mescla.
- demo.ts:396/403: trocar o `[]` pela mescla.
- demo.ts:411 (tirar zoom): remover só o campo `scale` dos keyframes existentes, mantendo os de `x`/`y`.

Opcional: summary.ts:23 passar a enviar quais propriedades animam (ex.: `keyframes: {count, props:['x']}`) e o prompt orientar o Claude a mandar só as propriedades novas. Com isso, a mescla por campo pode ficar também no `buildClipPatch`, quando o patch não pedir substituição explícita. | Mesclar por propriedade, sem calcular x/scale em cada t, porque o motor já interpola cada campo só entre os keyframes que o definem. Criar em lib/ai/features.ts um helper `mergeKfProps(existing: Keyframe[] | undefined, incoming: Keyframe[], props: (keyof Transform)[]): Keyframe[]`. Ele tira `props` do transform de cada keyframe existente, descarta os que ficarem vazios, junta com `incoming` (no mesmo t, fundir os transforms), ordena por t e remove as duplicatas.

Onde usar:
- `emphasisZoomOps` (features.ts:164): `keyframes: mergeKfProps(clip.keyframes, sorted, ['scale'])`.
- `reframeOps` (features.ts:353): `mergeKfProps(c.keyframes, reframeKeyframes(...), ['x'])`.
- `hookOps` (features.ts:304), `zoomOps` (demo.ts:396/403): com `['scale']`.
- `removeZoomOps` (demo.ts:411): `mergeKfProps(c.keyframes, [], ['scale'])`, que tira só o scale e mantém o x do reenquadramento.

Opcional: o summary.ts:23 passa a mandar quais propriedades animam (por exemplo `keyframes: {count, props:['x']}`), para o Claude não apagar o reenquadramento num punch-in.

Adicionar um teste em features2.test.ts: reframe seguido de ênfase precisa preservar o x, e ênfase seguida de reframe precisa preservar o scale.

## 6. [media] Reenquadrar centraliza (x:0) os pedaços curtos sem amostra no intervalo, e o enquadramento pula entre assunto e centro

- **Arquivo:** `web/lib/ai/features.ts:340`

**Cenário:** Vídeo horizontal de 3 min com o apresentador à esquerda, já cortado em pedaços curtos (cortes de silêncio/batida de ~1 s). O trackSubject amostra no máximo 45 quadros (um a cada ~4 s). O reframeKeyframes filtra só os pontos dentro de [in-0.5, fim+0.5] de cada pedaço; quando não há nenhum, cai em `[{t:0, x:0}]`, ou seja, o centro. No teste, 11 de 20 pedaços ficaram em x=0 e os outros em x=0.79: a cada corte o quadro alterna entre o rosto e o centro (rosto cortado fora do 9:16).

**Correção proposta:** Quando não houver ponto no intervalo, interpolar a posição do assunto no meio do pedaço a partir dos pontos vizinhos da trilha completa (ou usar o mais próximo). Incluir também o último ponto antes e o primeiro depois do intervalo antes do smoothTrack.

**Correção refinada pelo verificador:** Em reframeKeyframes, ordenar `subject` por t e ampliar o intervalo antes do smoothTrack, incluindo o último ponto antes de clip.in e o primeiro depois do fim do pedaço (os tempos já são limitados a [0, duration] na linha 338). Assim a média móvel e o x do início/fim usam os vizinhos reais. Se mesmo assim não houver ponto (subject vazio), manter {x:0}. Se houver só vizinhos fora do intervalo, gerar um keyframe com o x interpolado linearmente entre o ponto anterior e o seguinte no meio do pedaço (tMid = clip.in + clip.duration*sp/2), ou usar o ponto mais próximo quando só existir um lado. Adicionar um teste com 45 pontos espaçados de 4 s e um pedaço de 1 s entre duas amostras, esperando x≈reframeX(0.25), não 0. | Em reframeKeyframes, quando o filtro não pega nenhum ponto, não usar x:0. Duas formas:
- Interpolar a posição do assunto no meio do pedaço (clip.in + clip.duration*sp/2) a partir do último ponto antes e do primeiro depois na trilha completa (ou usar o ponto mais próximo), e devolver um único keyframe com reframeX desse valor.
- De forma geral: incluir sempre o vizinho anterior e o posterior à janela antes do smoothTrack, e prender o t de cada keyframe a [0, duration].

Manter `[{t:0, x:0}]` só quando a lista do asset estiver vazia. Também vale amostrar mais densamente quando houver muitos clipes curtos: por exemplo, calcular os tempos de amostra pelos pontos médios dos clipes que estão na timeline, em vez de distribuir por igual no asset.

## 7. [media] Ops da IA ignoram trava de trilha/clipe (remove/move/split/trim/update em trilha travada)

- **Arquivo:** `web/lib/ai/validate.ts:439`

**Cenário:** O usuário trava a trilha com a logo/sobreposição (a timeline manual recusa mexer: 'Clipe travado — destrave a trilha') e pede 'remove todos os textos e stickers' ou 'corta o vídeo em 3 partes'. O sanitizeOp aceita remove_clip, move_clip, split_clip, trim_clip e update_clip em clipes de trilha travada. update_clip só checa `clip.locked`; os demais não checam nada. O prompt não fala de trava (só o ripple respeita). Testado: as 5 ops passaram sem descarte e a logo protegida é apagada ou cortada.

**Correção proposta:** Em clipOf, devolver também a trilha e falhar ('clipe/trilha travado') se `clip.locked || track.locked` para update/remove/move/split/trim/duplicate. Avisar no edit-system.md que itens com locked:true não podem ser alterados.

**Correção refinada pelo verificador:** 1. Em sanitizeOp, trocar clipOf por algo que devolva {clip, track} e criar `const travado = (f) => !!f.track.locked || !!f.clip.locked`.
2. Em update_clip, remove_clip, split_clip, trim_clip e move_clip, chamar fail('trilha travada — destrave antes') quando travado(f).
3. move_clip continua recusando destino travado, como já faz.
4. Em duplicate_clip, falhar quando não houver trackId válido e a trilha de origem estiver travada (a cópia cairia nela), ou redirecionar via pickTrack.
5. Em remove_track, falhar se a trilha estiver travada.
6. No edit-system.md, avisar que clipes de trilha com locked:true não podem ser alterados, e que só se usa update_track {locked:false} antes quando o usuário pedir explicitamente para mexer nela.
7. Adicionar teste (ex.: em lib/ai/ai.test.ts) com trilha travada cobrindo as 5 ops, mais duplicate sem trackId. | Em `sanitizeOp` (`validate.ts`), fazer `clipOf` devolver `{clip, track}` (já devolve) e criar um helper `editable(f)` que falha com 'clipe/trilha travado' quando `f.track.locked || f.clip.locked`. Usar esse helper em `update_clip` (trocar a checagem atual, que só olha `clip.locked`), `remove_clip`, `move_clip`, `split_clip` e `trim_clip`. Em `duplicate_clip`, quando o destino padrão for a própria trilha travada, cair numa trilha destravada do mesmo tipo, como faz o `pickTrack`, ou descartar a op. Em `remove_track`, falhar se `t.locked`. Opcional: no `applyLive`, pular essas mesmas ops em trilha travada, porque macros da biblioteca (`expandLibraryOp`) não passam por `sanitizeOp`. No `edit-system.md`, adicionar uma linha: "trilhas/clipes com `locked: true` não podem ser alterados/removidos; se o pedido exigir, peça para o usuário destravar". Adicionar ao `ai.test.ts` um teste com trilha travada cobrindo as 5 ops.

## 8. [baixa] Com o histórico cheio (100 passos), os lotes de uma execução da IA não viram 1 passo de desfazer

- **Arquivo:** `web/lib/ai/pipeline.ts:126`

**Cenário:** Depois de uma sessão longa (cada arraste/slider gera um passo, então past chega a 100), o usuário roda a 1ª edição ou 'Aplicar este estilo' (cor + chat), que aplicam 2 ou mais lotes. Como `past` fica preso em 100, a condição `s.past.length >= pastBefore.length + 2` é falsa e nada é unificado. Um Ctrl+Z desfaz só o último lote (testado: depois de 1 undo o aspecto 16:9 da IA continuou).

**Correção proposta:** Achar o ponto por identidade: `const i = s.past.lastIndexOf(projectBefore); if (s.project !== projectBefore && s.project.id === projectBefore.id && i >= 0 && i < s.past.length - 1) setState({ past: s.past.slice(0, i + 1), future: [] })`.

**Correção refinada pelo verificador:** Em withSingleUndo (pipeline.ts:124-128), achar o ponto de corte pela identidade do projeto em vez de comparar tamanhos:
```ts
const s = store();
const i = s.past.lastIndexOf(projectBefore);
if (s.project !== projectBefore && s.project.id === projectBefore.id && i >= 0 && i < s.past.length - 1) {
  useEditor.setState({ past: s.past.slice(0, i + 1), future: [] });
}
```
Isso funciona com o histórico abaixo ou no limite. Se projectBefore já tiver saído do histórico, i fica -1 e nada muda. Vale um teste em ops/store com 100 passos prévios mais 3 lotes, conferindo que um undo volta exatamente ao projeto de antes. | Em withSingleUndo (pipeline.ts:124-129), localizar o ponto de corte pela identidade do projeto anterior em vez de comparar tamanhos:

```ts
const s = store();
const i = s.past.lastIndexOf(projectBefore);
if (s.project !== projectBefore && s.project.id === projectBefore.id && i >= 0 && i < s.past.length - 1) {
  useEditor.setState({ past: s.past.slice(0, i + 1), future: [] });
}
```

Funciona com o histórico no limite. Exemplo com past = [p3..p100, B0, B1]: i = 98, o corte vira [p3..p100, B0] e um undo volta a B0. Também cobre o caso em que um lote foi cancelado no meio (cancelLive já empurrou B0). Se a execução tiver mais de 100 lotes e B0 tiver sido descartado (i = -1), nada é feito. Vale um teste em ops/store com past pré-carregado com 100 snapshots.
