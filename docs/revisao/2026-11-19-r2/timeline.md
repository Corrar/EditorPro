# Revisão de código r2 — área timeline

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Ambiente: o servidor em :3100 está desatualizado. O HTML aponta para webpack-bd1aded…js, que não existe mais porque /home/user/ep-int/web/.next foi refeito por outra sessão, então páginas novas não carregam. Não matei esse servidor. Subi um servidor temporário meu em :3107, a partir de /home/user/ep-int/web, com DASH_PASSWORD=demo. Lá os arquivos de timeline, store, ops e o harness são idênticos aos do 3090724. Já desliguei esse servidor. Os scripts e testes de reprodução estão em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/timeline/ (t1–t7.js e *.test.ts). Riscos não confirmados: (1) No Android, um toque longo sem movimento dispara contextmenu nativo por volta de 500 ms. O onContextMenu não olha pointerType, então pode reabrir o menu sem a flag touch ou abrir o menu no meio do arraste por toque longo do modo centro. (2) Se a janela perde o foco durante um arraste com mouse, o pointerup pode não chegar. O gesto fica ativo e o clique seguinte confirma o arraste. (3) No modo centro, as ferramentas de trim só funcionam pelas alças de toque: arrastar o miolo do clipe selecionado faz rolagem nativa e dispara pointercancel. (4) Esc durante um Shift+arraste na régua deixa um range de largura zero na tela. (5) detachAudio com vários vídeos que se sobrepõem no tempo calcula placeClip contra o mesmo projeto e pode empilhar os áudios na mesma trilha. (6) TrackPop e o cabeçalho compacto são código morto, porque compact sempre implica center. A lógica de subir/descer dele também falharia com trilhas de áudio intercaladas. Não achei dispatch por pointermove que encha o histórico nem listener vazando: os gestos fazem um único commit no fim e limpam window listeners e rAF no endGesture e no unmount.

## 1. [alta] Trilha magnética (ligada por padrão) desloca o vídeo mas deixa o áudio vinculado parado: A/V fora de sincronia

- **Arquivo:** `web/lib/timeline/actions.ts:35`

**Cenário:** Trilha principal com V1 (0–4 s) e V2 (4–10 s). Em V2 foi usado 'Separar áudio', que cria um áudio vinculado A2 em 4 s. Basta excluir V1, aparar o início de V2 ou soltar/inserir um clipe antes dele: withMagnet acrescenta packOps(after) só para a trilha principal. Reproduzido com vitest: depois de excluir V1, V2 vai para 0 s e A2 continua em 4 s (4 s de atraso). Ao aparar 1 s do início de V2, o vídeo fica em start=4/in=6 e o áudio em start=5/in=6. No Playwright, arrastar o último vídeo vinculado 2 s para a direita moveu o áudio para 12,5 s, mas o ímã devolveu o vídeo para 10,5 s. O mesmo vale para ',' e '.' (nudge) e para os ramos magnéticos em Timeline.tsx:805 (mover) e :1324 (soltar mídia).

**Correção proposta:** Num helper comum, comparar o start de cada clipe da trilha principal antes e depois do packOps. Para cada clipe deslocado por Δ que tenha linkId, gerar move_clip dos parceiros vinculados em outras trilhas com o mesmo Δ, pulando os que já estão nas ops. Chamar esse helper em withMagnet e nos dois ramos magnéticos do Timeline.tsx.

**Correção refinada pelo verificador:** Criar um helper syncLinkedAfterPack(p, ops) em lib/timeline/actions.ts (ou edit.ts):
1. Aplicar as ops do usuário e guardar a posição de cada clipe da trilha principal nesse estado intermediário (mid).
2. Aplicar as ops do packOps e guardar a posição final.
3. Para cada clipe da trilha principal com linkId e deslocamento Δ ≠ 0, acrescentar move_clip para os parceiros com o mesmo linkId em outras trilhas destravadas, com start igual à posição do parceiro em mid + Δ.

Detalhes que importam:
- O Δ precisa ser medido contra o estado depois das ops do usuário, não contra o projeto original. É assim que o caso do arraste devolve o áudio junto quando o ímã reempacota o vídeo.
- Pular parceiros que estejam na própria trilha principal ou que já sejam reposicionados pelo packOps.

Usar o helper em três lugares: withMagnet, no ramo magnético do Timeline.tsx:802-805 e no de soltar mídia em :1321-1324. Assim o nudge (, e .), excluir, aparar e colar também ficam cobertos.

