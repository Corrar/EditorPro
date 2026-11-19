# Revisão de código r2 — área fx

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Riscos que não registrei como bug:
(1) index.ts:74 usa `mixed ?? to`. Se runShaderTransition devolver null (shader não compila numa GPU, canvas 'tainted', contexto perdido naquele quadro), a transição vira corte seco para o clipe que entra, em vez do dissolver de fallback.
(2) No caminho de shader do index.ts, plain(outL) tira o role 'out'. Com isso o fadeOut do clipe que sai é aplicado além do fim dele, a opacidade dá 0, e o 'de' fica só com o fundo. No caminho CSS o fadeOut é ignorado para o role 'out', então os dois caminhos divergem.
(3) makeCanvas prefere OffscreenCanvas. No Safari 16.4–16.7, o OffscreenCanvas só tem contexto 2D (até onde sei), então glcore e engine/gl ficam sem WebGL, embora um HTMLCanvasElement funcionasse. O fallback de CPU do engine/gl ignora realces/sombras/nitidez. Vale tentar document.createElement('canvas') quando getContext('webgl') falhar.
(4) O echo-trail decai uma vez por quadro: 60 fps no preview contra 30 fps no export dá cerca de 3× mais rastro no export. Isso é documentado como não-determinístico, mas dá para corrigir usando dt.
(5) processPixels redimensiona o canvas GL a cada quadro quando um clipe com recorte tem escala animada (realocação de backbuffer; desempenho, não correção).
(6) chromatic-aberration, rgb-wave e glitch-digital juntam canais de pixels vizinhos com o alfa do pixel atual, então nas bordas transparentes saem valores pré-multiplicados inválidos (rgb > a) e aparecem franjas aditivas.
Scripts de verificação (WebGL headless, nativePlan, perda de contexto, teste de máscara, vazamento): /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/fx/

## 1. [alta] engine/gl.ts não trata perda de contexto WebGL: clipes com recorte/chroma/realces/sombras/nitidez somem de vez (preview e export)

- **Arquivo:** `web/lib/engine/gl.ts:103`

**Cenário:** No Android, o usuário edita um clipe com Recortar, Chroma key, Realces, Sombras ou Nitidez e troca de app ou bloqueia a tela. O contexto WebGL se perde, ou o Chrome descarta o contexto mais antigo ao passar de 16. Esse módulo não tem listener de 'webglcontextlost' nem confere gl.isContextLost(), e `state` continua apontando para o contexto morto. Em processPixels, texImage2D/drawArrays viram no-op sem exceção, e a função devolve o canvas vazio. O drawLayer desenha esse canvas transparente e o clipe fica INVISÍVEL no preview e em qualquer export feito depois, até recarregar a página. Testei no Chromium com WEBGL_lose_context: depois da perda, o pixel lido é [0,0,0,0], não há exceção e o contexto nunca volta, porque ninguém chama preventDefault.

**Correção proposta:** Fazer como o glcore: registrar `canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); state = undefined; })` no init. No começo de processPixels, se `gl.isContextLost()`, fazer `state = undefined` e devolver cpuFallback(...) nesse quadro; o init recria o contexto na chamada seguinte.

