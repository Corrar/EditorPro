# Revisão de código r2 — área preview

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Reproduzidos no Playwright contra localhost:3100/dev/preview: o reverso congelado e o vídeo inválido/sem elemento congelando o preview (PiP durante o Play e modo nativo parado). O caso do asset sem url (blob ausente) não chegou a rodar: no meio da revisão o chunk webpack do servidor passou a responder 400, aparentemente porque alguém rebuildou o .next com o servidor no ar. Esse caso usa o mesmo caminho de código do vídeo inválido (sem elemento → present() false). O bug do governador foi confirmado com vitest avulso no scratchpad. Os dois bugs de iOS (destravamento por elemento e volume somente leitura) se baseiam na política documentada do WebKit e não dá para reproduzi-los no Chromium; o de destravamento é o menos certo. Riscos vistos que não viraram bug: unlock() cria um <video> por asset de uma vez (muitos decodificadores no Android se o projeto tiver muitos assets); no 1º toque, os elementos ativos tocam sem mudo por um instante (pequeno estalo de áudio); os livres guardam até 3 elementos por asset sem limite global; o seek externo durante a reprodução não zera `lead` no tick; o mapa `masks` de segment.ts nunca é limpo (pequeno, 256 px por clipe).

## 1. [alta] Clipe em reverso fica congelado durante a reprodução: o preview nunca desenha nenhum quadro dele

- **Arquivo:** `web/components/preview/livePool.ts:284`

**Cenário:** Clipe de vídeo com reverse:true (ex.: 4 s) e Play. A cada passo, o ramo do reverso (l.284) pede um seek novo para o quadro seguinte. seek() (l.203-209) apaga `presented` e põe settledAt = now+2000. Logo depois, a conferência da l.307 chama ready() e recebe false: no quadro em que o seek acabou de ser pedido, presented está vazio e a carência ainda não passou; nos outros quadros o elemento ainda está buscando. Resultado: pending=true em todos os passos, e o Preview (l.400) nunca chama draw(). Reproduzi no Playwright (/dev/preview, um clipe reverse de 4 s): em 3 s de reprodução STATS.draws ficou parado em 9 e held subiu 9→88. O mesmo clipe sem reverso desenha 15 quadros a cada 0,5 s. Na tela, a imagem fica parada no quadro anterior ao clipe enquanto o playhead anda, e como o canvas inteiro deixa de ser desenhado, textos, legendas e PiP desse trecho também congelam.

**Correção proposta:** Não descartar a prova de quadro em seeks curtos: em seek(), só fazer presented.delete(el) quando |to - el.currentTime| > 0.35. Assim frameReady aceita o quadro anterior, uma defasagem de 1 quadro. Outra saída: no ramo do reverso durante a reprodução, conferir ready() ANTES de pedir o novo seek, ou não marcar pending quando readyState >= 2.

**Correção refinada pelo verificador:** In the reverse branch during playback (livePool.ts:282-284), check readiness BEFORE issuing the new seek, and skip the post-seek `ready()` check at l.307 for that clip.

1. Before the seek, record `const hadFrame = el.readyState >= 2 || this.presented.has(el);`. Also keep a per-element WeakSet marking that it has already shown a frame.
2. Issue the seek as today.
3. Set `pending = true` only if `!hadFrame` and the element has never shown a frame, i.e. it is still loading for the first time.
4. At l.307, skip the check for this clip: `if (clip.type === 'video' && !(playing && reverse) && ...)`.

This works because Chrome's `drawImage` keeps drawing the last decoded frame while the element seeks, so the reverse clip advances with a lag of about one seek instead of freezing.

Alternative: in the reverse branch, only issue a new seek after drawing. Mark pending only while `el.seeking` is true and no frame has been presented yet. When the seek finishes (`!el.seeking && el.readyState >= 2`), let that tick draw and leave the next seek for the following tick. | O ramo do reverso precisa alternar entre desenhar e buscar: nunca pedir o seek no mesmo passo em que o quadro vai ser desenhado. Em livePool.ts, criar `private revDrawn = new WeakMap<AV, boolean>()` e trocar as l.282-285 por algo como:

