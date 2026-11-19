# Revisão de código r2 — área cor

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Confirmei os 9 achados assim: (1) ColorPanel real empacotado com esbuild e rodado no Chromium/Playwright (scripts em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/cor/t1.js…t6.js), porque o servidor em :3100 está respondendo 400 em /_next/static e não deu para usar; (2) vitest ad-hoc no mesmo diretório. Riscos vistos que não viraram bug: parseCube não limita o tamanho do arquivo (um 129³ tem ~60 MB e um arquivo errado enorme pode estourar a memória no celular); .cube do Resolve com shaper 1D+3D no mesmo arquivo seria lido errado; `failed=true` no ColorGrader é permanente (uma falha passageira de getContext deixa a sessão no fallback CSS); o <video> oculto do useClipFrame pode não carregar no iOS sem play() (não confirmado); a falha de escrita no IndexedDB das LUTs é silenciosa (toast de sucesso e a LUT some ao recarregar). O CPU×GPU do shader está coerente (mesma sequência, atlas com centro de texel correto, curvas Fritsch–Carlson ok). O contrato de desfazer (start/move/end) dos controles está correto: um arraste vira um desfazer.

## 1. [alta] Segurar 'Original' derruba o editor inteiro (React #185: Maximum update depth) quando o painel re-renderiza

- **Arquivo:** `web/components/color/ColorPanel.tsx:60`

**Cenário:** O efeito `useEffect(() => () => { if (holding) holdEnd(); })` não tem array de dependências, então a limpeza roda a cada render e não só ao desmontar. O render seguinte ao holdStart chama holdEnd (a grade volta) e faz dispatch no zustand de dentro da limpeza. O re-render síncrono do useSyncExternalStore acontece antes do setHolding(null), então cada render chama holdEnd de novo e o loop não termina. Reproduzi com o ColorPanel real (esbuild + Chromium, React dev e prod), em 3 casos. (1) Aba Curvas ou Escopos, vídeo pausado: segurar 'Original' por menos de 1 s gera 'Minified React error #185' e o root fica vazio. Basta o loop de escopos de 200 ms. (2) Aba Básico: segurar 'Original' e mudar o playhead (tocar o vídeo ou arrastar a agulha) dá o mesmo erro. (3) Como não há error boundary (nem app/error.tsx), o editor inteiro vira 'Application error'. Mesmo quando não trava, o 'Original' já solta no primeiro re-render.

**Correção proposta:** Guardar o estado do 'segurar' num ref e restaurar só ao desmontar, por exemplo: `const holdRef = useRef(holding); holdRef.current = holding; useEffect(() => () => { const h = holdRef.current; if (h) useEditor.getState().dispatch({op:'update_clip', clipId:h.id, patch:{colorGrade:h.g}}, {history:false}); }, []);`. Tirar o efeito sem dependências. Vale envolver o ColorTool num error boundary.

**Correção refinada pelo verificador:** Tirar o efeito sem dependências e restaurar só ao desmontar, via ref: `const holdRef = useRef(holding); holdRef.current = holding; useEffect(() => () => { const h = holdRef.current; if (h) useEditor.getState().dispatch({ op: 'update_clip', clipId: h.id, patch: { colorGrade: h.g } }, { history: false }); }, []);`. Também convém restaurar quando o clipe selecionado mudar durante o hold, num efeito com dependência [clip?.id] que também lê o ref. Opcionalmente, envolver o painel de Cor num error boundary. | Guardar o hold num ref, restaurar só ao desmontar e deixar holdStart/holdEnd lendo do ref:

const holdRef = useRef<{id:string; g?:ColorGrade}|null>(null);
holdStart: `if (!clip || holdRef.current) return; holdRef.current = {id:clip.id, g:clip.colorGrade}; setHolding(holdRef.current); dispatch(...undefined...)`
holdEnd: `const h = holdRef.current; if (!h) return; holdRef.current = null; setHolding(null); dispatch({op:'update_clip', clipId:h.id, patch:{colorGrade:h.g}}, {history:false})`
`useEffect(() => () => { const h = holdRef.current; if (h) { holdRef.current = null; useEditor.getState().dispatch({op:'update_clip', clipId:h.id, patch:{colorGrade:h.g}}, {history:false}); } }, []);`

O ref também evita que pointerup, lostpointercapture e keyup chamem holdEnd duas vezes. Vale ainda envolver o ColorTool num error boundary.

## 2. [alta] Modo 'Dividir' (antes/depois) entra no vídeo exportado