Adicionar um teste em timeline.test.ts: detachAudio em V2, excluir V1 com o ímã ligado, e conferir que o start do áudio é igual ao start de V2 e que o in de um bate com o do outro. | A correção proposta tem uma falha: ela pede para pular os parceiros "que já estão nas ops". No arraste de um vídeo vinculado, o áudio já está nas ops (movido +Δ), e o pack devolve só o vídeo (−Δ). Se pular o áudio, ele continua fora de sincronia.

Correção sugerida, dentro do próprio `withMagnet`, que é por onde passam todos os commits (actions.ts):
1. Sejam `next` o projeto depois das ops do usuário e `packed` o projeto depois de `[...ops, ...packOps(after)]`.
2. Para cada clipe c da trilha principal com `linkId`, calcule Δ = start(c em packed) − start(c em next).
3. Para cada parceiro com o mesmo `linkId` em outra trilha, emita `move_clip` para start(parceiro em next) + Δ. Isso vale mesmo que o parceiro já esteja nas ops, porque as ops são aplicadas em sequência.
4. Cada parceiro recebe uma única op de compensação.
5. Ignore parceiros em trilha travada.
6. Se o destino sobrepuser outro clipe na trilha de áudio, use `placeClip` ou `insertOps` na trilha do parceiro.

Faça os ramos magnéticos de Timeline.tsx:802-805 e :1321-1324 passarem pelo mesmo helper. Hoje o arraste e a soltura de mídia montam o pack à mão antes do `commitOps`.

Cubra com testes os três casos: excluir o clipe anterior, aparar o início e arrastar o vídeo vinculado.

## 2. [alta] Cortar clipe vinculado mantém o mesmo linkId em todos os pedaços: excluir o trecho do meio apaga o clipe inteiro e o áudio

- **Arquivo:** `web/lib/timeline/edit.ts:128`

**Cenário:** Usar 'Separar áudio' num vídeo de 10 s. Clicar nele (a seleção inclui o áudio por expandLinks) e dividir em 3 s e em 6 s (S, Ctrl+B ou lâmina). split_clip copia o linkId para as duas metades, então os 6 pedaços ficam com o mesmo link. Clicar no trecho do meio seleciona os 6 pedaços e Delete remove tudo (confirmado com vitest: sobra []). Arrastar o pedaço do meio arrasta o clipe todo. Afeta também bladeCut (Timeline.tsx:1027), splitAllOps (trim.ts:174) e os splits de insertOps/overwriteOps.

**Correção proposta:** Ao gerar split_clip para clipes vinculados, dar às metades direitas de um mesmo grupo de link um linkId novo, mapeando linkAntigo para linkNovo por corte. Aplicar com update_clip {linkId} logo após os split_clip, no mesmo lote de ops. Assim cada segmento fica vinculado só ao seu par, como no DaVinci.

**Correção refinada pelo verificador:** Concordo com a correção proposta. Um helper único na timeline evita repetir a lógica: `relinkSplitOps(p, splitOps: EditOp[]): EditOp[]` agrupa os `split_clip` pelo `linkId` do clipe original e acrescenta, para cada grupo, um `{ op: 'update_clip', clipId: newId, patch: { linkId: uid('link') } }` em cada metade direita (o mesmo link novo para todas as metades direitas do grupo). Esse helper deve ser usado em `splitOps`, `splitAllOps`, `bladeCut` e nos splits de insert/overwrite, sempre no mesmo dispatch, para que um só Ctrl+Z desfaça tudo. Isso mantém o contrato (`split_clip` não muda, e o `newId` determinístico continua valendo para replay e IA). Se o parceiro vinculado não cruzar o ponto de corte (offset de J/L-cut), ele continua ligado à metade esquerda, o que é aceitável. Faltam testes: dividir um par vinculado e conferir que `expandLinks` do pedaço do meio devolve só os 2 clipes desse trecho. | Correção no próprio `splitClipValue` (ops.ts:191), que cobre todos os chamadores, inclusive as ops da IA, e é determinística no replay ao vivo. Se `c.linkId` existir, a metade direita recebe um `linkId` derivado do vínculo antigo e do instante do corte, por exemplo `right.linkId = c.linkId + '~' + Math.round(at * 1000).toString(36)`. Os parceiros vinculados cortados no mesmo `at` (lâmina, S/Ctrl+B com seleção expandida, `splitAllOps`) ficam com o mesmo vínculo novo, e cada segmento continua ligado só ao seu par. A mudança é aditiva: nenhum campo novo, só o valor do `linkId` da metade direita. Precisa de um teste em `ops.test.ts`. Se o corte for só de um lado (Alt), a metade direita fica sem par, o que equivale a desvincular, e isso é aceitável. Alternativa sem tocar no contrato: nos chamadores (`splitOps`, `bladeCut`, `splitAllOps`, `insertOps`/`overwriteOps`), montar um mapa `linkAntigo -> uid('link')` por instante de corte e emitir `update_clip { linkId }` para cada `newId` no mesmo lote, logo depois dos `split_clip`.