**Correção refinada pelo verificador:** No init(), depois de criar o contexto, registrar `(canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); state = undefined; }, false)`. No começo de processPixels, depois de `let S = init()`, conferir `if (S && S.gl.isContextLost()) { state = undefined; S = init(); }`. A segunda chamada já cria um canvas e um contexto novos, então não se perde nem um quadro. Se o novo init falhar ou o contexto novo também vier perdido (`!S || S.gl.isContextLost()`), devolver cpuFallback(src, sw, sh, w, h, p, crop) nesse quadro. O cpuFallback mantém recorte e chroma; perde só realces/sombras/nitidez, o que é melhor que o clipe sumir. Também vale tratar o retorno logo depois do drawArrays: `if (gl.isContextLost()) { state = undefined; return cpuFallback(...); }`, para não devolver o canvas vazio quando a perda acontece no meio do quadro. | Em web/lib/engine/gl.ts, seguir o padrão do glcore, sem depender do 'restored'. (a) No init(), depois de criar o contexto: `canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); state = undefined; }, false)`. (b) Em processPixels, logo depois de `const S = init()`: `if (S && S.gl.isContextLost()) { state = undefined; return cpuFallback(src, sw, sh, w, h, p, crop); }`. O fallback mantém o recorte e o chroma; realces, sombras e nitidez ficam de fora só nesse quadro, mas o clipe não some. (c) Para não criar um contexto novo a cada quadro enquanto a GPU ainda está indisponível, já que o getContext pode devolver um contexto que já nasce perdido, colocar um intervalo mínimo entre tentativas em init(). Por exemplo, guardar `lastFail = performance.now()` e, enquanto `performance.now() - lastFail < 1000`, retornar null, o que leva ao cpuFallback. O glcore tem o mesmo risco e poderia receber o mesmo ajuste.

## 2. [alta] invert / blur-gauss / rainbow marcados como native 'css' somem do preview (o export aplica)

- **Arquivo:** `web/lib/fx/catalog.ts:74`

**Cenário:** Vídeo na trilha principal só com o efeito 'Desfoque' (blur-gauss), 'Inverter' ou 'Arco-íris'. effectsNativeMode devolve 'css', então clipNeedsCanvas deixa o quadro no modo nativo. Porém o hybrid.ts não converte esses efeitos em CSS: o filtro do <video> sai como 'none'. Confirmei rodando nativePlan: {native:true, filter:'none'} para os três; o crt dá native:false. O canvas de sobreposição pula a trilha principal, então o preview mostra o vídeo SEM o efeito, e o export (renderFrame) aplica o shader. O usuário acha que o efeito não funciona e recebe um vídeo diferente do que viu. Linhas 63 (invert), 74 (blur-gauss) e 124 (rainbow).

**Correção proposta:** Trocar o `native` dos três para 'canvas'. O rainbow depende da posição do pixel e de t, então não tem equivalente em CSS. Outra opção para invert/blur-gauss: o hybrid.ts somar `invert(v)` / `blur(px)` ao filtro do <video>. Vale um teste em fx.test.ts que garanta que todo efeito 'css' que não é de geometria tem tradução CSS.

**Correção refinada pelo verificador:** Em web/lib/fx/catalog.ts, trocar o 7º campo (native) de 'css' para 'canvas' nas linhas 63, 74 e 124. A tradução para CSS não é fiel nos três casos:
- **rainbow:** depende de v_uv e u_time, então não tem equivalente em CSS.
- **blur-gauss:** é um desfoque em espiral com raio de u_int*0,035 da altura do quadro, não um blur(px) fixo.
- **invert:** só ele daria para traduzir, somando `invert(${v})` ao filtro em hybrid.ts:101. Mesmo assim, 'canvas' é a correção mínima e segura.

Junto com a troca, colocar em lib/fx/fx.test.ts uma regra simples: todo efeito com native === 'css' precisa ter render === 'geometry'. A regra vale porque o hybrid.ts só traduz para o <video> a parte de geometria dos efeitos. Assim um efeito novo não repete o problema. | Em lib/fx/catalog.ts, trocar o campo native de 'invert', 'blur-gauss' e 'rainbow' de 'css' para 'canvas'. O rainbow depende de t e o blur do shader não bate com o blur() do CSS, então o canvas é a única saída exata. Se quiser manter o invert nativo, a alternativa é o nativePlan acrescentar `invert(${intensity})` ao filtro da camada. Também vale um teste em fx.test.ts: todo efeito com native==='css' precisa ter render==='geometry' (ou tradução CSS explícita no hybrid).

## 3. [media] Transição 'luma-heart' (Coração) quebrada: pow() com base negativa dá NaN e o coração nunca abre

- **Arquivo:** `web/lib/fx/transitionShaders.ts:80`

