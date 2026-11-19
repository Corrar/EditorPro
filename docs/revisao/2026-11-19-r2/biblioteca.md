# Revisão de código r2 — área biblioteca

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Revisei o checkout atual (2ed083b; a branch já passou de 3090724, e os arquivos de texto, fontes e emoji são idênticos aos de /home/user/ep-int). O servidor :3100 está servindo um build quebrado (chunks estáticos dão 404), então os testes no navegador rodaram contra o :3101 (mesmo código nos arquivos da área). Scripts de reprodução em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/biblioteca/ (fontcache.js, churn.js, emoji2.js, cap.test.ts, tpl.test.ts).

Riscos que não virei bug:
- ensureFontLoaded marca done mesmo em timeout (6 s + 4 s) e nunca tenta de novo. Em rede lenta o export pode começar com a fonte reserva e trocar no meio do vídeo.
- A aparência 'minimal' carrega o peso fontWeight||800, mas desenha min(…,600). É caso de borda.
- O catálogo não injeta faces itálicas (ital) no Google Fonts, então o itálico é sintético (ex.: 'Título elegante').
- ctx.roundRect é usado sem polyfill (quebra no iOS 15 e anteriores).
- As miniaturas do TemplateTile medem o texto antes de a fonte carregar e não recalculam a geometria (só o recorte).
- As contagens de busca do hub não consideram as pílulas Favoritos/Recentes nem o modo/slot do AnimationPicker. searchFonts não separa as palavras da busca, ao contrário de matchesQuery.
- 'Nenhuma' na saída grava undefined, o que no engine significa esmaecer por padrão (comportamento consistente com o TextTab).
- O mapa de emoji tem falso positivo 'ia' (verbo ir) → 🤖.
- No SfxList, dois toques rápidos tocam duas prévias e uma delas não pode ser parada.

## 1. [alta] Texto parado fica na fonte reserva depois que a fonte carrega (cache de bitmap) e isso também vai para o export HD/Rascunho

- **Arquivo:** `web/lib/engine/textDraw.ts:427`

**Cenário:** requestFont() (web/lib/engine/fonts.ts:64) devolve true quando document.fonts.check() dá true. O check() também dá true quando a família ainda não tem nenhum @font-face, ou seja, quando o CSS do Google Fonts ainda não foi injetado ou carregado. Com fontReady=true, drawTextClip guarda em textCache um bitmap desenhado com a fonte reserva. A chave [raw, style, W, H, ...] não muda quando a fonte termina de carregar. O onReady redesenha, mas cai no cache e continua mostrando a reserva. Reproduzido no Playwright (/dev/library, servidor :3101) com um texto em 'Bangers' e o CSS da fonte atrasado: depois do load a largura medida passou de 696 para 818 px, mas o renderFrame seguinte saiu idêntico ao primeiro (hit no cache). Só depois de textCacheStats.clear() o desenho mudou. Caminhos reais: (a) escolher a fonte no <select> do painel (TextTab/FONTS) com o playhead no meio do texto; (b) a IA troca a fontFamily; (c) reabrir um projeto salvo, porque nada pré-carrega as fontes do projeto. O título aparece em Poppins/system com o preview parado e troca de fonte na entrada e na saída. No desktop o preview tem 720×1280 (PREVIEW_MAX_SHORT=720), igual ao export 'hd' (exportSize 720p); em aparelho fraco é 540, igual ao 'draft'. Como os dois têm W*H ≤ 1,6M, o export usa o mesmo textCache com a mesma chave: o vídeo exportado sai com o título na fonte reserva nos quadros parados e na fonte certa na entrada e na saída.

**Correção proposta:** Não confiar no check(). Em requestFont, devolver true só se done.has(key) ou se houver um FontFace dessa família/peso com status 'loaded'. Além disso, invalidar o cache quando uma fonte termina de carregar: incrementar um fontEpoch em ensureFontLoaded e no evento document.fonts 'loadingdone' e pôr esse valor na chave do cache (ou chamar textCache.clear()). Opcional: carregar projectFonts(p) ao abrir o projeto.

**Correção refinada pelo verificador:** Em web/lib/engine/fonts.ts:
- Exportar um `fontEpoch` que ensureFontLoaded incrementa depois de `done.add(k)` (antes de `assetEvents.onReady()`).
- Fazer requestFont devolver true só quando `done.has(key)` ou quando houver em document.fonts um FontFace daquela família e peso com status 'loaded'. Não confiar em check() quando a família não tem nenhum FontFace.