## 3. [media] Duplicar e colar herdam linkId/groupId do original: a cópia continua presa ao original

- **Arquivo:** `web/lib/timeline/edit.ts:155`

**Cenário:** Com um vídeo e seu áudio vinculado, clicar no vídeo (seleciona os 2) e usar Ctrl+D. As cópias recebem o mesmo linkId (duplicate_clip copia o clipe inteiro). Clicar depois no original seleciona 4 clipes e Delete apaga originais e cópias (confirmado com vitest). Do mesmo jeito, pasteOps (linha 374) mantém o groupId: um texto de modelo colado é selecionado, movido e excluído junto com o modelo original. O mesmo acontece ao duplicar um único membro do grupo (Alt).

**Correção proposta:** Em duplicateOps e pasteOps, remapear linkId e groupId por lote (velho para novo, gerado com uid). Pares copiados juntos continuam vinculados só entre si. Membro duplicado sozinho deve perder o groupId. Para duplicateOps, usar update_clip depois de duplicate_clip, como já faz duplicateWithGroups. Para pasteOps, ajustar o clone.

**Correção refinada pelo verificador:** Remapear linkId e groupId por lote, nas duas funções.

- duplicateOps (edit.ts:146): manter um `Map<velho,novo>` para linkId e outro para groupId, criados com `uid('link')`/`uid('grp')`. Depois de cada `duplicate_clip`, emitir `{ op:'update_clip', clipId:newId, patch:{ linkId: mapL(c.linkId), groupId: ... } }`, como duplicateWithGroups já faz. Se só 1 clipe daquele linkId foi copiado, gravar `linkId: undefined`. O membro de grupo duplicado sozinho (seleção com Alt) recebe `groupId: undefined`, porque grupos inteiros já são tratados à parte em duplicateWithGroups. Atenção: duplicateOps aplica as ops em sequência com applyLocal. Aplique também o update_clip, ou calcule o patch a partir do clipe de origem.

- pasteOps (edit.ts:374): aplicar no clone o mesmo remapeamento por lote, `clip.linkId = mapL.get(...)` e `clip.groupId = mapG.get(...)`, gerados uma vez por colagem. Assim, cada colagem cria vínculo e grupo novos, que valem só entre as cópias. Se só um membro do vínculo ou do grupo foi copiado, remover o campo.

- Acrescentar testes em timeline.test.ts: (a) duplicar um par vinculado; (b) colar duas vezes o mesmo grupo e conferir que expandLinks/expandGroups do original não incluem as cópias.

Relacionado, fora deste relato: split_clip/sliceClip também mantém o linkId nas duas metades. Depois da lâmina num par vinculado, os 4 pedaços ficam no mesmo vínculo. Vale aplicar a mesma ideia à metade direita, se esse for o comportamento DaVinci desejado. | Remap the ids once per operation, using a shared map. Ctrl+D, copy and paste are all affected.

1. In duplicateWithGroups, create `linkMap = new Map<Id, Id>()`. When a linkId occurs 2 or more times in the batch, map it to uid('link'). When it occurs only once (an Alt duplicate of a single member), map it to undefined so the copy comes out unlinked. Pass the map to duplicateOps.
2. After every duplicate_clip whose original has a linkId, both in the whole-group block and in duplicateOps, emit `{ op: 'update_clip', clipId: newId, patch: { linkId: linkMap.get(orig.linkId) } }`. The whole-group block already does the same thing for groupId.
3. For groupId in duplicateOps (a group member duplicated on its own): patch `groupId: undefined`. This keeps the copy from joining the template.
4. In pasteOps, build the same maps from `items` before the loop. A linkId or groupId present 2 or more times in the batch gets a new uid. One present only once gets undefined. Apply the result to the clone: `clip.linkId = map(...)`, `clip.groupId = map(...)`.
5. Add tests:
   - Ctrl+D on a linked pair: expandLinks(original) still returns only the original 2 clips.
   - Pasting a whole template creates a new groupId, and expandGroups on the original does not include the pasted clips.
   - Pasting a single member gives a clip without linkId or groupId.

## 4. [media] Duplicar um modelo (grupo) coloca as cópias por cima de clipes existentes

- **Arquivo:** `web/lib/timeline/edit.ts:537`