```ts
if (playing && reverse) {
  if (!el.paused) el.pause();
  const far = Math.abs(el.currentTime - target) > 0.5 / fps;
  if (el.seeking) pending = true;                      // segura o último canvas
  else if (!this.revDrawn.get(el) && this.ready(el, el.currentTime)) this.revDrawn.set(el, true); // desenha agora o quadro buscado (1 seek de atraso)
  else if (far) { this.seek(el, target, now); this.revDrawn.set(el, false); pending = true; }
  continue; // pula a conferência genérica da l.307 para este clipe
}
```

Se o ramo tiver mais código depois, trocar o `continue` por uma flag que pule a conferência da l.307.

Alternativa: o sync devolve os seeks do reverso como "adiados", e o Preview os executa depois do draw(t). Nos dois casos, o draw sempre acontece com readyState≥2 e com o rVFC confirmado. O reverso passa a ser desenhado na taxa de seek do aparelho, em vez de ficar congelado. Como reforço, também vale pôr no tick de reprodução (Preview.tsx:400) uma saída por tempo igual à do requestStill: desenhar mesmo assim depois de N ms com pending. Assim nenhum caso futuro congela o canvas inteiro, com textos e legendas, durante a reprodução.

## 2. [alta] Vídeo que nunca fica pronto (sem decodificador, blob ausente após recarregar) congela o preview inteiro durante a reprodução

- **Arquivo:** `web/components/preview/livePool.ts:307`

**Cenário:** Um clipe ativo cujo <video> nunca chega a readyState>=2 faz pending=true para sempre (l.307). Exemplos: HEVC/HDR num Android sem suporte, caso que o próprio código prevê em onUnplayable, ou blob corrompido. Durante a reprodução, Preview.tsx:400 descarta todos os desenhos. Reproduzi com um PiP de vídeo inválido sobre um vídeo principal bom: em 2 s de Play, draws ficou parado (8→8, held 60). A captura mostra o timecode do vídeo bom parado em 00:00:00.500 com o playhead em 2,4 s, e textos/legendas também congelados. O áudio continua tocando. O pool já sabe que a fonte falhou (unplayable/el.error), mas não usa isso.

**Correção proposta:** Na conferência de pending (e no cálculo de lead), ignorar elementos com el.error, networkState === HTMLMediaElement.NETWORK_NO_SOURCE ou dataset.url em this.unplayable. Também vale limitar o tempo em que um mesmo elemento pode segurar o desenho (ex.: 1,5 s) e depois desenhar sem ele, como já é feito com o vídeo parado.

**Correção refinada pelo verificador:** 1) livePool.ts:307: não marcar pending para fonte que falhou. Criar `const failed = !!el.error || el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || this.unplayable.has(el.dataset.url ?? '')` e usar `if (clip.type === 'video' && el instanceof HTMLVideoElement && !failed && !this.ready(el, target)) pending = true`. No lead (l.293-297), com failed, não definir lead (ou definir lead=null), para o relógio não segurar 600 ms à toa.

2) livePool.ts:428 (present): uma camada nativa cujo elemento falhou não pode devolver false para sempre. Ou nativePlan/draw cai para o canvas quando o elemento da camada falhou, ou present pula a camada falha. Senão, um vídeo principal quebrado em modo nativo continua sem desenhar.

3) Preview.tsx:400, rede de segurança igual à do requestStill: guardar desde quando há pending contínuo na reprodução (por exemplo, waitSincePlayRef). Passados ~1,5–2 s, chamar draw(t) mesmo assim (o renderFrame já ignora o vídeo sem quadro). Zerar o contador quando pending voltar a ser false. | 1) livePool.ts:307: não deixar um elemento quebrado segurar o desenho. Trocar a linha por algo como: `const broken = !!el.error || this.unplayable.has(el.dataset.url ?? ''); if (clip.type === 'video' && el instanceof HTMLVideoElement && !broken && !this.ready(el, target)) pending = true;`. Na l.296, considerar o lead quebrado como não-stalled (ou não usá-lo como lead), para o relógio não fazer hold à toa.

2) livePool.present() (l.428): se o elemento de uma camada tem el.error, devolver true sem mostrá-lo, ou forçar o plano não nativo. Assim o canvas desenha o resto, em vez de retornar false para sempre.