- **Arquivo:** `web/lib/color/index.ts:65`

**Cenário:** gradeLayer aplica `compare.split`, que é estado global do módulo, em todo render, e o export usa o mesmo renderFrame → drawLayer → gradeLayer. No desktop, o painel Cor (ColorTool) continua montado com o diálogo de export aberto, então o split só seria desligado ao desmontar o painel. Passos: ligar 'Dividir' no painel Cor e clicar em Exportar. O MP4 sai com a metade esquerda de cada clipe (e da camada de ajuste) sem correção. Confirmei: o mesmo renderFrame deu pixel esquerdo [200,60,60] (original) e direito [90,90,90] (corrigido) com o split ligado, e [90,90,90] nos dois lados com ele desligado.

**Correção proposta:** Tirar o split do caminho do export. Opções: o renderFrame/gradeLayer recebe um flag `preview` (ou `opts.offline`) e só o preview aplica o compare. Ou o export chama `setCompare({mode:'off'})` no início e restaura no fim. Ou o ColorPanel desliga o split ao receber 'ep:open-export'.

**Correção refinada pelo verificador:** Tirar o compare do caminho do export, e não depender do ciclo de vida da UI. Dar um parâmetro opcional ao `gradeLayer` (por exemplo `opts?: { preview?: boolean }`) e só aplicar split/bypass quando `preview` for true. `renderFrame`/`drawLayer` repassam um flag que o Preview liga e que lib/export/video.ts e extras.ts deixam desligado. Alternativa mínima: no início do export (video.ts e extras.ts), guardar `getCompare()`, chamar `setCompare({ mode: 'off' })` e restaurar o valor no `finally`. Atenção: o modo 'bypass' tem o mesmo problema (sai sem correção nenhuma) e deve ser tratado igual. Pelo mesmo motivo, `gradeNeedsCanvas` também não deveria olhar o compare fora do preview. | Passar o modo de render até `gradeLayer`. Hoje `drawLayer` já recebe `{ offline: media.offline }` (`web/lib/engine/index.ts`, linhas 69-77). Basta repassar esse flag: `gradeLayer(src, grade, w, h, { offline: opts.offline })`. Dentro de `gradeLayer`, ignorar `compare` quando `offline` for verdadeiro: sem split e sem bypass. Antes, conferir que o pool do export (`mediaPool`/`decodePool`) define `offline: true`.

Isso corrige também o export de quadro/miniatura em `extras.ts`, sem depender de evento de UI. Já desligar o compare quando o painel recebe `ep:open-export` deixaria de fora outros caminhos de export.

## 3. [media] Arrastar 'Intensidade da correção' até 0% apaga a grade inteira (e o look some com intensidade 0)

- **Arquivo:** `web/lib/color/grade.ts:119`

**Cenário:** normalizeGrade devolve undefined quando a grade fica neutra, e isNeutralGrade trata mix≤ε como neutra. No meio do arraste do slider de mistura, ao encostar em 0% (o slider prende em min=0 na borda), o writeGrade grava colorGrade: undefined. Ao voltar para 100% no mesmo gesto, o `set` parte de {} e a correção (curvas, rodas, HSL…) não volta. Confirmei na UI real: {saturation:-0.5, contrast:0.2} virou null em 0% e ficou null de volta em 100%; só o desfazer recupera. O mesmo vale para 'Intensidade do look' (linha 115, `if (i > EPS) out.lut`): em 0 a LUT sai da grade, o slider desmonta debaixo do dedo e não dá para subir de novo.

**Correção proposta:** Não tratar mix=0 nem intensidade=0 como 'apagar'. Opções: normalizeGrade preserva os parâmetros quando só o mix/intensidade é 0 (guardar mix:0 / lut.intensity:0 e deixar isNeutralGrade decidir só o processamento). Ou os sliders usam min=0,01. Ou o painel guarda o valor de base durante o gesto.