Em web/lib/engine/textDraw.ts:428:
- Pôr o `fontEpoch` na chave do cache: `JSON.stringify([raw, style, W, H, fontEpoch, ...])`. A alternativa é chamar textCache.clear() quando a fonte carrega.
- Com isso, o bitmap feito com a fonte reserva deixa de valer tanto no preview quanto no export 540p/720p.

Opcional: chamar ensureProjectFonts ao abrir ou restaurar um projeto e quando a IA aplica ops que mudam a fontFamily. | Em web/lib/engine/fonts.ts:
- Criar um `export let fontEpoch = 0`.
- Incrementar esse valor no fim de ensureFontLoaded, junto do done.add, e também num listener de document.fonts 'loadingdone' (registrado uma vez).
- Exportar `fontLoaded(family, weight, italic)`, que devolve done.has(key(...)).

Em web/lib/engine/textDraw.ts:427:
- Usar o bitmap do cache só se fontLoaded(...) der true, ou se a família for GENERIC ou do sistema. Assim, o check() otimista continua servindo para desenhar direto, mas não para guardar bitmap.
- Pôr fontEpoch na chave: JSON.stringify([fontEpoch, raw, style, W, H, ...]). Uma alternativa é chamar textCache.clear() quando o epoch mudar.

Isso também resolve o export, porque ensureProjectFonts incrementa o epoch antes do primeiro quadro.

Opcional: ao hidratar ou abrir um projeto, chamar ensureProjectFonts(p) para não piscar a fonte reserva.

## 2. [alta] Encurtar uma legenda (início/fim) não muda o que aparece quando o segmento tem palavras com tempo

- **Arquivo:** `web/lib/engine/captions.ts:73`

**Cenário:** segmentWords usa seg.words sem recortar em [seg.start, seg.end], e chunkCaptions usa segEnd = max(seg.end, fim da última palavra). Os puxadores cap-start/cap-end da timeline (Timeline.tsx:849/851) e os campos Início/Fim do CaptionsTab mudam só start/end e mantêm words. Todas as legendas do Whisper têm words. Teste: segmento com 6 palavras de 0,5 s e fim puxado para 1,5 s. chunkCaptions devolve [[0,1.5,'a b c'],[1.5,3,'d e f']] e a legenda continua visível até 3 s. Com o início puxado para 2 s, 'a b c' ainda aparece a partir de 0. Na timeline o bloco fica mais curto, mas o preview e o export mostram a legenda no tempo antigo, por cima do conteúdo seguinte.

**Correção proposta:** Em chunkCaptions/segmentWords, descartar as palavras fora de [seg.start, seg.end], limitar start/end de cada palavra a esses limites e usar segEnd = seg.end. Como alternativa (ou em conjunto), a timeline e o CaptionsTab podem recortar ou ajustar seg.words ao mudar start/end.

**Correção refinada pelo verificador:** Corrigir na hora de desenhar, em `chunkCaptions`/`segmentWords`, sem mudar as palavras gravadas. A função `remove_words` usa os tempos e ids das palavras para cortar a mídia, então esses dados não devem ser alterados.

1. Se a primeira palavra começa antes de `seg.start` ou a última termina depois de `seg.end`, mapear os tempos de forma linear de [`w0.start`, `wN.end`] para [`seg.start`, `seg.end`]. Assim o texto inteiro continua aparecendo, igual ao rótulo da timeline e ao SRT, só que dentro do novo intervalo.
2. Usar `segEnd = seg.end`, em vez de `max(seg.end, fim da última palavra)`.
3. Prender o início do primeiro bloco em `seg.start`.

Só descartar as palavras fora do intervalo, como o achado propõe, apagaria do vídeo palavras que o bloco da timeline e o SRT ainda mostram.

Outra opção: na timeline (`cap-start`/`cap-end`) e nos campos Início/Fim do CaptionsTab, mandar no patch as palavras reescaladas para o novo intervalo. O `cap-move` já faz algo parecido ao deslocar as palavras. | Corrigir no motor, em segmentWords/chunkCaptions. Quando o segmento tem words, ficar só com as palavras que tocam o intervalo (w.end > seg.start && w.start < seg.end) e limitar cada uma a start = max(w.start, seg.start), end = min(max(w.end, w.start), seg.end). Se o recorte deixar a lista vazia, cair na distribuição proporcional pelo texto. Na linha 73, usar segEnd = seg.end. Hoje o max(seg.end, ...) só protege segmentos em que a última palavra passa do fim, e os segmentos montados a partir das palavras já têm end = fim da última palavra. Como complemento opcional, a Timeline (cap-start/cap-end) e o CaptionsTab (Início/Fim) podem recortar seg.words no mesmo patch, para o SRT/FCPXML e a IA (summary.ts usa os tempos das palavras) verem o mesmo intervalo. Vale incluir um teste em captions.test.ts para fim e início puxados para dentro.

