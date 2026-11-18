# EditorPro — paridade de funções com CapCut (checklist)

Contrato ampliado em `web/lib/types.ts` / `ops.ts` (tudo opcional/aditivo). Dono de cada item entre colchetes.

## Edição básica
- [timeline] dividir, aparar, mover, excluir, ripple, duplicar (`duplicate_clip`), copiar/colar, multi-seleção,
  trilha principal magnética (fecha buracos), modo inserir/sobrescrever, adicionar/reordenar trilhas (`move_track`),
  marcadores (`add_marker`…; tecla M), congelar quadro, separar áudio do vídeo, keyframes (losangos no clipe).
- [shell] desfazer/refazer, salvar automático, projetos (duplicar/renomear/excluir), formatos 9:16/16:9/1:1/4:5.

## Vídeo
- [engine+shell] velocidade normal e **curvas** (`speedCurve`/`speedPreset`: montagem, herói, bala, jump cut, flash in/out),
  **reverso** (`reverse`), recorte (`crop`), espelhar (`flipH/flipV`), encaixe (`fit`), **tela de fundo**
  (`project.canvas`: cor/desfoque/imagem), opacidade, **modos de mesclagem** (`blendMode`), **máscaras** (`mask`),
  **chroma key** (`chromaKey`), **remover fundo** (`removeBackground`, segmentação no navegador),
  **picture-in-picture** (trilhas de vídeo extras), **animações de entrada/saída/loop** (`animationIn/Out/Loop`),
  keyframes de posição/escala/rotação/opacidade.
- [engine] **efeitos** (`effects`: tremor, glitch, RGB split, pulso, VHS, granulado, light leak, pixelado, espelho,
  caleidoscópio, desfoque de movimento, estroboscópio, filme antigo, brilho, neon, barras de cinema),
  **filtros/ajustes** (exposição, contraste, realces, sombras, saturação, temperatura, matiz, nitidez, vinheta, fade),
  presets de cor, **camada de ajuste** (`type:'adjustment'`), ≥24 **transições**.

## Texto e legendas
- [engine+shell] textos com fontes, contorno, sombra, caixa (com raio), gradiente, espaçamento, entrelinha, itálico,
  sublinhado, animações de entrada/saída/loop, keyframes, **modelos de texto** (título, lower third, CTA, contador…).
- [ai+engine+shell] **legendas automáticas**, presets (karaokê, bold-pop…), editar segmentos, **traduzir legendas**,
  **remover vícios de linguagem** (né, tipo, é…) via tempos das palavras, exportar SRT/VTT.

## Sobreposições
- [engine+shell] **stickers/emoji** (`type:'sticker'`), **formas** (`type:'shape'`), imagens/logos, PiP.

## Áudio
- [engine+shell] volume, fade, mudo, **efeitos de voz** (`audioEffects`: redução de ruído, normalizar, realçar voz,
  esquilo, grave, robô, eco, reverb, telefone, megafone, grave reforçado), tom (`pitch`), **ducking**,
  **gravar narração** (microfone), **extrair áudio** de vídeo, **detectar batidas** (`asset.beats`) + marcadores de batida,
  waveform.

## IA (Claude + navegador)
- [ai] edição por descrição + vídeo-exemplo (ao vivo), chat de ordens, cortar silêncios, cortar vícios,
  **destaques automáticos** (melhores trechos pela transcrição), **sincronizar cortes na batida**,
  **auto-reframe** (9:16 seguindo o rosto/assunto), ganchos/títulos, capítulos/marcadores, traduzir legendas.

## Exportar
- [engine] MP4/WebM, 540p/720p/1080p/4K (se o aparelho aguentar), 24/30/60 fps, só áudio (WAV/M4A),
  quadro atual como imagem (PNG), SRT/VTT, FCPXML (DaVinci/Final Cut/Premiere).