3) Rede de segurança em Preview.tsx no tick de reprodução (l.399-400), espelhando o caminho pausado. Guardar desde quando pending/draw falso começou (ex.: waitPlayRef). Se passar de ~1,5 s, chamar draw(t) mesmo assim, ignorando o retorno, e zerar o contador quando um draw normal der certo. Isso cobre também fontes que travam sem disparar 'error'.

## 3. [alta] Modo nativo: com o elemento principal ausente ou com erro, o vídeo parado nunca é redesenhado e o canvas fica com o conteúdo antigo

- **Arquivo:** `web/components/preview/Preview.tsx:249`

**Cenário:** nativePlan (hybrid.ts) escolhe o modo nativo sem conferir se existe um elemento utilizável. Isso acontece quando o asset ficou sem url (persist/index.ts:100 quando o blob sumiu do IndexedDB, comum no iOS que limpa o armazenamento), quando a mídia foi removida ou quando ela não decodifica. Nesses casos present() devolve false para sempre (livePool.ts:428), seja porque byClip não tem o clipe, seja porque videoWidth=0. A 'rede de segurança' de 2,5 s em requestStill (l.249) só desiste de esperar: draw() continua devolvendo false antes de renderFrame, então nada é desenhado. Reproduzi com um projeto novo cujo clipe principal é um vídeo inválido mais o texto 'OLA', depois editado para 'MUDOU': draws ficou em 6 o tempo todo e a tela continuou mostrando o quadro do projeto ANTERIOR. Edições de texto e legenda ficam invisíveis.

**Correção proposta:** Dar a draw() um parâmetro force (ou cair para {native:false}) quando present() falha. No requestStill, depois do tempo limite, chamar draw(tv, true) para que pool.present receba um plano não nativo e renderFrame desenhe fundo e camadas sem o vídeo. Além disso, fazer nativePlan/present tratarem como 'canvas' o clipe principal sem elemento, ou com elemento em erro ou na lista unplayable.

**Correção refinada pelo verificador:** Fazer o modo nativo cair para o canvas quando não houver elemento utilizável, nos dois lugares:

1. **Em `draw()`:**
   - Antes de chamar `present()`, se o plano é nativo e algum `layer.clip` não tem asset com url (`st.assets[clip.assetId]?.url`), ou o url está em `pool.unplayable`, trocar o plano por `{ native:false, reason:'mídia indisponível' }`.
   - Mais geral: dar a `draw(t, force=false)` um parâmetro. Quando `present()` devolve false e `force` é true, chamar `pool.present({native:false,...})` (que esconde os <video>) e seguir com `renderFrame` completo (sem `overlayOnly`).
2. **Em `requestStill`:** quando o tempo de 2,5 s estourar (os dois ramos: `s.pending` e `!draw`), chamar `draw(tv, true)` em vez de desistir sem desenhar.
3. **Opcional:** expor no `LiveMediaPool` um `hasUsable(clipId)` (elemento presente, sem `error`, e `videoWidth` > 0 ou ainda carregando) e usá-lo para tratar o clipe principal como 'canvas'.

Teste: um projeto com asset sem url mais um texto tem que levar `renderFrame` a desenhar o texto, e uma edição de texto tem que aumentar `STATS.draws`. | Em `draw()` (Preview.tsx:186-190), trocar o plano nativo por canvas quando a camada base não tem mídia utilizável. Criar em `LiveMediaPool` um `usable(clipId)` que devolve true só se o elemento existe, não tem `error` e a url não está em `unplayable`. Também conferir `st.assets[clip.assetId]?.url`. Se alguma camada falhar, usar `plan = { native:false, reason:'mídia indisponível' }`; aí `present()` esconde os <video> e `renderFrame` desenha o fundo e as camadas sem o vídeo. Para mídia que ainda está carregando, `draw` ganha um parâmetro `force`. No `requestStill`, depois do limite de 2,5 s, chamar `draw(tv, true)`, que refaz `present` com plano não nativo. Na reprodução (l.400), aplicar o mesmo, com um limite próprio de tempo sem quadro.

## 4. [alta] iOS: elementos criados depois do destravamento tocam sem som (ou ficam pausados), porque unlock() só abençoa elementos no 1º toque

- **Arquivo:** `web/components/preview/livePool.ts:387`