**Cenário:** Transição 'Coração' entre dois clipes. Dentro do coração, x²+y²−1 < 0, e `pow(x2+y*y-1.,3.)` é indefinido em GLSL para base negativa (NaN em ANGLE/D3D, Metal e na maioria das GPUs). Com isso f vira NaN, `f<0.` dá falso e aparece o clipe que sai. Medi no WebGL do Chromium com A vermelho e B verde: a fração de B foi 13% / 15% / 0,3% / 0% em progresso 0,25 / 0,5 / 0,75 / 0,99. O esperado pela fórmula correta é 35% / 84% / 100% / 100%. Ou seja, quase só aparece A e no fim da transição há um corte seco para B, no preview e no export.

**Correção proposta:** Trocar o pow por multiplicação: `float b=x2+y*y-1.;float f=b*b*b-x2*y*y*y;`.

**Correção refinada pelo verificador:** Troque o pow por multiplicação, que é bem definida para base negativa: `float b=x2+y*y-1.;float f=b*b*b-x2*y*y*y;`. Testei essa troca no mesmo ambiente: o coração cresce de forma contínua até cobrir 100% do quadro, sem corte seco. Também vale procurar outros pow() de base possivelmente negativa nas transições e efeitos em shader. O uso de pow(bell(p),6.) em 'stretch' é seguro, porque bell(p) ≥ 0 para p entre 0 e 1. | In web/lib/fx/transitionShaders.ts:80, replace `float f=pow(x2+y*y-1.,3.)-x2*y*y*y;` with `float b=x2+y*y-1.;float f=b*b*b-x2*y*y*y;`. I validated this version on the same WebGL: it gives 35%/84%/100% of B at progress 0.25/0.5/0.75 and 100% at the end. It also helps to add a test in fx.test.ts that fails if `pow(` is used with a base that can be negative.

## 4. [media] Modo de mesclagem em imagem/sticker/forma de trilha overlay é ignorado no preview nativo

- **Arquivo:** `web/components/preview/hybrid.ts:80`

**Cenário:** Vídeo principal e, na overlay, um PNG/JPG (por exemplo um vazamento de luz com fundo preto, ou uma textura) com Mesclagem 'Tela', 'Multiplicar' ou 'Adicionar'. O nativePlan confere blendMode apenas nos clipes da trilha principal (clipNeedsCanvas); confirmei native:true com a imagem em 'screen'. O drawLayer compõe com 'screen' sobre o canvas de sobreposição limpo (transparente), o que equivale ao modo normal, e esse canvas é sobreposto ao <video> com source-over. No preview, o fundo preto da imagem cobre o vídeo; no export, o renderFrame mistura com o vídeo e o preto some.

**Correção proposta:** No mesmo laço, voltar para canvas se algum clipe visual ativo de outra trilha tiver `blendMode && blendMode !== 'normal'`: `return no('mesclagem')`.

**Correção refinada pelo verificador:** Em hybrid.ts, dentro do laço `for (const tr of p.tracks)` (linhas 78-82), cobrir qualquer clipe visual ativo de outra trilha que não seja a principal, e não só imagem. Mais exatamente: sticker, forma e imagem na overlay, e também vídeo, que já cai em PiP. Exemplo:

`if (tr.kind === 'overlay' && tr.clips.some((c) => t >= c.start && t < c.start + c.duration && 'blendMode' in c && c.blendMode && c.blendMode !== 'normal')) return no('mesclagem');`

Também vale um teste em hybrid.test.ts com sticker e forma na overlay usando 'screen' ou 'multiply', esperando o motivo 'mesclagem'.

Alternativa, se quiser manter o nativo: aplicar `mix-blend-mode` CSS no canvas de sobreposição. Isso só serve se houver uma única camada misturada e o modo tiver equivalente em CSS, então a volta para o canvas é mais simples e correta. | Em `nativePlan`, no laço sobre as outras trilhas (hybrid.ts, linhas 77-83), voltar para o canvas quando algum clipe visual ativo em t, em trilha não principal e visível, tiver mesclagem diferente de normal. Por exemplo, antes do `if (items.length > 2)`:
`if (tr.clips.some((c) => 'blendMode' in c && c.blendMode && c.blendMode !== 'normal' && t >= c.start && t < c.start + c.duration)) return no('mesclagem');`
Somar um caso no hybrid.test.ts: sticker/forma em trilha overlay com 'screen' deve dar 'mesclagem', e sem mesclagem deve continuar nativo.

