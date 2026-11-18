# Avisos de terceiros

Código derivado de projetos open source deve ser listado aqui com a licença original.

## HyperFrames — transições em shader WebGL

- Projeto: HyperFrames — https://github.com/heygen-com/hyperframes (commit `81f89b8`)
- Copyright 2026 HeyGen, Inc.
- Licença: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Arquivos de origem: `packages/shader-transitions/src/shaders/registry.ts` e `packages/shader-transitions/src/shaders/common.ts`
- Onde está no EditorPro: `web/lib/engine/shaderTransitions.ts`
- Modificações: GLSL das 14 transições (domain-warp, ridged-burn, whip-pan, sdf-iris, ripple-waves,
  gravitational-lens, cinematic-zoom, chromatic-split, glitch → `digital-glitch`, swirl-vortex,
  thermal-distortion, flash-through-white, cross-warp-morph, light-leak) portado para o compositor WebGL do
  EditorPro, sem GSAP/html2canvas; cores de destaque trocadas para o laranja da marca; a renomeação
  `digital-glitch` evita conflito com a transição `glitch` já existente.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use these files except in
compliance with the License. Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
express or implied. See the License for the specific language governing permissions and limitations under the
License.
