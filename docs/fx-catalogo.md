# Catálogo de efeitos (sessão fx) — 2026-11-19

Fonte da verdade: `web/lib/fx/catalog.ts` (`EFFECT_CATALOG`, `TRANSITION_CATALOG`, `BLEND_CATALOG`,
`MASK_CATALOG`, `CLIP_ANIMATION_CATALOG`). Harness: `/dev/fx` (grade animada, `window.__epFx.compileAll/benchEffects/benchTransitions`).

## Antes × agora

| Área | Antes | Agora | Referência CapCut / DaVinci |
|---|---|---|---|
| Efeitos de vídeo | 18 | **91** em 13 categorias (Básico, Lente, Desfoque, Distorção, Glitch, Retrô, Luz, Estilizar, Split/Clone, Estrobo, Partículas, Moldura, Festa) | CapCut: Básico, Festa, Retrô, Lente, Desfoque, Distorção, Luz, Glitch, Partículas, Moldura, Split, Estrobo ✔ · Resolve FX: Blur, Lens, Stylize, Light, Warp ✔ (parcial) |
| Transições | 38 | **97** em 9 categorias (Básicas, Câmera, Slide, Máscara, 3D, Efeitos, Luz, Glitch, Distorção) | CapCut: Básicas, Câmera, Efeitos, Luz, Slide, Máscara, 3D, Glitch ✔ · Resolve: Dissolve, Iris, Motion, Shape, Wipe ✔ |
| Mesclagem | 8 | **17** (todos os modos do Resolve/Photoshop suportados pelo canvas) | ✔ completo |
| Máscaras | 6 | **11** (+ gradiente linear, radial, retângulo arredondado, losango, texto) com suavização, inversão e **keyframes** | Power Windows: linear, circular, poligonal ✔ (sem curva Bézier livre) |
| Animações de clipe | 14 | **34** (entrada/saída/loop) | CapCut ✔ |

## Como cada coisa é renderizada
- **Geometria** (7): tremor, zooms, câmera na mão, tremor 3D, batida — transform no desenho (CSS no modo nativo).
- **Shader WebGL** (37 efeitos, 59 transições novas + 14 antigas): um único contexto (`lib/fx/glcore.ts`),
  texturas pré-multiplicadas, cache de programa/uniform, recuperação de perda de contexto, limite de MAX_TEXTURE_SIZE.
  Sem WebGL: desfoques caem num blur 2D que funciona no Safari; efeitos de cor caem numa versão em CPU (360 px);
  distorções/glitch ficam sem efeito (raro).
- **Canvas 2D** (partículas, luz, moldura, estrobo, split/clone, eco de quadros) — `lib/fx/effects2d.ts`.
- Preview e export usam o mesmo `renderFrame` → mesmo resultado.

## Falta (próxima rodada, por prioridade)
1. **P1** Desfoques em meia resolução (são os mais caros, ver medições) e caminho WebGL p/ efeitos antigos em 2D (glitch, rgb-split, vhs, old-film usam ctx.filter, que o Safari ignora).
2. **P1** Máscara Bézier livre (Power Window de curva) e rastreamento de máscara.
3. **P2** Efeitos com segmentação (desfoque de fundo real, contorno da pessoa), lens flare com oclusão.
4. **P2** Parâmetros por efeito além de intensidade/velocidade/cor/direção (ex.: quantidade de partículas, posição do flare).
5. **P3** Transições "morph" com fluxo óptico e "luma wipe" com imagem do usuário.

## Medição (Chromium headless com SwiftShader = GPU por software; serve p/ ordem relativa, não p/ celular)
Média de todos os efeitos em 1280×720: **25 ms/quadro**. Mais caros: desfoque (156), brilho suave (153), foco central (147),
bloom (145), pixel sort (136), neon (128), tilt-shift (125), desfoques giratório/direcional/zoom (98–120), cartoon (57).
Os demais (partículas, molduras, cor, distorção) ficam em 1–15 ms. Em GPU real os shaders custam uma fração disso.
Transições mais caras: zoom cinemático, giro/zoom com desfoque e chicotes (amostragem múltipla).

## Efeitos e transições escritos pela IA (kind 'custom') — rodada "IA sem limites"

- `VisualEffect { kind: 'custom', code, name, params }` → código define `vec4 effect(vec2 uv)`.
- `Transition { kind: 'custom', code, name, params }` → código define `vec4 transition(vec2 uv)`.
- API p/ a IA (`web/lib/fx/customShader.ts`): `checkShader(code, stage)` (compila na GPU; linha relativa ao código;
  sem WebGL só checagens estáticas), `wrapShader`, `SHADER_PRELUDE_DOC` (≤ 1.200 caracteres, vai no prompt),
  `SHADER_EXAMPLES` (10 exemplos testados: ondas, scanline neon, chuva, gradiente de fundo, partículas,
  pulso na batida via uParams, glitch RGB, espiral, pixels em diagonal, zoom com flash).
- Uniforms do efeito: uTex, uResolution, uTime (s no clipe), uDuration, uProgress, uIntensity, uSpeed, uColor, uParams[8];
  da transição: uFrom/uTo (getFromColor/getToColor), uProgress (com easing), uResolution, uTime, uParams[8].
  Helpers: rand, noise, fbm, luma, rgb2hsv, hsv2rgb, rot2, sdCircle, sdBox, aspect, tex, PI, TAU.
  uv com (0,0) no canto superior esquerdo; cor com alfa reto.
- Motor (`web/lib/fx/customRender.ts`): programa em cache por hash (FNV-1a) com LRU de 24; código > 16 KB ou que
  não compila = passagem direta (efeito) / dissolver (transição); shader que derruba o contexto WebGL vai p/ lista negra;
  vale em vídeo, imagem, sticker, forma e camada de ajuste (uTex = tudo abaixo; ignorar uTex = gerador de fundo).
- Medições (SwiftShader, 1280×720, ms/quadro): ondas 24, scanline 19, chuva 18, gradiente (fbm) 36, partículas (laço de 40) 154.
  Export MP4 de 5 s (540p, WebCodecs) com efeito + transição + camada de ajuste custom: ~5,3 s.