**Cenário:** Modelo 'Lower third' com forma em 8–11,4 s na trilha de stickers, texto em 8,2–11,2 s e um sticker em 12–14,5 s na mesma trilha. Ctrl+D no grupo cria a cópia da forma em c.start+offset = 11,4–14,8 s sem checar ocupação, sobrepondo o sticker (confirmado com vitest). Clipes sobrepostos na mesma trilha quebram trimBounds, nearestFreeStart e o clique, que acerta só o de cima.

**Correção proposta:** Escolher um offset em que todas as cópias cabem: começar em g1-g0 e avançar até overlaps() ser falso em todas as trilhas destino. Se não houver espaço, mandar a cópia para uma trilha nova ou usar insertOps.

**Correção refinada pelo verificador:** Em duplicateWithGroups (web/lib/timeline/edit.ts:530-540), calcular um offset comum em que todas as cópias cabem:
- Candidatos: base = g1 - g0, mais, para cada cópia c e cada clipe b fora do grupo na trilha de destino de c, clipEnd(b) - c.start, desde que seja >= base.
- Ordenar os candidatos e pegar o primeiro em que, para toda cópia c, !overlaps(trilha(c), c.start + off, c.duration) vale.

Outra opção, para manter o modelo logo após o original: se houver choque em alguma trilha, mandar as cópias daquela trilha de origem para uma trilha nova do mesmo tipo, como o pasteOps já faz com placeClip e o mapa `created`, ou reutilizar templateTracks(p, g0+off, g1+off, needs).

Adicionar um teste em timeline.test.ts: modelo + clipe logo após o modelo na mesma trilha, duplicar o grupo, e conferir que nenhuma cópia sobrepõe clipe fora do grupo. | Em duplicateWithGroups, escolher para cada grupo o menor offset ≥ (g1 - g0) em que nenhuma cópia sobreponha clipes já existentes nas trilhas de destino.

Passos:
1. Montar a lista de candidatos:
   cand = [g1 - g0, ...cs.flatMap(c => findClip(proj, c.id)!.track.clips.map(o => clipEnd(o) - c.start))].filter(d => d >= g1 - g0 - EPS).sort((a, b) => a - b)
2. Pegar o primeiro d tal que cs.every(c => !overlaps(trackDe(c), c.start + d, c.duration)).
3. Isso sempre termina: depois do fim do último clipe de cada trilha a posição está livre.

Aplicar as ops em sequência sobre um projeto local, como duplicateOps já faz com `proj = applyLocal(proj, op)`. Assim:
- vários grupos não colidem entre si;
- os clipes avulsos (`rest`) são calculados sobre `proj` e não sobre o `p` original, senão também podem cair em cima das cópias do grupo.

Alternativa: se o primeiro d livre ficar longe demais, mandar as cópias para trilhas novas com add_track, como templateTracks faz.

Vale acrescentar um teste em timeline.test.ts com um sticker logo depois do grupo na mesma trilha.

## 5. [media] Lâmina no celular (modo centro) corta o clipe quando o dedo só queria rolar a timeline

- **Arquivo:** `web/components/timeline/Timeline.tsx:1079`

**Cenário:** No celular, escolher 'Lâmina' no menu ⋯ e arrastar o dedo começando em cima de um clipe para navegar no tempo. bladeCut roda já no pointerdown, antes da lógica de toque. Com touch real via CDP no Pixel 7, a timeline rolou (scroll 255→393) e o clipe foi dividido (16→17 clipes, +1 desfazer) a cada tentativa de rolar.

**Correção proposta:** Para pointerType touch ou pen, iniciar um gesto 'tap' com o alvo da lâmina e cortar só no pointerup se não houve movimento nem pointercancel. Com mouse, manter o corte no pointerdown.

