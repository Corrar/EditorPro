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
