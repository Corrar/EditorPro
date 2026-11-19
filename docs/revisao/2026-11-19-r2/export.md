# Revisão de código r2 — área export

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Testado em Chromium (Playwright) com bundle esbuild de lib/export, porque o servidor em :3100 está servindo um chunk webpack que não existe mais (400). Scripts e mídias de teste em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/export/. Confirmado OK: mapeamento quadro↔fonte com speed 2x, edit list no decodePool (bate com o <video>), rotação 90/-90/180 igual nos dois caminhos.

Riscos sem cenário reproduzido:
(1) Nenhuma espera do export olha signal/timeout: o laço `while (venc.encodeQueueSize > 24)` (video.ts:237), `venc.flush()` e `dec.flush()` no ClipDecoder (decodePool.ts:157, fora do detector de 5 s). Se o encoder/decoder de hardware travar, o Cancelar não age e o diálogo fica preso em 'running'. Agrava: encoderProducesImage trata timeout (null) como aprovado.
(2) No caminho MediaRecorder (iOS ≤18, sem AudioEncoder), o AudioContext é criado depois de vários awaits, já fora do gesto do usuário. No WebKit, resume() pode ficar pendente ou o contexto continuar suspenso, o que trava ou deixa o vídeo mudo. Não deu para verificar sem WebKit.
(3) Se pool.prepare ou rec.start lançar antes do try (video.ts:309-311), o AudioContext e as tracks do stream vazam.
(4) Com fastStart 'in-memory' + ArrayBufferTarget + new Blob, o pico fica em ~3-4x o tamanho do MP4 final; export longo em 1080p no celular pode estourar a memória.
(5) No FCPXML, um clipe da spine com início ajustado por sobreposição não avança o `in` da fonte; reverso e curvas são ignorados.

## 1. [alta] Velocidade muda o tom do áudio no export, mas o preview mantém o tom (voz 'esquilo' a 1,5x/2x)

- **Arquivo:** `web/lib/export/audioMix.ts:311`

**Cenário:** Clipe de vídeo/áudio com speed 2 (ou curva/preset de velocidade). O preview toca com preservesPitch = true (components/preview/livePool.ts:112), então o tom continua normal. No export, mixProjectAudio usa AudioBufferSourceNode.playbackRate (linhas 307-311), que reamostra e sobe o tom junto. Confirmei com um seno de 440 Hz exportado a 2x: o MP4 saiu em 880 Hz, uma oitava acima; o vídeo e a duração (5 s) estão certos. Com 1,5x a voz sobe cerca de 7 semitons. O arquivo final soa diferente do que o usuário ouviu no preview.

**Correção proposta:** Compensar o tom no export. Com velocidade constante: passar `(clip.pitch ?? 0) - 12*Math.log2(speed)` para o buildAudioChain (o pitchShifter já existe). Com curva/preset: fazer time-stretch offline do `seg` (WSOLA ou phase vocoder) seguindo o rateEnvelope e tocar com playbackRate 1. Assim export e preview (preservesPitch) ficam iguais.

**Correção refinada pelo verificador:** Arquivo: web/lib/export/audioMix.ts (linhas 90-99, não 307-311).

- **Velocidade constante:** calcule `semis = (clip.pitch ?? 0) - 12*Math.log2(speed)` e passe para `buildAudioChain`. O pitchShifter Jungle já existe em audioFx.ts:69, e totalSemitones soma esquilo/grave por cima. Mantenha o `playbackRate = speed`.
- **Curva ou preset:** a automação de playbackRate muda de valor ao longo do clipe, e um pitch fixo não acompanha. Faça o time-stretch offline do `seg` (WSOLA ou phase vocoder) seguindo o `rateEnvelope`, até um buffer de `clip.duration`, e toque com `playbackRate = 1`.
- **Alternativa barata para a curva:** fatie o seg em trechos de cerca de 1/30 s, cada um com a compensação constante do seu trecho.

Inclua um teste que gera um seno a 2x e confere a frequência dominante no buffer mixado (por cruzamentos de zero). | A correção sugerida no relatório não funciona para velocidade constante. Passar `clip.pitch - 12*log2(speed)` ao buildAudioChain quebra fora de 0,5x a 2x: totalSemitones limita o valor a ±12, então 4x precisaria de -24. Além disso, o pitchShifter de linha de atraso piora a qualidade. A correção certa é fazer, em audioMix.ts, um time-stretch offline do `seg` com WSOLA ou phase vocoder antes de criar o source. Com velocidade constante, estica pelo fator 1/speed. Com curva, segue o rateEnvelope (ou integra sourceTime ao longo da timeline) para gerar um buffer já na duração da timeline. Depois toca com playbackRate = 1 e mantém só o clip.pitch no buildAudioChain. Isso deixa o export igual ao preview, que usa preservesPitch.