**Correção refinada pelo verificador:** Em Timeline.tsx:1079, cortar já no pointerdown só quando for mouse. Com toque ou caneta, guardar o alvo e cortar no fim do gesto, aproveitando o gesto 'tap' que já existe: applyMove já marca moved quando passa do TOUCH_SLOP, e o pointercancel da rolagem nativa chama endGesture(false). Concretamente: (1) no tipo da linha 68, acrescentar ao 'tap' o campo opcional blade?: { clipId: Id; t: Seconds; alt: boolean }; (2) na linha 1079: if (clipEl && tool === 'blade') { if (touch) { beginGesture({ kind: 'tap', x0: x, y0: y, moved: false, blade: { clipId: clipEl.dataset.clipId!, t, alt: e.altKey } }, e); return; } e.preventDefault(); bladeCut(...); return; }, sem chamar preventDefault nem iniciar long-press no caso de toque; (3) em endGesture, no ramo g.kind === 'tap' (perto da linha 879), depois de if (g.moved) return;, colocar if (g.blade) { bladeCut(g.blade.clipId, g.blade.t, g.blade.alt); return; }, antes da lógica de seleção. Como endGesture(false) no pointercancel não chega nesse ramo de confirmação, rolar a timeline nunca corta, e o toque parado continua cortando. | Em onTracksPointerDown, quando clipEl existe e tool==='blade': se e.pointerType for 'touch' ou 'pen', chamar beginGesture({ kind: 'tap', x0: x, y0: y, moved: false, blade: { clipId, t, alt: e.altKey } }, e) e retornar. Para isso, acrescentar o campo opcional `blade?: { clipId: Id; t: Seconds; alt: boolean }` ao tipo do gesto 'tap' (linha 68). Em endGesture, no ramo 'tap', se !g.moved && g.blade, chamar bladeCut(g.blade.clipId, g.blade.t, g.blade.alt) e retornar. O pointercancel, disparado quando a rolagem nativa começa, cai em endGesture(false) e não corta. O mover além de TOUCH_SLOP marca moved e também não corta. A pinça precisa cancelar o tap quando entrar o segundo dedo, o que já acontece se o zoom gesture limpar o gesto atual. Com mouse, manter o corte imediato no pointerdown.

## 6. [media] Texto digitado no popover de marcador/comentário se perde ao clicar outro marcador

- **Arquivo:** `web/components/timeline/Timeline.tsx:856`

**Cenário:** Abrir o comentário cm_1, digitar 'TEXTO NOVO' e clicar outro marcador na régua. useOutsideClose ignora [data-marker-id], então close/save não roda. O endGesture troca markerPop.id e o efeito de Markers.tsx:123 sobrescreve o texto com o label do novo marcador. Confirmado no Playwright: o label de cm_1 continuou o antigo.

**Correção proposta:** Salvar antes de trocar de marcador. Opções: no MarkerPop, guardar o texto pendente num ref e despachar update_marker do marcador anterior quando pop.id mudar (cleanup do efeito); ou, no endGesture do marcador, fechar o popover atual com save antes de abrir o novo.

**Correção refinada pelo verificador:** Correção mínima: em Markers.tsx:128, ignorar apenas o marcador que já está aberto: `useOutsideClose(!!pop, ref, close, pop ? `[data-marker-id="${pop.id}"]` : undefined)`. Assim, clicar ou arrastar outro marcador dispara close(), que salva A e zera markerPop no pointerdown em captura, antes de o endGesture abrir B. O efeito [marker?.id] então carrega o label de B normalmente.

Alternativa mais robusta, que cobre também outras trocas de markerPop (ex.: atalho M/C com o popover aberto): guardar o texto num ref (textRef.current = text) e salvar o marcador anterior no cleanup do efeito de troca de id: `useEffect(() => { const id = marker?.id; setText(marker?.label ?? ''); return () => { const st = useEditor.getState(); const m = id && st.project.markers?.find(x => x.id === id); if (m && textRef.current !== (m.label ?? '')) st.dispatch({ op: 'update_marker', markerId: id, patch: { label: textRef.current } }); }; }, [marker?.id])`. Esse cleanup não despacha nada depois de um close() normal (o label já é igual ao texto) nem depois de Remover (o marcador já não existe). | Salvar o texto pendente do marcador anterior dentro do próprio MarkerPop, que é quem guarda esse texto. Em Markers.tsx:

```tsx
const pending = useRef<{ id?: string; text: string; orig: string }>({ text: '', orig: '' });
pending.current = { id: marker?.id, text, orig: marker?.label ?? '' };
useEffect(() => {
  setText(marker?.label ?? '');
  return () => {
    const p = pending.current; // valores do marcador que está saindo
    const still = p.id && useEditor.getState().project.markers?.some((m) => m.id === p.id);
    if (still && p.text !== p.orig) useEditor.getState().dispatch({ op: 'update_marker', markerId: p.id!, patch: { label: p.text } });
  };
}, [marker?.id]);
```

Ponto delicado: no cleanup o ref ainda tem os valores do render anterior, mas pode ter sido sobrescrito no render novo, antes de o cleanup rodar. Por isso é mais seguro gravar o snapshot num ref separado só no onChange (`lastEdit.current = { id: marker.id, text }`) e, no cleanup, comparar com o label atual do store.

Alternativa mais simples: no handler de useOutsideClose, ignorar só o marcador que já está aberto. Se o alvo for `[data-marker-id]` com id diferente de `pop.id`, chamar `close()`, que salva e fecha; o pointerup reabre no marcador novo. Nos dois casos, conferir que o marcador ainda existe antes do update_marker, para não despachar depois de "Remover".