## 5. [media] Cache de shapeCanvas cria um canvas por quadro em forma com escala animada (até 65 vivos, centenas de MB)

- **Arquivo:** `web/lib/engine/shapes.ts:42`

**Cenário:** Clipe de forma (retângulo, linha etc.) com keyframes de escala, por exemplo de 1 a 2. O drawLayer (draw.ts:95-96) chama shapeCanvas(clip, short*tf.scale*1.2) a cada quadro com um tamanho diferente. Como a chave inclui w/h, cada quadro gera um canvas novo, e o cache só é limpo depois de 65 entradas. No export 1080×1920, um retângulo tem 1296–2048 px de altura × 1,6, ou seja 10–27 MB por canvas, o que dá cerca de 0,7–1,2 GB vivos. No preview 720p são 5–19 MB cada. No iPhone isso estoura o limite total de memória de canvas do Safari: getContext('2d') devolve null, `ctx.translate` lança TypeError, o renderFrame quebra e o preview congela ou o export falha. No Android, falta memória e a aba trava.

**Correção proposta:** Quantizar o tamanho, por exemplo arredondando para cima em degraus de 2^(1/4) ou de 64 px como o emojiCanvas faz, já que a forma é escalada no drawImage. Limitar o cache por área total (LRU de ~8 entradas ou ~64 MB) em vez de 65 entradas.

**Correção refinada pelo verificador:** Em draw.ts:95, dimensionar pelo tamanho desenhado e não por short*scale*1.2. Para asp ≥ 1, alturaAlvo = (short*0.95/asp)*scale*1.1, e vale o mesmo para asp < 1, ou seja, o mesmo cálculo de dw/dh da seção "geometria".

Em shapes.ts, quantizar a altura antes de montar a chave, por exemplo h = 2^(ceil(log2(alvo)*4)/4), em degraus de cerca de 19%, ou múltiplos de 64 px como o emojiCanvas. Isso funciona porque a forma já é escalada no drawImage.

Trocar o `if (cache.size > 64) cache.clear()` por um LRU limitado por bytes, por exemplo no máximo 8 entradas ou cerca de 48 MB de w*h*4. Nele: apagar a entrada mais antiga, e opcionalmente zerar width/height do canvas removido para liberar o backing na hora, sem esperar o GC.

Opcional: deixar null-safe o `cv.getContext('2d')`. Se vier null, devolver o último canvas válido ou pular a camada, em vez de lançar TypeError no ctx.translate. | Em shapes.ts, arredondar o h para cima em degraus geométricos (por exemplo 2^(1/4), ou múltiplos de 64 como o emojiCanvas) antes de montar a chave. A forma é escalada no drawImage e o traço é proporcional a h, então a qualidade não muda, e uma animação de escala passa a reaproveitar poucos canvases. Também vale gerar o canvas no tamanho em que ele é desenhado (≈dh*1.1 em vez de short*scale*1.2). Para retângulo e linha, o canvas atual tem 2× a 10× a resolução necessária em cada dimensão. Por fim, trocar o "limpar tudo com 65 entradas" por um LRU limitado pela área total (por exemplo ~48 MB ou ~8 entradas).

## 6. [media] canvasFilterSupported() dá falso positivo sem ctx.filter, e os fallbacks do Safari nunca rodam

- **Arquivo:** `web/lib/fx/sprites.ts:42`

**Cenário:** Num navegador sem o atributo CanvasRenderingContext2D.filter (o próprio código assume que é o caso do Safari/iOS), `ctx.filter = 'blur(2px)'` cria uma propriedade avulsa no objeto, e a leitura devolve a mesma string. A função então devolve true. Testei no Chromium apagando o atributo do protótipo: detected=true e o desfoque não acontece. Com isso, no iOS: máscaras com suavização (masks.ts:135) ficam com borda dura, e cheapBlurInPlace (fundo do polaroid, fallback de desfoque dos efeitos GL) não desfoca nada. Detalhe a mais: quando o caminho por sombra (masks.ts:140-146) roda, as máscaras 'line'/'mirror' (que se estendem big=4(W+H)) vazam para a tela porque o deslocamento de 3W é menor que a forma. Medi alfa saltando de 125 para 255 exatamente na linha (borda dura de um lado).