## 2. [alta] Proxy de preview carrega o arquivo inteiro na memória (~5x o tamanho do arquivo) e roda sozinho ao importar qualquer vídeo >720p

- **Arquivo:** `web/lib/export/proxy.ts:62`

**Cenário:** makePreviewProxy chama demuxMp4(file). Esse demux faz `file.arrayBuffer()` do arquivo inteiro (demux.ts:76) e o mp4box guarda tanto o buffer quanto uma cópia dos bytes de cada amostra em vRaw/aRaw (demux.ts:87-89) durante toda a transcodificação. A ingestão dispara isso em segundo plano para todo vídeo com lado menor >720p (proxyPolicy.needsProxy; ingest.ts:166), ou seja, praticamente todo vídeo de celular, e não há fila entre vários arquivos. Medi um MP4 de 416 MB: o renderer chegou a 2.273 MB de RSS (base 98 MB). O decodificador sequencial do export, com o mesmo arquivo, ficou em 384 MB. Num celular, importar um vídeo 4K de 1 GB, ou alguns de 1080p de uma vez, mata a aba (OOM) no iOS/Android e derruba a sessão de edição.

**Correção proposta:** Fazer o proxy por streaming, como o export já faz: indexMp4Video + leitura em janelas por Blob.slice (a mesma ideia do SampleReader) para o vídeo, e um índice de offset/tamanho para as amostras AAC copiadas. Liberar cada amostra depois de enviá-la ao decoder/muxer. Em lib/media/proxy.ts, gerar um proxy por vez (fila global).

**Correção refinada pelo verificador:** 1. Em export/proxy.ts, ler o arquivo por streaming:
   - Trocar demuxMp4 por indexMp4Video(file), estendido para devolver também os SampleRef (offset/tamanho) da trilha AAC e a config de áudio.
   - Ler as amostras de vídeo em janelas com Blob.slice, reaproveitando readPlan/SampleReader de decodePool.ts, e descartar cada janela depois do decode.
   - Copiar o AAC lendo por offset também.
2. Mesmo antes do streaming, mover as checagens baratas para antes de ler o arquivo: decoderConfigFor (com codec/descrição vindos do índice) e VideoEncoder.isConfigSupported. Assim HEVC sem suporte não carrega nada.
3. Em lib/media/proxy.ts, criar uma fila global com 1 proxy por vez. Os pedidos novos esperam o atual terminar, e quem for cancelado (cancelPreviewProxy) sai da fila.
4. Até o streaming entrar, como paliativo: não gerar proxy quando file.size passar de um teto (ex.: 300 MB, igual ao waveform) e seguir com a original. | Mudança mínima e segura, para já:
- (a) Em lib/media/proxy.ts, gerar um proxy por vez com uma fila global (uma promise encadeada ou um semáforo de 1).
- (b) Em makePreviewProxy, abortar quando o arquivo for grande demais para o caminho em memória, com um teto como file.size > 300 MB, mais baixo no celular. Assim o preview fica na original em vez de derrubar a aba.

Correção completa:
- Trocar demuxMp4 por indexMp4Video, ampliado para devolver também os SampleRef do áudio AAC (getTrackSamplesInfo da trilha de áudio, com offset/size e o mesmo editListShift).
- Ler os bytes em janelas com readPlan + Blob.slice, como o SampleReader do decodePool, e soltar cada janela depois de decode()/addAudioChunkRaw.
- Manter demuxMp4 só como fallback para MP4 fragmentado, sujeito ao mesmo teto de tamanho.
- Fora da área de export, mas no mesmo caminho: em ingest.ts, não rodar a waveform (que também faz arrayBuffer) em paralelo com o proxy do mesmo arquivo.

## 3. [media] Áudio do export lê o arquivo inteiro e decodifica a trilha completa; se falhar, exporta sem som e sem avisar

- **Arquivo:** `web/lib/export/audioMix.ts:261`

**Cenário:** decodeAsset faz `fetch(asset.url).arrayBuffer()` do arquivo inteiro e `decodeAudioData` da trilha inteira (linhas 260-262), mesmo que o clipe use só 2 s. Medi: mixar 2 s de um MP4 de 416 MB levou o renderer a 870 MB de pico. Com um vídeo longo de 1-2 GB num celular (Chrome Android 32-bit, iPhone), ou a aba morre, ou a alocação lança RangeError. Nesse segundo caso o erro é engolido (linhas 263-266 retornam null, e video.ts:115-118 também engole a falha do mix inteiro, só com console.warn), o export termina com 'Vídeo exportado!' e o MP4 sai sem o áudio daquele clipe. Isso anula a garantia de 'memória ~constante' que o decodePool dá para o vídeo.