## 7. [media] Toque rápido abre o menu de contexto 450 ms depois (timer de toque longo órfão)

- **Arquivo:** `web/components/timeline/Timeline.tsx:1102`

**Cenário:** startLongPress é chamado antes dos returns da linha 1113 (clipe/trilha travados) e da linha 1124 (ferramenta de trim inválida). Nesses casos nenhum gesto é criado, então o pointerup não cancela o timer. Confirmado com touch via CDP: (a) iPad, um toque rápido num clipe selecionado de trilha travada abre o menu 700 ms depois; (b) celular, com a ferramenta Roll, tocar num clipe selecionado sem vizinho mostra o toast e em seguida abre o menu.

**Correção proposta:** Chamar startLongPress só depois de beginGesture. Nos ramos que retornam sem gesto, chamar cancelLongPress() ou iniciar um gesto 'tap' para que o soltar cancele o timer.

**Correção refinada pelo verificador:** Nos dois returns sem gesto (linha 1113, travado; linha 1124, ferramenta pro sem sessão), não deixar o timer órfão.

Caminho mais simples: chamar cancelLongPress() antes do toast da linha 1123. Ali o toast já explica o que houve, não precisa de menu.

No ramo travado, se a ideia é manter o toque longo de verdade abrindo o menu (útil para destravar), registrar um ouvinte de uma vez só que cancela no soltar:
`const stop = () => { cancelLongPress(); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); }; window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);`

Também dá para iniciar um gesto neutro, que só cancela o timer no endGesture. Não usar o 'tap' com clipId, porque o endGesture de 'tap' troca a seleção por expandGroups([id]) e perderia os parceiros vinculados (expandLinks).

Outra opção: mover o startLongPress da linha 1102 para depois desses returns e tratar o caso travado à parte. | The most robust fix is inside `startLongPress` and `startLongDrag`: when the timer is armed, also register a one-shot window listener for `pointerup` and `pointercancel` that calls `cancelLongPress()`. Remove it in `cancelLongPress` or when the timer fires. That way the timer no longer depends on a gesture existing, and every early return is covered, including future ones.

A local alternative is to call `cancelLongPress()` before the `return` at line 1124 (invalid tool) and in the locked branch at line 1113.

Do not turn the locked case into a 'tap' gesture with `clipId`. On release, the tap commit (around line 880) re-selects using only `expandGroups` and would drop the linked clips from the selection.

## 8. [media] No toque, a seleção ignora o vínculo: Excluir ou Dividir no celular deixa o áudio vinculado para trás

- **Arquivo:** `web/components/timeline/Timeline.tsx:882`

**Cenário:** O clique do mouse seleciona expandLinks(expandGroups(id)), mas o toque (linha 882), o toque longo (960) e o botão direito (1256) usam só expandGroups. iPad, com c_v1 vinculado ao áudio c_n1: o toque seleciona ['c_v1'] e Delete remove só o vídeo, deixando o áudio tocando. No desktop, o clique seleciona os dois e Delete remove os dois (comparado no Playwright).

**Correção proposta:** Usar expandLinks(p, expandGroups(p, [id])) também no tap, no toque longo e no onContextMenu, como no clique. Com Alt, manter só o clipe.

**Correção refinada pelo verificador:** Em Timeline.tsx, trocar a expansão em três pontos:
- **Linha 882:** usar `st.select(expandLinks(st.project, expandGroups(st.project, [g.clipId])))`.
- **Linha 960:** usar `st.select(expandLinks(st.project, expandGroups(st.project, [target.clipId])))`.
- **Linha 1256:** usar `st.select(e.altKey ? [id] : expandLinks(st.project, expandGroups(st.project, [id])))`.

Assim, o tap seguido do toque longo para arrastar no modo centro (linha 983) também passa a mover o par vinculado. Opcionalmente, como defesa extra, `removeClips` e `splitAtPlayhead` podem expandir vínculos quando a seleção vem de toque. A correção mínima são os três `select` acima. | Em Timeline.tsx, trocar:
- linha 882: `st.select(expandLinks(st.project, expandGroups(st.project, [g.clipId])));`
- linha 960: `st.select(expandLinks(st.project, expandGroups(st.project, [target.clipId])))`
- linha 1256: `st.select(e.altKey ? [id] : expandLinks(st.project, expandGroups(st.project, [id])))`

expandLinks parte de `new Set(ids)`, então os clipes do grupo vêm primeiro e os vinculados entram depois. Assim, `selection[0]` (que o MobileToolbar usa para escolher as ferramentas) continua sendo o que é hoje. Opcional: em `detachAudio`, deixar o vídeo e o áudio novo selecionados, como `toggleLink` já faz.