**Cenário:** unlock() roda uma vez só, no 1º pointerdown da página (l.387 `if (this.unlocked) return`), e abençoa um elemento por asset que já exista naquele momento. Fluxo comum de usuário novo: o 1º toque é em 'Escolher arquivo' ou no chat, quando ainda não há mídia. Nada é abençoado, mas unlocked fica true. Todo elemento criado depois nasce com muted=false (l.104) e recebe play() a partir do rAF, fora do gesto. O togglePlay chama unlock() de novo, mas isso não faz nada. No WebKit/iOS, play() de um elemento com som exige gesto por elemento: a promessa é rejeitada (o catch engole o erro) e o vídeo fica parado no 1º quadro enquanto o playhead anda. Tirar o mudo de um elemento que tocava mudo fora do gesto (l.278) faz o WebKit pausá-lo. Isso também afeta o pré-carregamento do 2º pedaço de um mesmo asset após um split: só 1 elemento por asset foi abençoado. Não dá para reproduzir no Chromium (lá a ativação vale para a página toda), e o próprio comentário de unlock() parte dessa política do WebKit.

**Correção proposta:** Abençoar dentro de CADA gesto de play (togglePlay), e não só no 1º. Para isso, guardar um WeakSet de elementos abençoados e, no gesto, dar play()/pause() nos elementos de byClip/idle ainda não abençoados e criar 2 por asset usado (atual + pré-carga). No sync, manter mudo (muted=true) todo elemento ainda não abençoado: o vídeo pelo menos anda, e o som entra no próximo gesto.

**Correção refinada pelo verificador:** 1) Destravar a cada gesto, não só no primeiro. Ouvir pointerup, click, touchend e keydown, sem se remover depois do 1º. Chamar um bless() em togglePlay e também no botão de play da timeline (Toolbar.tsx:288) e na barra de espaço.
2) Guardar um WeakSet<AV> `blessed`. No gesto, chamar play() seguido de pause() (só se não estiver em uso) em todo elemento de byClip e de idle que ainda não estiver no conjunto. Garantir pelo menos 2 elementos abençoados por asset usado: o do clipe atual e o da pré-carga. Marcar como abençoado só quando a promessa resolver.
3) No sync (l.278) e em create() (l.104), usar `el.muted = !this.blessed.has(el) || gain<=0.0001`. O vídeo pelo menos anda mudo, e o som entra no próximo gesto. Não tirar o mudo de elemento não abençoado.
4) No catch de play() (l.213), fazer de fato o que o comentário diz: em NotAllowedError, deixar el.muted=true e tentar play() de novo.
5) Não marcar unlocked=true antes do sucesso: mover a l.388 para depois de pelo menos um play() resolvido, ou trocar o flag pelo WeakSet. | Abençoar a cada gesto de reprodução e nunca tirar o mudo de um elemento ainda não abençoado:

(a) LiveMediaPool ganha `private blessed = new WeakSet<AV>()`. O bless() da l.393 passa a fazer `this.blessed.add(el)` antes do play().

(b) unlock() se divide em duas partes:
- destravar o AudioContext uma vez só (mantém o `if (this.unlocked)` apenas para isso);
- blessFor(p, assets), que roda em TODO togglePlay. Ela dá play()/pause() nos elementos de byClip e idle que ainda não estão em blessed. Para cada asset usado, garante pelo menos N elementos abençoados no idle, criados dentro do gesto: N = maior número de clipes desse asset ativos ao mesmo tempo + 1 (a pré-carga); no mínimo 2.
- Chamar blessFor também no botão do Toolbar e no atalho Espaço (useShortcuts), ou centralizar num ponto de entrada de play que todos usem.

(c) acquire() prefere elementos livres que estão em blessed. A poda de MAX_IDLE_PER_ASSET descarta primeiro os não abençoados.

(d) No sync, l.278: `el.muted = !this.blessed.has(el) || gain <= 0.0001`. Assim um elemento criado fora de gesto toca mudo, e o WebKit permite: o vídeo anda em vez de congelar, e o som volta no próximo gesto, quando blessFor o abençoa.

Opcional: no create(), se `navigator.userActivation?.isActive` for true, marcar o elemento como abençoado, porque ele nasce sem restrição.