**Correção refinada pelo verificador:** Separar 'normalizar para salvar' de 'é neutro para processar'. No normalizeGrade, calcular a neutralidade sem considerar mix (por exemplo, um isNeutralGrade(out, {ignoreMix:true}) ou testar com {...out, mix: undefined}) e manter out.mix=0 quando houver outros parâmetros. Assim isNeutralGrade continua dizendo 'não processa' no preview e no export, mas a grade fica salva. Para a LUT, gravar out.lut = {id, intensity: i} também quando i=0 (basta ter id válido; o isNeutralGrade já ignora LUT com intensity ≤ EPS na linha 62). Com isso o slider do look continua montado (cur segue definido) e voltar para 100% restaura tudo. Vale também um teste: normalizeGrade({saturation:-0.5, mix:0}) deve preservar saturation e mix:0, e normalizeGrade({lut:{id:'x',intensity:0}}) deve preservar a LUT. | A correção mais simples e central fica em lib/color/grade.ts. O normalizeGrade deve apagar a grade só pelos próprios parâmetros e nunca pelo mix ou pela intensidade. Calcule a neutralidade sem olhar o mix, por exemplo `isNeutralGrade({...out, mix: 1})`, e guarde `out.mix = 0` quando mix < 1-EPS (já é feito). Para a LUT, guarde `{id, intensity: i}` também com i=0. O motor de render já trata mix≤EPS e intensity≤EPS como sem processamento via isNeutralGrade, então o custo não muda. Opcionalmente, o useGradeEditor pode guardar a grade do 'start' do gesto e aplicar fn sobre ela, o que impede perdas parecidas em outros controles. Inclua testes: normalizeGrade({saturation:-0.5, mix:0}) mantém a saturação, e lut.intensity 0 mantém o id.

## 4. [media] Mexer no anel mestre (ou no disco) de uma roda reescreve r/g/b e muda o brilho e a cor

- **Arquivo:** `web/components/color/Wheels.tsx:128`

**Cenário:** O jog grava `wheelFromPuck(x, y, j.last)` e o disco grava `wheelFromPuck(nx, ny, master)` (linha 73), com x,y vindos de puckFromWheel. Esse caminho joga fora a parte de luminância de r/g/b e reescala croma acima de WHEEL_RANGE. A IA (sanitizeColorGrade aceita r,g,b livres em −1..1), a colagem e o JSON gravam rodas assim. Exemplo: gain {r:0.1,g:0.05,b:-0.05}. Ao tocar o anel mestre e mover 0,01, a roda vira {r:0.047,g:-0.003,b:-0.103,y:0.01} e um cinza 0,8 cai de [224,214,194] para [216,205,185]: a imagem escurece e muda de cor por um ajuste que deveria ser só de luminância. b=0.6 vira b=0.557 com r e g negativos.