**Correção proposta:** Detectar pelo protótipo ('filter' in CanvasRenderingContext2D.prototype / OffscreenCanvasRenderingContext2D.prototype) e confirmar com um teste de render: desfocar 1 px branco e checar alfa > 0 no vizinho. No fallback por sombra, usar um deslocamento maior que a forma, por exemplo `off = (W+H)*10` em translate(-off,0) e shadowOffsetX = off.

**Correção refinada pelo verificador:** Detectar pelo próprio contexto antes de escrever e confirmar com um render pequeno:

```ts
const ctx = makeCanvas(3,1).getContext('2d') as Ctx;
if (typeof (ctx as any).filter !== 'string' || (ctx as any).filter !== 'none') return filterSupport = false;
ctx.filter = 'blur(1px)';
ctx.fillStyle = '#fff';
ctx.fillRect(1,0,1,1);
filterSupport = ctx.getImageData(0,0,1,1).data[3] > 0;
```

Envolver tudo em try/catch, como já está. No fallback por sombra em masks.ts:140-146, usar um deslocamento maior que a forma, por exemplo `const off = (W + H) * 10; ctx.shadowOffsetX = off; ctx.translate(-off, 0);`. Isso basta porque a forma 'line'/'mirror' vai até cerca de W + 4√2(W+H). O valor do `shadowBlur` fica como está. | Correção em sprites.ts:

1. Se `!('filter' in Object.getPrototypeOf(ctx))`, devolver false.
2. Caso o atributo exista, confirmar por render, pois ele pode estar exposto e ser ignorado. Num OffscreenCanvas 8×8: `ctx.filter = 'blur(2px)'`, `ctx.fillStyle = '#fff'`, `ctx.fillRect(4, 0, 4, 8)`. Devolver true só se `getImageData(2, 4, 1, 1).data[3] > 0`.
3. Manter o cache em `filterSupport`, com try/catch devolvendo false.

Correção em masks.ts:140-146: usar um deslocamento maior que a extensão de qualquer forma, já com rotação. Por exemplo, `const off = (W + H) * 12;` com `ctx.shadowOffsetX = off; ctx.translate(-off, 0);`. A forma 'line'/'mirror' vai até 4(W+H)·√2 do centro, então a forma em si nunca cai no quadro e só a sombra desfocada aparece. Outra opção é limitar o retângulo de 'line'/'mirror' a ±(W+H)·1.5 só nesse caminho.

## 7. [media] 'Brilho deslizante', 'Granulado' e 'VHS' vazam para fora da camada (sticker/PiP/forma) e cobrem o quadro inteiro

- **Arquivo:** `web/lib/fx/effects2d.ts:263`

**Cenário:** Logo, sticker, imagem PiP ou forma com 'Brilho deslizante'. O lightSweep define 'source-atop' (linha 255), mas a linha 263 troca para 'lighter' antes de desenhar, e a faixa branca atravessa a tela inteira, sobre as trilhas de baixo. Com 'Granulado' (effects.ts:141, 'overlay' sobre o transparente) e 'VHS' (effects.ts:247, scanlines com source-over), aparece véu cinza ou listras no quadro todo. Testei uma camada 40×40 num quadro de 200×200: o light-sweep pintou cerca de 16 mil pixels fora (alfa até 111), o grain pintou todos os 38.400 pixels de fora (alfa até 48) e o vhs também. O vignette-pulse e o invert ficaram corretos (0 pixels fora).