## 5. [media] iOS: volume do clipe, fades e ducking não têm efeito no preview (el.volume é somente leitura no iOS)

- **Arquivo:** `web/components/preview/livePool.ts:349`

**Cenário:** Sem efeitos de voz/tom, route() devolve false (l.349) e o ganho é aplicado com el.volume (l.277). No Safari/WebView do iOS, HTMLMediaElement.volume é ignorado: a leitura sempre dá 1. Uma música com volume 0.3, com fadeIn/fadeOut ou com duckUnderVoice (DUCK_GAIN 0.25) toca a 100% por cima da fala no preview do iPhone, enquanto o export sai mixado certo. Só o ganho 0 (muted) funciona.

**Correção proposta:** Depois do unlock (this.actx existe), passar pelo grafo também os elementos com ganho ≠ 1. Basta trocar a condição para `if (!r && (!this.actx || (!needsAudioChain(fx, pitch) && Math.abs(gain - 1) < 0.001))) return false;`. route() já monta só o GainNode quando não há cadeia, e um elemento roteado continua roteado (só 1 MediaElementSource por elemento, como hoje). Garantir resumeAudio() também nos outros caminhos de play.

**Correção refinada pelo verificador:** A correção proposta está certa na essência: rotear pelo grafo depois do unlock sempre que o ganho for diferente de 1. Na l.349 de livePool.ts:

`if (!r && (!this.actx || (!needsAudioChain(fx, pitch) && Math.abs(gain - 1) < 0.001))) return false;`

Isso também cobre ganho acima de 1, já que route() só monta o GainNode quando não há cadeia de efeitos.

Três complementos, porque muito mais elementos passam a ser roteados:

1. Em destroy(), desfazer a rota antes de soltar o elemento: `const r = this.routes.get(el); if (r) { r.source.disconnect(); r.chain?.output.disconnect(); r.chain?.stop(); r.gain.disconnect(); this.routes.delete(el); }`. Sem isso, os nós source→gain→destination de elementos descartados (livres acima de MAX_IDLE_PER_ASSET, troca de proxy, retiring) continuam pendurados no AudioContext durante sessões longas no celular.

2. Um elemento roteado fica mudo se o AudioContext estiver suspenso, e o iOS suspende em chamadas, troca de app e tela bloqueada. Hoje resumeAudio() só roda no togglePlay. Ele precisa rodar em todo gesto que inicia a reprodução (atalho de teclado, play pela timeline/scrub) e também num listener de `actx.onstatechange`/`visibilitychange` que tente retomar no próximo toque.

3. No iOS, vale definir `navigator.audioSession.type = 'playback'` quando existir (Safari 16.4+), dentro do unlock(). Assim a chave de silencioso do aparelho não emudece o áudio que agora passa pelo WebAudio. Teste no aparelho. | Depois do unlock, passe pelo grafo todo elemento de clipe com automação de ganho, e não só os que têm ganho ≠ 1 no instante atual. Rotear no meio da reprodução (quando o fade começa ou o ducking entra) cria o MediaElementSource com o som tocando, e isso pode dar estalo ou um corte curto. Uma condição estável por clipe evita isso:

```ts
const hasGainAuto = (c) => (c.volume ?? 1) !== 1 || !!c.fadeIn || !!c.fadeOut || (c.type === 'audio' && !!c.duckUnderVoice);
if (!r && (!this.actx || (!needsAudioChain(fx, pitch) && !hasGainAuto(clip)))) return false;
```

Uma opção mais simples é rotear todo elemento assim que `this.actx` existir. Isso também corrige volume acima de 1 no desktop.

Se o clipe já estiver roteado, `route()` continua no grafo, com cadeia nula e só o GainNode, sem criar um segundo source.

Com o áudio no grafo, um AudioContext suspenso (ligação, app em segundo plano) deixa o preview mudo. Por isso, chame `resumeAudio()` em toda transição de `playing` para true (atalho de teclado, timeline, botões), e não só no `togglePlay` do Preview. Uma forma de garantir isso é chamar `resumeAudio()` dentro do `sync()` quando `playing` estiver true e `actx.state !== 'running'`.

## 6. [media] Vazamento de canvases: scratch() usa o objeto do clipe como dono, e o histórico de desfazer mantém um canvas grande por versão editada

