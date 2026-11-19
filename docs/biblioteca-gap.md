# Biblioteca — análise de lacunas (EditorPro × CapCut/DaVinci)

> 2026-11-19 · sessão biblioteca. Referência só de catálogo/UX; nada proprietário é copiado.
> Prioridade: **P0** = sem isso parece amador; **P1** = esperado num editor nível CapCut; **P2** = diferencial.

## Hoje (antes desta rodada)

| Área | EditorPro hoje | CapCut (referência) | Lacuna |
|---|---|---|---|
| Estilos de legenda | 30 presets em 4 categorias, destaque da palavra ativa, caixa por palavra, karaokê acendendo, emoji automático, jitter | centenas de "Caption templates" por tendência; ênfase automática de palavras-chave; 1–3 palavras por vez; efeitos 3D/contorno duplo | **P0** quantidade (≥80) e categorias; **P0** ênfase automática; **P1** zonas seguras por plataforma; **P1** regras de quebra (não deixar palavra órfã, não quebrar antes de pontuação) |
| Texto no motor | contorno simples, sombra detalhada, brilho (glow), gradiente linear, caixa de fundo, marca-texto/sublinhado/caixa animados, animação por palavra e letra | múltiplos contornos, curvo, 3D/extrusão, sombra longa, fundo com desfoque, espaçamento/entrelinha, bolhas | **P0** contorno duplo, sombra longa, extrusão; **P1** texto curvo, fundo desfocado; **P1** cache rasterizado p/ celular |
| Animações de texto | 34 (entrada/saída/loop; por palavra/letra; ênfase) | ~150 entrada/saída/loop + "combo" | **P1** variações (direção, intensidade); **P2** combos |
| Modelos de texto/motion | 30 (títulos, 5 lower thirds, CTAs, contador, preço, lista, enquete, avaliação, assinatura…) | milhares (templates de texto + "Text effects") | **P0** ≥60 com variações de cor/estilo; **P1** pacotes temáticos |
| Fontes | 33 OFL/Apache, sob demanda | centenas, com favoritos | **P0** ≥60; **P1** favoritos/recentes na busca |
| Looks | 16 com intensidade (clipe/camada) | dezenas de filtros + LUTs | (agora com sessão "cor"/ColorGrade — fora do meu módulo) |
| SFX | 24 sintetizados | biblioteca com milhares por categoria | **P0** ≥100 por categoria (variações sintetizadas) |
| Stickers/emoji | emoji solto via StickerClip | pacotes animados por tema | **P1** pacotes de emoji/stickers por tema |
| Usabilidade | busca única, categorias, prévias animadas | favoritos, recentes, "Em alta", aplicar em 1 toque | **P0** favoritos + recentes; **P1** aplicar em 1 toque nos modelos (inserção rápida) |

## Plano desta rodada (ordem de entrega)
1. **P0** Revisão de código + correções com teste (ex.: looks no vídeo todo empilhavam camadas — corrigido).
2. **P0** Legendas ≥80 em categorias (Creator, Karaokê, Caixa, Contorno, Neon/Brilho, 3D, Minimal, Elegante, Notícia, Gamer, Divertido), ênfase automática de palavras-chave, zonas seguras (TikTok/Reels/Shorts/YouTube) e regras de quebra de linha.
3. **P0** Texto no motor (`lib/engine/textDraw.ts`, agora da biblioteca): contorno duplo, sombra longa, extrusão 3D, fundo desfocado, texto curvo, entrelinha/espaçamento; cache de texto estático rasterizado; custo medido.
4. **P0** Modelos ≥60, fontes ≥60 (subsets latin + latin-ext servidos pelo Google via unicode-range), pacotes de emoji/stickers, SFX ≥100 (variações paramétricas sintetizadas, licença própria).
5. **P0** Usabilidade: favoritos e recentes (todas as abas), inserção em 1 toque, teste Playwright no Pixel 7 e desktop.

## Fora do escopo do módulo
Efeitos visuais e transições (sessão FX), correção de cor/ColorGrade (sessão cor), timeline (grupo por `groupId`).