## 3. [media] Emoji quebrados nas animações letra a letra, no texto curvo e no typewriter (code points em vez de grafemas)

- **Arquivo:** `web/lib/engine/textUnits.ts:327`

**Cenário:** charOffsets usa [...w].length. O drawBlock separa as letras com [...text] (textDraw.ts:318 no modo char, :281 no texto curvo), conta as unidades com [...w] (:377, :509) e o typewriter faz text.slice(0, charsLeft) em UTF-16 (:265). Emoji com VS16 (❤️, ⚠️), tom de pele (👍🏽), ZWJ (👨‍👩‍👧) e bandeiras (🇧🇷) são desenhados em pedaços. Medido no Playwright: o texto 'Amei ❤️' com 'fade' tem 28.494 px vermelhos; com 'char-fade', 0 px vermelhos (vira coração monocromático na cor do texto). Em canvas, 🇧🇷 separado vira duas letras-símbolo e 👍🏽 vira polegar + quadrado de cor. Afeta modelos com char-typewriter/char-fade/char-pop (ex.: o de comentário, onde o usuário digita 'Amei ❤️') e textos com curve. No typewriter de bloco, a fatia pode cortar um par substituto e mostrar um glifo inválido.

**Correção proposta:** Separar em grafemas com Intl.Segmenter(undefined, {granularity:'grapheme'}), com fallback para [...s], num helper compartilhado. Usar esse helper em charOffsets, na contagem de unidades (textDraw 377/509), no laço letra a letra e no curvo. No typewriter, contar e fatiar por grafema (totalChars inclusive).

**Correção refinada pelo verificador:** Add a shared helper in lib/engine/textUnits.ts:
`const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null; export const graphemes = (s: string): string[] => seg ? Array.from(seg.segment(s), (x) => x.segment) : [...s];`
Create the Segmenter once at module level, not on every frame.

Use it in these places:
- charOffsets (textUnits.ts:133): `acc += graphemes(w).length`.
- textUnits count (textDraw.ts:377) and drawCaptions starts (textDraw.ts:509).
- The curved loop (textDraw.ts:281): `for (const ch of graphemes(text))`.
- The letter-by-letter loop (textDraw.ts:318): `const chars = graphemes(text)`.

For the block typewriter, count graphemes on both sides:
- In drawTextClip, pass `graphemes(raw.replace(/\s+/g, ' ')).length` as totalChars.
- At textDraw.ts:264-266, replace the slice and decrement with: `const g = graphemes(w.text); if (g.length > charsLeft) text = g.slice(0, charsLeft).join(''); charsLeft -= g.length + 1;`

Add a test in textUnits.test.ts: `charOffsets(['Amei','❤️','🇧🇷'])` should equal `[0, 4, 5]` and the count should be 6. With the current code it returns `[0, 4, 6]` and a count of 8. | 1. Create a shared helper, for example in web/lib/engine/textUnits.ts:
   `const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;`
   `export const graphemes = (s: string): string[] => seg ? Array.from(seg.segment(s), (x) => x.segment) : [...s];`
   Create the Segmenter only once, not on every frame.

2. Use the helper in every place that splits or counts letters, so indices and counts stay consistent:
   - charOffsets (textUnits.ts:133)
   - count in textUnits() (textDraw.ts:377)
   - starts in drawCaptions (textDraw.ts:509)
   - the letter-by-letter loop (textDraw.ts:318; the acc measurement at :332 keeps working with joined graphemes)
   - curved text (textDraw.ts:281)

3. Fix the block typewriter:
   - Compute totalChars by graphemes: `graphemes(raw.replace(/\s+/g,' ')).length` at textDraw.ts:412.
   - At :264-266, slice with `graphemes(w.text).slice(0, charsLeft).join('')` and decrement `charsLeft -= graphemes(w.text).length + 1`.
   - Do the same for visibleChars in captions (textDraw.ts:502), which uses w.length.

4. Add a test in textUnits.test.ts: `charOffsets(['Amei','❤️','🇧🇷'])` should return `[0,4,5]`.