## 9. [baixa] Setas, Home e End param de funcionar depois de clicar nos botões de ferramenta da barra

- **Arquivo:** `web/components/timeline/useShortcuts.ts:57`

**Cenário:** Clicar em 'Seleção' ou 'Lâmina' na barra (Toolbar.tsx:342-343, botões role="radio"): o foco fica no botão. isNavControl trata role radio como dono das setas e o atalho retorna, mas os botões não implementam setas. No Playwright, depois do clique, 2× ArrowRight e End não mudaram o playhead (2,033 → 2,033).

**Correção proposta:** Não tratar <button role="radio"> da timeline como controle de navegação. Restringir isNavControl a input range, select, slider e listbox, ou implementar setas roving no grupo. Alternativa: tirar o foco do botão de ferramenta após o clique.

**Correção refinada pelo verificador:** Make isNavControl treat role="radio" as owning the arrows only when it actually implements them: for example, return true for 'radio' only if the element is not a BUTTON, or if the radiogroup has a data attribute such as data-roving. Simplest version: in useShortcuts.ts:35, take 'radio' (and 'tab', if there are no tablists with arrow navigation) out of the list and keep slider, spinbutton, listbox, option and the menuitems. Native input type=range/radio and SELECT stay covered by the tagName checks. Alternative: add roving arrow-key navigation (ArrowLeft/Right moves the check within the group) to the timeline toolbar's radiogroup at Toolbar.tsx:337-340 and the other groups. Calling blur() after the click works around it but makes keyboard navigation worse. | Em isNavControl (useShortcuts.ts:35), tirar 'radio' da lista, e de preferência 'tab' também, já que nenhum radiogroup/tablist do app tem navegação por setas. Deixar só o que de fato usa setas: SELECT, input range, role slider/spinbutton/listbox/option, e os menuitem*, que vivem em popovers que se fecham. Se no futuro algum grupo ganhar setas próprias, marcar com data-arrow-nav e testar el.closest('[data-arrow-nav]'). Alternativa local: chamar e.currentTarget.blur() no onClick dos botões de ferramenta em Toolbar.tsx:338-340.

## 10. [baixa] 'Selecionar trecho na régua' não funciona no celular (modo centro)

- **Arquivo:** `web/components/timeline/Timeline.tsx:1220`

**Cenário:** A opção aparece no menu ⋯ do celular (MoreItems com center), mas onScrubStart retorna logo no início para toque no modo centro, antes de olhar rangeMode, e o CSS do modo centro deixa a régua com pan-x. No Pixel 7 com rangeMode=true, arrastar na régua só rolou a timeline (range=null). 'Perguntar à IA sobre o trecho', 'Comentar trecho' e 'Cortar trecho' ficam inacessíveis no celular.

**Correção proposta:** No modo centro com rangeMode ligado, tratar o toque na régua como gesto 'range' e aplicar touch-action:none na .ep-tl-scale nesse estado, por exemplo com uma classe. Ou esconder a opção no modo centro.

**Correção refinada pelo verificador:** Em Timeline.tsx:1220, só sair cedo quando o modo de trecho estiver desligado: `if (dimsRef.current.center && e.pointerType !== 'mouse' && !useTimelineUi.getState().rangeMode && !(e.target as HTMLElement).closest('[data-marker-id]')) return;`. Também expor `rangeMode` no `className` do `.ep-tl` (ex.: `${rangeMode ? ' ranging' : ''}`, lendo `useTimelineUi((s) => s.rangeMode)`) e adicionar em timeline.css `.ep-tl.center.ranging .ep-tl-scale { touch-action: none; cursor: crosshair; }`. Sem isso o navegador dispara `pointercancel` e rola em vez de selecionar. Alternativa mínima: esconder o item "Selecionar trecho na régua" quando `center && coarse`. | Em Timeline.tsx, linha 1220, consultar rangeMode antes do retorno antecipado:

`if (dimsRef.current.center && e.pointerType !== 'mouse' && !useTimelineUi.getState().rangeMode && !(e.target as HTMLElement).closest('[data-marker-id]')) return;`

Também é preciso trocar o touch-action, porque ele vale no pointerdown e o navegador já teria tomado o gesto para rolar:
- no className do .ep-tl (linha 1341), acrescentar `${rangeMode ? ' rangemode' : ''}`, lendo `const rangeMode = useTimelineUi((s) => s.rangeMode)`;
- em timeline.css, adicionar `.ep-tl.center.rangemode .ep-tl-scale { touch-action: none; cursor: crosshair; }`.

