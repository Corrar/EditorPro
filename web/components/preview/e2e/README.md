# Regressão do preview (Playwright, scripts soltos da sessão engine)

Servidor: `npm run build && DASH_PASSWORD=teste npx next start -p 3100`.
Vídeo: `ffmpeg -f lavfi -i testsrc2=duration=40:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=40 -shortest -g 60 <dir>/phone.mp4`.

- `node freeze.cjs <dir> [mobile]` — r2 #1/#2/#3: reverso, vídeo quebrado e mídia sem url não congelam o canvas
  (antes: 0 mudanças em 3 s; agora ~50–77, desktop e Pixel 7 com CPU 4×).
- `node ios.cjs <dir>` — r2 #4/#5 com as restrições do iOS emuladas no Chromium (play com som só em gesto,
  por elemento; `volume` só leitura): elemento criado depois do 1º toque toca (mudo) e ganha som no próximo
  toque; volume ≠ 1 passa pelo GainNode.
- `node fontcache.cjs <dir> [mobile]` — r2 biblioteca #1: com o CSS da fonte atrasado, o texto parado troca para
  a fonte certa quando ela chega (antes ficava no bitmap da fonte reserva: 71 → 71 px; agora 70 → 177 px).
- `node emoji.cjs <dir> [mobile]` — r2 biblioteca #3: 'Amei ❤️' com char-fade mantém o coração colorido.
- `node blackai.cjs <dir> [mobile] [rodadas]` — regressão "preto com a IA editando ao vivo e o vídeo pausado"
  (cortes + applyLive de ripple_delete): o elemento exibido não pode ser destruído antes de o substituto
  apresentar. Antes: 3–7 pretas em ~60 capturas; agora 0 (desktop) e 0 (Pixel 7, CPU 4×). `DUMP=1` mostra o estado.
- `node at3.cjs <dir> [mobile]` — caso da IA: parado exatamente em 3,0 s, efeito 'custom' (com e sem intensity) no
  clipe que começa em 3,0 e texto que começa em 3,0 aparecem no preview.
- `node blink2.cjs <dir> [mobile] [rodadas]` — roteiro blink2 da principal (bruto.mp4 de 12 s, GOP padrão: seeks lentos):
  tocando + 6 splits, pausa + salto + applyLive (fase "paused"), depois toca. Antes 1–2 pretas por rodada; agora 0.
- `node geo.cjs <dir> [mobile]` — geometria nativa a cada rAF com transform: scale (width/height fixos na caixa-base):
  tocando um zoom, 1 mudança de transform por rAF e 1 largura só; parado, preview nativo ≈ exportFrame.
- `node retire.cjs <dir> mobile [rodadas]` (com `node burn.cjs 4 700 &` carregando a CPU) — r3: o `<video>` exibido que
  ia para 'retiring' era removido após 4 s mesmo sem substituto → preview preto por segundos com seeks lentos. Sonda
  por rAF ("nativo sem video visível") + linha do tempo de opacidade/remoção. Antes: 4 de 6 rodadas; agora 0
  (blink2 com a mesma carga: antes 3 pretas em 4 rodadas; agora 0 em 6).