**Correção proposta:** light-sweep: apagar a linha 263 (deixar source-atop) ou desenhar com 'lighter' num scratch e aplicar destination-in com a cópia da camada. grain/vhs em camadas de clipe: restringir ao alfa da camada, desenhando com source-atop ou fazendo destination-in com uma cópia, como applyGrade já faz com o fade.

**Correção refinada pelo verificador:** Restringir ao alfa da camada só os efeitos de categoria 'canvas'. Os de categoria 'overlay' (neve, lens flare etc.) cobrem o quadro de propósito e devem ficar como estão.

- light-sweep (effects2d.ts:263) e disco: duas opções. (a) Apagar a troca para 'lighter' e deixar 'source-atop'. (b) Manter o visual aditivo: guardar o alfa antes com copyOf(ctx, W, H, S_TMP), desenhar com 'lighter' e terminar com globalCompositeOperation = 'destination-in' + drawImage(cópia).
- film-grain e vhs (effects.ts:279 e 242-255): mesma ideia do fade em applyGrade. Guardar o alfa antes com copyOf(ctx, W, H, slot livre). Desenhar as scanlines e chamar grain() como hoje (overlay). No fim do case, aplicar 'destination-in' com a cópia. Isso mantém o visual do overlay sobre o vídeo e corta o que sai da camada. Alternativa mais barata: pôr ctx.globalCompositeOperation = 'source-atop' antes das scanlines e de grain(). O grão vira mistura normal em vez de overlay; na camada de ajuste, que é opaca, a diferença é só de aparência. | - **light-sweep:** apagar `ctx.globalCompositeOperation = 'lighter'` (effects2d.ts:263) e deixar o 'source-atop' da linha 255. Branco translúcido em source-atop clareia só o clipe.
- **film-grain:** em applySurfaceEffects, pôr `ctx.globalCompositeOperation = 'source-atop'` antes de `grain(...)`, como já faz o old-film.
- **vhs:** pôr 'source-atop' antes das scanlines, porque o grain chamado depois herda esse modo.
- **Alternativa mais robusta, que cobre também 'disco':** o disco escurece em source-atop, mas pinta os focos com 'lighter' no quadro inteiro e vaza do mesmo jeito. Em draw.ts, só na camada de clipe (não na camada de ajuste, que é opaca), guardar `copyOf(lc)` antes de applySurfaceEffects. Depois dos efeitos que não são OVERLAY_EFFECTS nem de geometria/duplicação (split, mirror e similares), aplicar `destination-in` com essa cópia, como applyGrade faz com o fade.

## 8. [media] Transições legadas usam 'precision mediump': em GPU de celular (fp16) o hash zera e o padrão some

- **Arquivo:** `web/lib/engine/shaderTransitions.ts:18`

**Cenário:** Em celulares Android com Mali/Adreno, onde mediump é fp16 de verdade, `fract(sin(dot(p,..))*43758.5453)`: todo produto ≥ 2048 só é representável como inteiro em fp16, então fract=0, o hash fica ≈0 e o fbm/vnoise vira constante. Efeitos no preview e no export feitos no celular: domain-warp (n=0) vira corte seco depois de ~8% do progresso; ridged-burn (ridged≈0,97 constante) vira um flash laranja de tela cheia no final; digital-glitch perde os blocos; swirl-vortex, thermal-distortion e cross-warp-morph perdem o padrão. As transições novas (transitionShaders.ts) já usam GLSL_PRECISION exatamente por isso.

**Correção proposta:** Em H, trocar 'precision mediump float;' por GLSL_PRECISION, importado de ../fx/glcore.