Como a opção é ligada pelo menu antes do toque, a classe já está aplicada quando o dedo encosta. Se não quiser suportar isso, a alternativa é esconder o item em MoreItems quando `center` for verdadeiro.

## 11. [baixa] 'Ajustar à tela' no celular joga o playhead para 0 e pausa

- **Arquivo:** `web/components/timeline/Timeline.tsx:393`

**Cenário:** No modo centro, fit() faz setZoom e depois, no rAF, scrollLeft=0. O onScroll do modo centro interpreta isso como rolagem do usuário e faz setPlayhead(0) e setPlaying(false). No Pixel 7, com o playhead em 8 s, 'Ajustar à tela' levou o playhead para 0.

**Correção proposta:** No modo centro, não zerar o scrollLeft: o useLayoutEffect de zoom já chama placeCenter(playhead). Usar o scrollLeft=0 só fora do modo centro.

**Correção refinada pelo verificador:** Em fit() (Timeline.tsx:393), só zerar a rolagem fora do modo centro: `if (!dimsRef.current.center) requestAnimationFrame(() => (el.scrollLeft = 0));`. No modo centro não precisa de mais nada: o useLayoutEffect de [zoom] já chama placeCenter(playhead). Com o zoom de fitZoom(d, clientWidth/2 - 24), a timeline inteira cabe dos dois lados do playhead central, então ela fica toda visível sem mexer no cursor. Se o zoom não mudar, a timeline também já está ajustada e centrada. | In fit(), only reset scrollLeft outside centre mode. In centre mode, keep the playhead and centre the view after the new zoom:

const fit = useCallback(() => {
  const el = scrollRef.current; if (!el) return;
  const st = useEditor.getState();
  st.setZoom(fitZoom(projectDuration(st.project), el.clientWidth - hw() - 24, ZMIN, ZMAX));
  if (dimsRef.current.center) { requestAnimationFrame(() => placeCenter(useEditor.getState().playhead)); return; }
  requestAnimationFrame(() => (el.scrollLeft = 0));
}, []);

placeCenter sets progScroll, so onScroll ignores the scroll. Calling it again in the rAF covers the case where the zoom does not change and the useLayoutEffect([zoom]) does not run.

## 12. [baixa] Ripple na ponta inicial de texto/imagem não estende o clipe quando o novo início ficaria antes de 0

- **Arquivo:** `web/lib/timeline/trim.ts:46`

**Cenário:** rippleRange dá min=-Infinity para clipe sem mídia, mas rippleTrimOps devolve [] se c.start-delta<0. Uma imagem ou texto em 0 s (caso comum: 1º clipe da trilha) com Ripple na metade esquerda, arrastada para a esquerda, não faz nada. Para um clipe em 1 s, passar de 1 s faz a prévia voltar ao original e nada é aplicado (vitest: d=-1,5 gera 0 ops).

**Correção proposta:** Remover o guard: o move_clip seguinte devolve o clipe ao start original e o trim_clip já aceita esticar. Alternativa: limitar a faixa (min = -c.start) em vez de devolver [].

**Correção refinada pelo verificador:** Delete line 46 of web/lib/timeline/trim.ts (`if (edge === 'start' && c.start - delta < -EPS && !hasMedia(c)) return [];`). The trim_clip start that follows, then move_clip back to c.start (lines 51-52), already handles the temporary negative start, the same way it does for video and audio. Shifting keyframes by delta in trim_clip stays consistent with the case that already works. Add a test in trim.test.ts: a text clip at 0 s with 2 s duration and a neighbour at 2 s; rippleTrimOps(p,'t1','start',-1.5) should give t1 = 0 s / 3.5 s and the neighbour at 3.5 s. Clamping the range to min=-c.start would only stop the preview jump. The clip at 0 s would still not extend, so that alternative is worse. | Remover a linha 46 de web/lib/timeline/trim.ts (`if (edge === 'start' && c.start - delta < -EPS && !hasMedia(c)) return [];`). O par trim_clip(start = c.start - delta) seguido de move_clip(start = c.start) já devolve o clipe à posição original, e o trim_clip aceita o start intermediário negativo: testado, sem erros, duração e seguintes corretos. Se a ideia for mesmo manter o limite "t >= 0 virtual", o certo é deixar isso na faixa, não no build: em rippleRange, usar `back = hasMedia(c) ? c.in / sp(c) : c.start` para que o arraste pare no limite em vez de voltar ao original. Assim, porém, um texto em 0 s continuaria sem poder ser estendido pela cabeça. Em qualquer caso, vale um teste em trim.test.ts com um texto em 0 s e com d além de c.start.