**Correção proposta:** No jog, mudar só `y`: `write({ ...(wheel ?? NEUTRAL_WHEEL), y: m }, phase)`. No disco e no teclado, somar de volta a luminância original: calcular Y0 = 0.2126r+0.7152g+0.0722b da roda atual e gravar {r: r'+Y0, g: g'+Y0, b: b'+Y0, y}.

**Correção refinada pelo verificador:** No mestre (jog com ponteiro nas linhas 128/134/136, teclado na 143 e duplo toque resetMaster na 36), trocar só y e manter r/g/b exatamente como estão: `write({ ...(wheel ?? NEUTRAL_WHEEL), y: m }, phase)`. No disco (linhas 73 e 91), preservar a luminância e o croma acima do limite que o puck não representa. Uma forma é guardar no pointerdown a roda original w0 e o puck p0 = puckFromWheel(w0), e gravar w0 + (wheelFromPuck(nx,ny) − wheelFromPuck(p0.x,p0.y)) por canal, com clamp em −1..1 e y = master. A outra é somar Y0 de volta: {r: r'+Y0, g: g'+Y0, b: b'+Y0, y: master}. resetColor (linha 35) pode zerar só o croma mantendo Y0, ou zerar tudo, como já faz o botão Restaurar. | Jog (linhas 128/134/136/143) e resetMaster (36): mudar só y, sem recalcular r/g/b: write({ ...(wheel ?? {r:0,g:0,b:0,y:0}), y: m }, phase). Disco (73/91) e resetColor (35): somar de volta a luminância original. Calcular Y0 = 0.2126r+0.7152g+0.0722b da roda atual (guardar no drag.current no pointerdown) e gravar {r: w.r+Y0, g: w.g+Y0, b: w.b+Y0, y: master}, com clamp em -1..1. Assim mexer no disco muda só o croma e o brilho que a IA definiu fica preservado.

## 5. [media] Abas Curvas/Escopos re-renderizam o painel 5×/s para sempre, mesmo parado (bateria no celular)

- **Arquivo:** `web/components/color/Scopes.tsx:85`

**Cenário:** useScopes depende de `frame` e `grade`. useClipFrame devolve `{ canvas, version }` novo a cada render (useClipFrame.ts:130), e `grade` é `clip.colorGrade ?? {}`. Cada setData re-renderiza o painel, gera um objeto `frame` novo e o efeito agenda outro ciclo. Medido com o painel real e o projeto ocioso: 15 commits em 3 s nas abas Curvas e Escopos, 0 em Básico. Cada ciclo faz render WebGL, getImageData (leitura síncrona da GPU), postMessage, cálculo, re-render do ColorPanel inteiro e redesenho de 3 canvas, sem parar enquanto a aba fica aberta.

**Correção proposta:** Depender de valores estáveis: `[active, frame?.version, frame?.canvas, grade]`. Memoizar o retorno de useClipFrame com useMemo([version]) e o `grade` vazio com uma constante (`clip?.colorGrade ?? EMPTY`).

**Correção refinada pelo verificador:** Em Scopes.tsx:85, troque as dependências por `[active, frame?.version, frame?.canvas, grade]`. O efeito já captura `frame` no closure ao gravar want.current: como version e canvas identificam o quadro, use um ref (frameRef.current = frame) para ler o objeto mais recente. Outra opção é memoizar o retorno de useClipFrame com useMemo(() => ({ canvas, version }), [version, url]). Confira também se o `grade` de useGradeEditor é estável: se for `clip.colorGrade ?? {}`, use uma constante EMPTY, para que um clipe sem grade não reabra o loop por causa do objeto vazio novo. | Trocar as dependências do efeito em Scopes.tsx:85 por valores estáveis: `[active, frame?.canvas, frame?.version, grade]`. Guardar o frame atual num ref (ou montar o job com `frame!.canvas` e `version` dentro do efeito). No useClipFrame.ts:130, memoizar o retorno com useMemo pelas chaves [canvasRef.current, version, url]. No useGrade.ts:41, usar uma constante de módulo `const EMPTY: ColorGrade = {}` e escrever `clip?.colorGrade ?? EMPTY`. Assim `grade` só muda quando a grade muda de fato.

## 6. [media] Aba Looks durante a reprodução: as 16 miniaturas re-renderizam a cada quadro (~31 uploads de textura por tick)

- **Arquivo:** `web/components/color/Looks.tsx:47`

**Cenário:** useClipFrame assina `playhead` mesmo inativo (useClipFrame.ts:41), então o ColorPanel re-renderiza a cada tick do play (30 fps). O efeito de cada Thumb depende de `frame` (objeto novo a cada render) e de `grade` (= `base`, objeto novo na linha 71), por isso todas as miniaturas refazem resolveGrade, recriam o atlas da LUT (lutKey muda de miniatura para miniatura) e fazem upload, render e drawImage. Medido em 60 ticks: 1860 texImage2D e ~2,6 s de main thread na aba Looks, contra 0 uploads e 0,26 s na aba Básico. No celular isso trava a reprodução enquanto o painel de cor está aberto.

**Correção proposta:** Thumb deve depender de `frame?.version` e de uma grade memoizada (useMemo sobre o JSON normalizado). useClipFrame só deve assinar o playhead quando `active`, ou derivar `t` por seletor que só muda se o frame for buscado. De preferência, cachear a miniatura por (versão do frame, id do look, hash da grade).

**Correção refinada pelo verificador:** Três mudanças, em ordem de impacto:

1. **Thumb (Looks.tsx:47):** tirar `frame` e `grade` da lista de dependências. Usar `[frame?.version, gradeKey, id]`, com `gradeKey = JSON.stringify(normalizeGrade(base))` calculado em LooksTab via useMemo. Ler `frame` e `grade` por ref dentro do efeito.
2. **useClipFrame:** devolver o objeto memoizado por `version` (`useMemo(() => ({ canvas, version }), [version])`). Só assinar o playhead quando `active`, por exemplo com um seletor `(s) => (active ? s.playhead : 0)`.
3. **gl.ts:** cachear o atlas por LUT (WeakMap<Lut3D, atlas>), para que alternar entre LUTs não recalcule lutAtlasData a cada render. Melhor ainda: manter uma textura por LUT em vez de um único lutKey. | Correção em três partes. (1) Em useClipFrame.ts, devolver um objeto estável com `useMemo(() => url && version ? { canvas: canvasRef.current!, version } : null, [url, version])`. Assinar o playhead só quando `active` (por exemplo, `useEditor((s) => active ? s.playhead : 0)`), ou derivar só o `t` necessário para a busca. (2) Em Looks.tsx, memoizar `base` com `useMemo(() => ({ ...grade, lut: undefined }), [JSON.stringify(normalizeGrade({ ...grade, lut: undefined }))])`. Trocar as dependências do efeito do Thumb por `[frame?.version, base, id]`, sem o objeto `frame`, e envolver o Thumb em React.memo. (3) Em lib/color/gl.ts e cube.ts, cachear lutAtlasData por Lut3D num WeakMap, para não refazer o atlas em JS a cada troca de LUT entre miniaturas.

## 7. [media] Preview nativo (CSS) não bate com o export (WebGL) em grades só de exposição/contraste/saturação

- **Arquivo:** `web/lib/color/grade.ts:201`

**Cenário:** gradeCssEquivalent manda o preview nativo (hybrid.ts:101) usar `contrast(c)`, que pivota em 0,5, mas o motor pivota em DEFAULT_PIVOT=0,435. A exposição vira `brightness(k^(1/2.2))` sobre valores codificados, enquanto o motor trabalha em linear sRGB. O próprio comentário diz que só serve 'com pivô ~0,5', mas não confere. Medido com gradePixel × a fórmula CSS. contrast +0,5: o cinza 111 fica 111 no export e 103 no preview; 153 vira 174 no export e 166 no preview. contrast −0,5: diferença de +7. exposure +1: o 13 vira 34 no export e 24 no preview. Efeito: o usuário ajusta contraste no Básico, vê uma imagem e exporta outra uns 3% mais clara ou escura. Ao somar qualquer outro ajuste (temperatura, pivô), o preview troca para WebGL e a imagem 'pula'.

**Correção proposta:** Em gradeCssEquivalent, devolver null quando houver contraste ≠ 0 (pivô ≠ 0,5) ou exposição, e aceitar CSS só para saturação/mix, que batem exatamente. Ou gerar um filtro SVG (feComponentTransfer com intercept do pivô e tabela da curva sRGB) referenciado por url().

**Correção refinada pelo verificador:** Em gradeCssEquivalent (grade.ts:195), devolver null quando `n.contrast` ≠ 0 ou `n.exposure` ≠ 0. Com isso o clipe vai para o canvas/WebGL, que é idêntico ao export. Manter o CSS só para saturation/mix, que batem exatamente. Se quiser manter o contraste no nativo, use um filtro SVG inline: feComponentTransfer com type="linear", slope=c e intercept=pivot·(1−c), com color-interpolation-filters="sRGB", referenciado por url(#id). Isso reproduz o pivô de forma exata. | Em gradeCssEquivalent, devolva null quando a grade tiver contraste ≠ 0 (o CSS não consegue reproduzir o deslocamento de pivô (0,5−p)(c−1) sem um offset aditivo) e também quando tiver exposure, porque o CSS não aplica a curva sRGB linear. Mantenha CSS só para saturação/mix: `const allowed = new Set(['saturation','mix'])`. Opcionalmente, saturação pura pode continuar em CSS, mas convém conferir os coeficientes de luma contra o LUMA do motor. Se quiser manter o contraste nativo, gere um filtro SVG com feComponentTransfer (type=linear, slope=c, intercept=p(1−c)) referenciado por url(#id). Acrescente um teste: gradeCssEquivalent({contrast:0.3}) deve ser null.

## 8. [baixa] Excluir uma LUT importada: clipes que a usam continuam mostrando e exportando a LUT até serem editados ou o app recarregar

- **Arquivo:** `web/lib/color/index.ts:39`

**Cenário:** deleteImportedLut (luts.ts:251) só tira a LUT do registro, e o Looks.tsx:110 só limpa o clipe selecionado. resolvedFor guarda num WeakMap o ResolvedGrade com o Lut3D antigo e só reavalia se `!r.lut`. Assim, o clipe B, que usa a mesma LUT, continua com ela no preview e no export da sessão, enquanto a aba Looks de B avisa 'Esta LUT não está neste aparelho'. Ao mexer em qualquer slider de B, ou ao recarregar, a LUT some de repente. O export feito antes de recarregar não corresponde ao projeto salvo.

**Correção proposta:** Versionar o registro (incrementar em registerLut/deleteImportedLut), guardar a versão no ResolvedGrade e reavaliar quando mudar. Ao excluir, avisar ou limpar `lut` dos outros clipes que usam o id (com histórico).

**Correção refinada pelo verificador:** A correção mais simples: em `luts.ts`, manter um contador `lutsVersion` que aumenta em `registerLut` e em `deleteImportedLut`, e guardar no cache um par `{ r, ver }`. Em `resolvedFor`, refazer o cálculo quando `ver !== lutsVersion` e o grade tiver `lut`. Isso cobre tanto a LUT que carrega depois quanto a LUT excluída, e permite remover a condição especial `!r.lut && getLut()`.

Também convém disparar um redesenho do preview no `onLutsChanged`, para o quadro parado se atualizar na hora. Na UI, se outros clipes usarem a LUT excluída, avisar quantos são. Limpar `lut` nesses clipes via `dispatch` (com desfazer) é opcional. | Em luts.ts: manter um contador `lutRegistryVersion`, incrementado em `registerLut`, `deleteImportedLut` e quando `loadImportedLuts` registra LUTs. Exportar `lutVersion()`. Em `resolvedFor`: guardar a versão junto com o ResolvedGrade (ex.: WeakMap<ColorGrade, {v, r}>) e resolver de novo se `entry.v !== lutVersion()`. Isso cobre preview, export e o objeto devolvido pelo desfazer. Se ColorGrader/gl.ts guardar textura por Lut3D, ela é trocada naturalmente porque R.lut passa a ser null. Opcional no Looks.tsx: ao apagar, avisar quantos clipes usam a LUT, ou limpar `lut` deles num único lote com histórico.

## 9. [baixa] Fallback do worker de escopos calcula sobre um buffer já transferido (escopos vazios)

- **Arquivo:** `web/components/color/Scopes.tsx:38`

**Cenário:** scopesAsync transfere `img.data.buffer` ao worker (linha 40) e, se a resposta não chegar em 1,5 s, faz `computeScopes(img)` sobre o ImageData já destacado (length 0). Isso acontece quando o worker falha ao carregar de forma assíncrona (PWA offline sem o chunk, CSP), quando dá erro ou quando demora. Confirmado: depois da transferência, pixels=W×H, histR vazio, todo o histL no índice 0 e vetorscópio vazio. Hoje o loop de 5 fps (bug acima) mascara isso em 200 ms; corrigido o loop, os escopos ficam errados até o próximo ajuste.

**Correção proposta:** No timeout ou erro, não reutilizar `img`: guardar uma cópia antes de transferir (`const copy = img.data.slice()`) ou recalcular com gradedPixels(job). No onerror, resolver os pedidos pendentes com o cálculo local em vez de só limpar `waiting`.

**Correção refinada pelo verificador:** Não reutilizar `img` depois da transferência. A cópia é barata, porque o quadro tem no máximo 320 px de lado (cerca de 400 KB). Transferir uma cópia e guardar o resolvedor junto com a imagem, para o `onerror` responder na hora em vez de esperar 1,5 s:

```ts
const waiting = new Map<number, { img: ImageData; res: (s: ScopeData) => void; t: number }>();
// onmessage: const w = waiting.get(id); if (w) { clearTimeout(w.t); w.res(e.data.s); waiting.delete(id); }
// onerror: worker = null; for (const [id, w] of waiting) { clearTimeout(w.t); w.res(computeScopes(w.img, OPTS)); } waiting.clear();

function scopesAsync(img: ImageData) {
  const w = getWorker();
  if (!w) return Promise.resolve(computeScopes(img, OPTS));
  return new Promise<ScopeData>((res) => {
    const id = ++seq;
    const t = window.setTimeout(() => { waiting.delete(id); res(computeScopes(img, OPTS)); }, 1500);
    waiting.set(id, { img, res, t });
    const data = img.data.slice();
    w.postMessage({ id, data, width: img.width, height: img.height, opts: OPTS }, [data.buffer]);
  });
}
```

Também vale definir `worker = null` quando o timeout disparar, para não continuar mandando quadros a um worker que não responde. | Em scopesAsync, antes de transferir, guardar o necessário para o caminho de reserva. Uma opção é transferir uma cópia e manter o original: `const buf = img.data.slice(); w.postMessage({ id, data: buf, width: img.width, height: img.height, opts: OPTS }, [buf.buffer]);`. Assim, no timeout, `computeScopes(img, OPTS)` usa os dados intactos. A outra opção é fazer o fallback do timeout calcular sobre a cópia. Além disso, no `worker.onerror`, resolver na hora os pedidos pendentes com o cálculo local, em vez de só chamar `waiting.clear()`. Para isso, `waiting` precisa guardar também o ImageData (ou a cópia) de cada id. Com isso o usuário não espera 1,5 s quando o chunk falha.