**Correção refinada pelo verificador:** Em web/lib/engine/shaderTransitions.ts, importar GLSL_PRECISION junto com fxGLAvailable/runFx de '../fx/glcore' (`import { fxGLAvailable, runFx, GLSL_PRECISION } from '../fx/glcore';`). No H, trocar 'precision mediump float;' por GLSL_PRECISION, assim: `const H = GLSL_PRECISION + 'varying vec2 v_uv;uniform sampler2D u_from, u_to;...'`. Isso pede highp quando existe GL_FRAGMENT_PRECISION_HIGH, o que vale para praticamente toda GPU móvel atual, e cai para mediump só onde não há alternativa. A chave de cache 'tr:'+kind não precisa mudar. | Em shaderTransitions.ts, adicionar GLSL_PRECISION ao import de '../fx/glcore' e definir H = GLSL_PRECISION + 'varying vec2 v_uv;uniform sampler2D u_from, u_to;uniform float u_progress;uniform vec2 u_resolution;uniform vec3 u_accent;uniform vec3 u_accent_dark;uniform vec3 u_accent_bright;\n'. O GLSL_PRECISION já termina em '\n', então as diretivas #ifdef ficam no começo de linha. Não há uniform compartilhado com o VERT, então não aparece conflito de precisão no link. As chaves de cache 'tr:'+kind continuam iguais, sem efeito colateral.

## 9. [baixa] Pixel-art / meio-tom / ASCII / contornos com tamanho em px fixo: o preview mostra blocos 1,5–2× maiores que o export

- **Arquivo:** `web/lib/fx/effectShaders.ts:161`

**Cenário:** Projeto horizontal 1920×1080 (ou quadrado). O preview renderiza a 1280×720 (960×540 em aparelho fraco, menos ainda durante a reprodução com qualidade adaptativa). No pixel-art com intensidade 0,6: cs = (3+13·0,6)·max(1, u_res.y/1080) = 10,8 px tanto no preview quanto no export, porque max(1, 0,67)=1. Isso dá 67 blocos de altura no preview contra 100 no export (1,5×; 2× em 540p), e o tamanho do bloco salta quando a qualidade cai ao dar play. O mesmo acontece no halftone (144), ascii (153), sobel/contornos/neon/cartoon/sketch (29, 132, 137, 140) e na transição mosaic.

**Correção proposta:** Escalar pelo quadro sem o piso em 1, por exemplo `float k=min(u_res.x,u_res.y)/1080.;` e cs=(…)*k (e equivalente com /720 nos que usam 720), para o tamanho relativo ser o mesmo em qualquer resolução.

**Correção refinada pelo verificador:** Tire o piso `max(1, …)` e mantenha `u_res.y` como base, em vez de trocar para `min(x,y)`. Assim o visual atual do export continua igual em FHD e no vertical, e o preview e o export HD passam a escalar na mesma proporção.

Nos shaders:
- `/1080`: troque `max(1.,u_res.y/1080.)` por `(u_res.y/1080.)` nas linhas 144 e 161 de `effectShaders.ts` e na mosaic de `transitionShaders.ts:112`.
- `/720`: troque `max(1.,u_res.y/720.)` por `(u_res.y/720.)` nas linhas 29, 132, 137, 140 e 153.

Detalhes:
- As texturas usam filtro LINEAR, então deslocamentos menores que 1 px no sobel funcionam.
- Se quiser evitar blocos menores que 1 px, use `max(cs, 1.)` no próprio `cs` em vez de pôr o piso no fator de escala.
- O `min(x,y)/1080` do relato mudaria o export vertical atual: os blocos ficariam 44% menores, porque hoje a escala é 1920/1080 e passaria a ser 1. | Tirar só o piso e manter a base em u_res.y, para não mudar o visual atual em resoluções de 1080 para cima (nem o dos projetos verticais, que hoje escalam por H/1080).

Os ajustes, por arquivo:
- pixel-art e halftone: cs = (…)*(u_res.y/1080.), com cs = max(cs, 1.) para não cair abaixo de 1 px.
- transitionShaders.ts:112 (mosaic): mix(1.,48.,bell(p))*(u_res.y/1080.).
- ascii: (…)*(u_res.y/720.).
- sobel, neon-glow, cartoon e sketch: trocar max(1.,u_res.y/720.) por (u_res.y/720.). Pode ter um piso pequeno, como max(.5, u_res.y/720.), para o Sobel não amostrar com passo de 0 px.

Usar min(u_res.x,u_res.y), como sugeriu o relatório, também deixa preview e export consistentes. Mas reduziria em cerca de 1,78× os blocos e contornos nos projetos verticais, que hoje já estão corretos.