- **Arquivo:** `web/lib/engine/draw.ts:166`

**Cenário:** drawLayer pega canvases auxiliares com scratch(clip, …) nas linhas 125 (remover fundo, na resolução da fonte, ex.: 1080×1920 ≈ 8 MB), 147 e 166 (redução antes da correção de cor, ≈ 4 MB no celular com 720p). O pool de surface.ts é um WeakMap<object, AnyCanvas[]>, e applyOp gera um objeto de clipe novo a cada update_clip/trim/move. Cada versão é desenhada uma vez com o vídeo parado e fica presa em store.past (até 100 snapshots) junto com seus canvases. Exemplo: 40 ajustes num clipe com Cor e 'remover fundo' prendem ~40×12 MB ≈ 480 MB. No iPhone isso estoura o limite de memória de canvas do Safari, e getContext passa a devolver null: o preview para de renderizar ou quebra em ctx null.

**Correção proposta:** Usar um dono estável para esses canvases temporários, que são consumidos dentro do próprio drawLayer. Por exemplo, scratch(ctx.canvas, …) com slots exclusivos (30/31/32, para não colidir com o slot 1 da superfície), ou um Map por clip.id com limpeza dos ids que não existem mais no projeto.

**Correção refinada pelo verificador:** Trocar o dono desses três `scratch` por um dono estável, sem ligação com a identidade do objeto do clipe. Duas opções:

(a) `scratch(ctx.canvas, …, 30 | 31 | 32)`. São slots exclusivos que não colidem com o slot 1 da superfície (draw.ts:241) nem com os slots 2, 4, 7, 8, 10-12 e 20-22 já usados no ctx.canvas. Funciona porque o canvas é consumido dentro do próprio `drawLayer`. Problema: com dois clipes de tamanhos diferentes no mesmo quadro, o canvas é realocado a cada quadro.

(b) Melhor: um `Map<clipId, AnyCanvas[]>` em draw.ts. Ele reaproveita por `clip.id` entre versões. A limpeza remove os ids que não estão mais em `project.tracks`, por exemplo no começo de `renderFrame`, ou zerando a largura e a altura dos canvases descartados. Assim o undo e o redo continuam reaproveitando o canvas, e o histórico não retém memória de canvas. | Esses canvases são consumidos dentro do próprio `drawLayer`, então não devem ter o objeto imutável do clipe como dono.

Opção mais simples: trocar o dono nas linhas 125, 147 e 166 por `ctx.canvas`, com slots exclusivos que nenhum outro código use. Por exemplo 30, 31 e 32: o próprio `drawLayer` usa o slot 1 em `scratch(ctx.canvas,…,1)` e o 2 em `drawAdjustment`, e o `renderFrame` usa 20 a 22. Assim cada quadro de destino reaproveita os mesmos 3 canvases. Os quadros de transição em shader (fc e tc) têm o seu próprio `ctx.canvas`.

Opção melhor, se houver PiP ou vários clipes com remover fundo em tamanhos diferentes (para não realocar a cada quadro): um `Map<string, AnyCanvas[]>` indexado por `clip.id` (ou `opts.segKey`). Nesse caso, a cada `renderFrame` é preciso descartar os ids que não aparecem mais no projeto, ou limitar o Map com uma política LRU pequena.

## 7. [baixa] Grafo WebAudio de elementos destruídos nunca é desmontado (pitch/efeitos continuam rodando no AudioContext)

- **Arquivo:** `web/components/preview/livePool.ts:185`

**Cenário:** Um elemento roteado (clipe com tom ou efeito de voz, depois do unlock) é destruído por destroy() quando o proxy 720p fica pronto (retire), quando passa de 3 livres por asset ou quando a mídia é removida (staleIdle). destroy() não mexe em this.routes. O MediaElementAudioSourceNode continua ligado ao GainNode → destination e mantém vivo o <video> removido. A cadeia (4 AudioBufferSource em loop do pitchShifter, oscilador do 'robô', compressores) continua processando no thread de áudio até a página fechar. Em sessão longa no celular, cada importação com efeito de voz ativo antes do proxy ficar pronto deixa uma cadeia gastando CPU e bateria.

