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
