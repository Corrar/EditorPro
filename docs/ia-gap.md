# EditorPro × CapCut — ferramentas de IA (análise de lacunas)

Atualizado em 2026-11-19 pela sessão IA/Chat. Legenda: ✅ temos (paridade) · 🟡 temos parcial · ❌ não temos.
Restrição do projeto: tudo roda **no navegador** (grátis) ou via **Claude** nas rotas `/api/ai/*`; nada de GPU/servidor extra.

| # | Ferramenta CapCut | EditorPro hoje | Situação | Prioridade / próximo passo |
|---|---|---|---|---|
| 1 | Legendas automáticas | Whisper local (transformers.js, WebGPU→WASM), palavras com tempo e id, 20+ estilos da biblioteca | ✅ | — |
| 2 | Legendas multi-idioma / tradução | Whisper reconhece o idioma pedido; tradução pelo Claude (`/api/ai/translate`), mantendo os tempos | ✅ (com chave) | Demo só avisa que precisa da chave |
| 3 | Remover silêncios | RMS local (`detectSilences`), cortes `ripple_delete`; **limiar ajustável** pelo pedido ("pausas maiores que 1 s", "agressivo", "só as longas") | ✅ | Slider no painel de áudio (shell) usaria `silenceOptsFromText`/`SilenceOptions` |
| 4 | Remover palavras de preenchimento | `fillerOps` pelas palavras do Whisper (né, ahn, hum, éé, tipo, tipo assim, então…/sabe? soltos) com `remove_words` | ✅ | Ajustar lista com uso real |
| 5 | Auto-reframe (16:9→9:16) | MediaPipe FaceDetector (CDN) + fallback por detalhe da imagem; keyframes de `transform.x` suavizados | ✅ | Reframe vertical (9:16→16:9) não faz sentido; 1:1/4:5 já cobertos |
| 6 | Destaques / melhores momentos | `highlightOps` (pontuação por densidade de fala, ênfase, palavras do brief, números) para 15/30/60 s; com Claude a escolha é semântica pela transcrição | ✅ | — |
| 7 | Cortes na batida | Detecção de batida local (`detectBeats`), `beatSyncOps` (cortes + zoom alternado + flash) e marcadores de batida | ✅ | Batidas fortes × fracas (downbeat) seria um refinamento |
| 8 | Zoom automático na ênfase | `emphasisZoomOps`: punch-in curto nas frases com ênfase (palavras marcadas, "!", números, palavras-chave) | ✅ (novo) | Claude também pode marcar `emphasis` |
| 9 | Sugestão de b-roll / stickers / emoji | Emoji automático nas legendas (biblioteca), stickers por palavra no demo, Claude escolhe stickers/modelos; b-roll gerado = estrutura `/api/gen` (sem GPU) | 🟡 | b-roll de banco de imagens exige API externa — fora do escopo grátis |
| 10 | Voz / efeitos de voz | Efeitos de voz (robô, eco, grave, agudo…) via `audioEffects`; efeitos sonoros sintetizados (biblioteca) | 🟡 | Texto→fala (TTS) com Web Speech API não grava em arquivo; locução real precisaria de serviço pago |
| 11 | Script para vídeo | Brief + material → 1ª edição completa ao vivo; vídeo modelo copia ritmo/legenda/cor | 🟡 | Gerar vídeo do zero só com texto depende de geração de vídeo (`/api/gen`, sem GPU hoje) |
| 12 | Combinar cor com referência | `matchColorGrade`: estatísticas de cor do vídeo modelo × material → `ColorGrade` (offset/gain por canal, exposição, contraste, saturação, temperatura) aplicado com `update_clip {colorGrade}` | ✅ (novo) | Lógica de LUT 3D fica com a sessão "cor" |
| 13 | Edição por conversa (correções) | Chat + pop-up no celular, apontar clipe/ponto/legenda, comentários de revisão, desfazer por pedido, "o que mudou?" | ✅ (à frente do CapCut) | — |
| 14 | Estilo a partir de vídeo-exemplo | Vídeo modelo: ritmo, legendas, cores, zooms, transições; aplica tudo ou só uma parte | ✅ (à frente) | — |
| 15 | Remover fundo / chroma | `removeBackground` (engine/MediaPipe) e chroma key | ✅ (engine) | — |

## Prioridades (o que ainda vale fazer)
1. **Painel de áudio com slider de silêncio** (shell) usando `SilenceOptions` — a IA já entende o limiar no texto.
2. **Downbeats** na detecção de batida para cortes mais "musicais".
3. **TTS/locução**: avaliar voz do navegador para prévia (sem exportar) ou serviço pago se o Bruno quiser.
4. **b-roll**: só com banco de imagens/vídeos gratuito com API (avaliar licenças) ou geração de vídeo com GPU.

## Garantias de catálogo
A IA não tem mais listas próprias desatualizadas: transições e efeitos vêm de `lib/engine` (`ALL_TRANSITIONS`, `EFFECT_LABELS`),
fontes/legendas/modelos/looks/sons da biblioteca (`libraryCatalogForAI`), e o prompt recebe o catálogo vivo a cada pedido.