**Correção proposta:** Demuxar só a trilha de áudio por índice (mp4box, como o indexMp4Video) e decodificar apenas as amostras de [in, in+span] com AudioDecoder (ou decodeAudioData de um trecho remuxado). No mínimo, propagar a falha para o usuário (onNotice/aviso no resultado: 'o áudio de X não pôde ser incluído') em vez de exportar mudo em silêncio.

**Correção refinada pelo verificador:** (1) Decodificar só o trecho usado. Para MP4/MOV, indexar a trilha de áudio como o indexMp4Video faz com a de vídeo (mp4box lendo só o moov via blob.slice). Ler apenas as amostras de [clip.in - preroll, clip.in + sourceSpan(clip)], decodificar com AudioDecoder e reamostrar para MIX_RATE, ou montar um AudioBuffer. Usar decodeAudioData do arquivo inteiro só como fallback e só abaixo de um limite (por exemplo, o mesmo MAX_DECODE_BYTES de 350 MB da ingestão).
(2) Limitar o pico de memória: agrupar `items` por asset e, depois de criar os segmentos de todos os clipes daquele asset, apagar a entrada do cache (bufferCache.delete). Assim só um AudioBuffer completo fica vivo por vez.
(3) Não exportar mudo em silêncio. decodeAsset deve distinguir "sem trilha de áudio" (por exemplo, info.audioTracks vazio no mp4box, ou erro de decodificação em asset que tem waveform) de falha de alocação/decodificação. mixProjectAudio deve devolver a lista de assets que falharam. exportVideo deve repassar isso como aviso no resultado ou via onNotice, e o ExportDialog deve mostrar "O áudio de <nome> não pôde ser incluído" em vez do toast de sucesso puro. O mesmo vale para o catch de video.ts:115-118. | 1. In `decodeAsset` (`audioMix.ts:36-55`), for MP4/MOV files, read only the audio track's sample index with mp4box, in chunks the same way as `indexMp4Video`. Then fetch, with `blob.slice`, only the samples covering [clip.in - preroll, clip.in + sourceSpan(clip)], decode them with `AudioDecoder` (or remux that range into a small ADTS/MP4 and pass it to `decodeAudioData`), and build an `AudioBuffer` that covers only that range. Key the cache by asset plus range. As a minimum fallback, apply a size limit like the one in `ingest.ts` (`asset.size > ~300 MB` means do not read the whole file).
2. Stop failing silently. Have `decodeAsset` tell apart "no audio track", where the asset has no waveform or the demux shows no audioTracks, from "decode failed / RangeError". In the second case, return a warning such as "o áudio de <nome> não pôde ser incluído". `mixProjectAudio` should collect these warnings and send them to the existing `onNotice` or to the export result. `video.ts:115-118` should do the same when the whole mix fails, so that `ExportDialog` shows the warning instead of only "Vídeo exportado!".

## 4. [media] DecodedMediaPool guarda um canvas do tamanho do quadro por clipe rotacionado até o fim do export (vazamento com muitos cortes)

- **Arquivo:** `web/lib/export/decodePool.ts:275`

**Cenário:** Para vídeo com matriz de rotação (vídeo vertical gravado no iPhone/Android, guardado deitado com 90°), cada clipe ganha um FrameSurface com um OffscreenCanvas do tamanho de exibição (linhas 290-293). Quando o clipe sai do quadro, a limpeza da linha 275 fecha o decoder e apaga `frames`, mas não apaga `surfaces`, e dispose() (338-343) também não. Testei 40 cortes de um vídeo rot=90: no fim, `surfaces.size` era 40 e continuava 40 depois do dispose. Com fonte 1080p são cerca de 8,3 MB por clipe; com 4K, cerca de 33 MB. Uma edição curta com 60 cortes (remover silêncios) segura 0,5-2 GB e derruba o export no celular no meio do processo.

**Correção proposta:** Na limpeza da linha 275, no catch (296-302) e na troca por quadro preto (326-329), fazer `this.surfaces.delete(id)` e zerar width/height do canvas. Em dispose(), limpar `surfaces`. Melhor ainda: reaproveitar poucos canvases (um por camada simultânea) em vez de um por clipe.