**Correção proposta:** Em destroy(): `const r = this.routes.get(el); if (r) { r.source.disconnect(); if (r.chain) { r.chain.output.disconnect(); r.chain.stop(); } r.gain.disconnect(); this.routes.delete(el); }`.

**Correção refinada pelo verificador:** Em livePool.ts, no começo de destroy(el) (linha 185), desmontar a rota antes de destruir o elemento:

  const r = this.routes.get(el);
  if (r) {
    try { r.source.disconnect(); } catch { /* ok */ }
    if (r.chain) { try { r.chain.output.disconnect(); } catch { /* ok */ } r.chain.stop(); }
    try { r.gain.disconnect(); } catch { /* ok */ }
    this.routes.delete(el);
  }

Isso cobre os três caminhos (retire, staleIdle e mais de 3 livres por asset), porque todos passam por destroy(). Opcional, para reduzir o custo que já existe hoje: em route(), quando o elemento fica livre ou pausado e a cadeia tem fontes em loop, chamar chain.stop() e r.key = '' para reconstruir a cadeia no próximo uso. Outra opção é suspender o AudioContext com o preview parado e retomá-lo em resumeAudio(). | At the start of destroy() in livePool.ts, before el.remove(), tear down the element's route and wrap it in try/catch:

`const r = this.routes.get(el); if (r) { try { r.source.disconnect(); if (r.chain) { r.chain.output.disconnect(); r.chain.stop(); } r.gain.disconnect(); } catch { /* already disconnected */ } this.routes.delete(el); }`

Calling `chain.stop()` matters: disconnecting only the source does not stop the pitch shifter's looping AudioBufferSources or the robot's oscillator. A MediaElementAudioSourceNode can never be reused for another element, so dropping the route is safe. `dispose()` can stay as it is, because closing the AudioContext already frees everything.

## 8. [baixa] Qualidade adaptativa para de funcionar depois da 1ª pausa (o nível do QualityGovernor não é zerado)

- **Arquivo:** `web/components/preview/syncPolicy.ts:127`

**Cenário:** Aparelho fraco reproduzindo: o governador desce para 0.75 (level=1). Ao pausar, Preview.tsx:349-350 chama govRef.reset() e força a qualidade de volta a 1, mas reset() não zera `level`. Na reprodução seguinte, o custo a 1.0 (ex.: 40 ms por quadro) é comparado com o limite do degrau 1 (slowMs×2 = 60 ms), e a resolução nunca volta a cair. Confirmei num vitest avulso: depois do reset, 600 quadros de 40 ms não geram nenhuma mudança (factor diz 0.75, a qualidade real fica em 1). O preview passa a engasgar o resto da sessão, ou só cai direto para 0.5 se o custo passar de 60 ms.

**Correção proposta:** Em QualityGovernor.reset(), também zerar `level = 0` e `lastChange = -Infinity`. Outra opção: o Preview usar govRef.current.factor ao retomar, em vez de forçar 1.

**Correção refinada pelo verificador:** The minimal fix keeps the governor in step with what Preview.tsx does: in `QualityGovernor.reset()` (syncPolicy.ts:127) also set `this.level = 0` and `this.lastChange = -Infinity`. Add a test in syncPolicy.test.ts: after it drops to 0.75 and `reset()` is called, `factor === 1`, and 40 ms frames make it drop again.

An alternative avoids the stutter on every play on a device already known to be slow. Leave `reset()` as it is. At play start, after `govRef.current.reset()` at Preview.tsx:367, set `wantQRef.current = govRef.current.factor`. The next `draw()` resizes the canvas and draws in the same frame, so there is no flash.

If you go that way, also add a separate `resetLevel()` that the pause path calls. Then the governor and the real quality cannot get out of step. | Em QualityGovernor.reset() (syncPolicy.ts:127), zerar também `this.level = 0` e `this.lastChange = -Infinity`. Isso é seguro nos dois pontos que chamam o reset: na pausa (Preview.tsx:349) a qualidade é forçada a 1, e no play (Preview.tsx:367) ela já está em 1. Assim o governador volta a corresponder à resolução real. Vale um teste em syncPolicy.test.ts: depois de cair para 0.75, chamar reset() e verificar que `factor === 1` e que 40 ms por quadro volta a gerar 0.75.