**Correção refinada pelo verificador:** Em prepare (linha 275), no catch (296-302) e em blackViaDecoder (326-329), liberar a surface do clipe: pegar `const s = this.surfaces.get(id)`, chamar `s?.release()` e depois `this.surfaces.delete(id)`. Para isso, criar em FrameSurface um `release()` que faz `if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; this.canvas = null; }`. Zerar o tamanho libera o backing store na hora, sem esperar o GC. Em dispose(), percorrer `surfaces`, chamar release() e depois clear(). Alternativa: um pool pequeno de canvases reaproveitados por camada simultânea. Não dá para usar um único canvas compartilhado, porque dois clipes rotacionados visíveis ao mesmo tempo numa transição precisam de canvases distintos até o renderFrame. | In `prepare()`, delete the clip's surface everywhere its decoder is discarded:
- the loop at line 275,
- the catch at 296-303,
- `blackViaDecoder` (326-329).

Before deleting, free the canvas right away, without waiting for the garbage collector (important on Safari). Add a `release()` method to `FrameSurface` that sets `canvas.width = canvas.height = 0` and `canvas = null`. Call `this.surfaces.get(id)?.release(); this.surfaces.delete(id)`.

In `dispose()`, call `release()` on every surface and run `surfaces.clear()`.

Do not share one canvas between clips that are on screen at the same time. `frames` keeps the canvas returned by `source()`, so two layers on one canvas would overwrite each other. A small pool of canvases reused per layer would work, but releasing the canvas when the clip leaves the frame is enough.

## 5. [baixa] Proxy falha em vídeo cortado sem reencode (edit list com pré-rolagem): timestamps negativos quebram o muxer

- **Arquivo:** `web/lib/export/proxy.ts:121`

**Cenário:** Arquivo cortado com stream copy (ffmpeg -ss X -c copy; exportações passthrough do iOS) tem elst com media_time dentro do GOP, e as amostras de pré-rolagem ficam com cts negativo depois do editListShift. O proxy repassa frame.timestamp negativo para o encoder. O mp4-muxer lança 'addVideoChunkRaw's third argument (timestamp) must be a non-negative real number' dentro do callback de saída do encoder (linha 105), sem try. O erro vira pageerror, um por quadro, e `failure` nunca é marcado. O primeiro chunk, que carrega o decoderConfig, é perdido, e finalize() quebra ('colorSpace' de null). Reproduzi com 1,5 s de pré-rolagem: proxy = null, e o preview no celular fica na original pesada. O export (decodePool) com o mesmo arquivo mostra os quadros certos.

**Correção proposta:** No output do decoder do proxy, descartar quadros com timestamp < 0 (fechar sem codificar). Envolver muxer.addVideoChunk do callback do encoder em try/catch que marque `failure`. Opcionalmente, usar firstTimestampBehavior 'cross-track-offset' com timestamps já ≥ 0 para manter vídeo e áudio alinhados.

**Correção refinada pelo verificador:** Arquivo: web/lib/export/proxy.ts

1. No output do VideoDecoder (linha 112), logo no início, descartar os quadros de pré-rolagem que o edit list esconde, sem desenhar nem codificar:
   `if (frame.timestamp < 0) { frame.close(); return; }`
   As amostras continuam sendo decodificadas, porque servem de referência para as seguintes. Como o `encoded` só conta quadros codificados, o 1º quadro com timestamp ≥ 0 sai como keyframe e leva o decoderConfig.

2. Proteger o callback do encoder, para que um erro do muxer pare o laço em vez de virar pageerror repetido:
   `output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; } }`

O áudio já descarta/encosta no 0 as amostras com cts < 0 (linhas 157-158). Com o 'offset', vídeo e áudio continuam começando em 0 e alinhados. | Em web/lib/export/proxy.ts:
1. No output do VideoDecoder (linha 112), descartar o quadro da pré-rolagem antes de desenhar e codificar: `if (frame.timestamp < 0) { frame.close(); return; }`. Como esses quadros não incrementam `encoded`, o primeiro quadro com timestamp >= 0 continua saindo como keyframe (encoded % gop === 0).
2. Proteger o callback do encoder: `output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; } }`. Assim qualquer erro do muxer encerra o loop na hora, sem continuar transcodificando à toa nem gerar um erro não tratado por quadro.
Opcional: quando o elst não cai num quadro exato, o primeiro quadro que sobra tem t0 > 0 e o 'offset' o leva a 0, adiantando o vídeo menos de 1 quadro em relação ao áudio. Para alinhar exatamente, passar o timestamp explícito (já >= 0) e usar firstTimestampBehavior 'cross-track-offset', ou não reancorar.
