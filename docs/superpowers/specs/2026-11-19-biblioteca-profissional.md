# EditorPro — Biblioteca profissional (fontes, legendas, animações, modelos, cor, sons)

Pedido do Bruno (2026-11-19): "utilize elementos de edição profissional como os outros editores…
animações, legendas, fontes — pegue de exemplo de outros editores".

**Referências de mercado (só como inspiração de catálogo/UX):** CapCut (estilos de texto/legenda,
animações de entrada/saída/loop, efeitos, transições), Premiere Pro (Essential Graphics: lower thirds,
títulos; Lumetri: looks), DaVinci Resolve (Fusion titles, LUTs), Canva (modelos de texto), Submagic/Captions
(legendas de creator com destaque por palavra e emoji automático), After Effects (animadores por letra/palavra).

**Regras de licença:** nenhum arquivo proprietário. Fontes só OFL/Apache via Google Fonts (lista abaixo).
Nomes de presets descritivos/genéricos (não usar nomes de pessoas, marcas ou de produtos de terceiros).
Código de terceiros só MIT/Apache/ISC com crédito em `web/THIRD_PARTY_NOTICES.md`. Efeitos sonoros
**sintetizados** no navegador (WebAudio/OfflineAudioContext) → sem licença de áudio.

## Módulo novo (sessão "biblioteca")
Pastas: `web/lib/library/**`, `web/components/library/**`, `web/styles/library.css`.

### 1. Fontes (`lib/library/fonts.ts`)
~30 famílias curadas por categoria (Impacto, Moderna, Elegante, Manuscrita, Divertida, Mono, Condensada):
Montserrat, Anton, Bebas Neue, Oswald, Archivo Black, Poppins, Inter, Plus Jakarta Sans, DM Sans, Space Grotesk,
Rubik, Barlow Condensed, League Spartan, Outfit, Sora, Playfair Display, DM Serif Display, Cormorant Garamond,
Lora, Libre Baskerville, Permanent Marker, Caveat, Pacifico, Dancing Script, Kalam, Bangers, Luckiest Guy,
Righteous, Lilita One, Fredoka, Chewy, JetBrains Mono, Space Mono — com pesos disponíveis.
`ensureFont(family, weights?)` injeta o CSS do Google Fonts sob demanda e aguarda `document.fonts.load`
(o engine chama antes de desenhar/exportar). `FONT_CATALOG` com metadados p/ o seletor.

### 2. Estilos de legenda (`lib/library/captions.ts`)
~20 presets `CaptionPresetDef { id, name, category, style: Partial<CaptionStyle>, sample }` usando os campos
novos (`wordBox`, `activeScale`, `inactiveOpacity`, `autoEmoji`, `lines`, `jitter`, `glow`, `shadow*`).
Ex.: "Impacto amarelo" (Anton maiúsculas, contorno grosso, palavra ativa amarela + escala), "Caixa por palavra",
"Karaokê acendendo", "Neon", "Minimal branco", "Clássico TV", "Gradiente", "Contorno grosso", "Sombra longa",
"Duas cores", "Destaque marca-texto", "Pop com emoji", "Máquina de escrever", "Serifada elegante",
"Manuscrita", "Retrô 80s", "Notícia (faixa)", "Podcast", "Tutorial", "Cinema (letterbox)".
Mapa de emoji por palavra-chave PT-BR para `autoEmoji` (`emojiFor(word)`).

### 3. Animações (`lib/library/animations.ts`)
Catálogo com metadados (nome, categoria entrada/saída/loop, duração sugerida) para TextAnimation e
ClipAnimation, incluindo as novas por palavra/letra (`word-*`, `char-*`, `stomp`, `highlight-sweep`…).
O **engine** implementa o desenho; a biblioteca só descreve e dá prévias.

### 4. Modelos de texto e motion graphics (`lib/library/templates.ts`)
Funções que geram `EditOp[]` (TextClip + ShapeClip + sticker, mesmo `groupId`): títulos (impacto, elegante,
cinema), subtítulo, **lower thirds** (5 estilos: barra, caixa, linha animada, glass, minimal), **CTA**
("Siga", "Inscreva-se", "Link na bio", "Comente"), contador/regressiva, citação, preço/oferta, lista (1-2-3),
capítulo, barra de progresso, "antes/depois", nome na tela, logo/marca d'água. Cada modelo com parâmetros
(texto, cores da marca) e animação de entrada/saída.

### 5. Looks de cor (`lib/library/looks.ts`)
~16 gradações tipo LUT como combinações de `Filter[]` + `colorPreset`: Teal & Orange, Filme quente, Filme frio,
Desbotado matte, P&B contraste, P&B suave, Vintage 70s, Pastel, Vibrante, Noir, Verão, Inverno, Pôr do sol,
Neon noturno, Natural+, Cinema verde. Com intensidade (0–1) que interpola a partir do neutro.

### 6. Efeitos sonoros sintetizados (`lib/library/sfx.ts`)
`synthSfx(id): Promise<Blob WAV>` com OfflineAudioContext: whoosh (ruído com filtro varrendo), swoosh curto,
pop, click, ding, sino, impacto/boom grave, riser (subida), drop, glitch, digitar teclado, notificação,
cash/"caixa registradora" estilizado, aplausos (ruído em rajadas), "erro"/buzzer, camera shutter.
Ao escolher, gera o WAV, ingere como asset (`emit('ep:attach-files', {files:[File], role:'music'})` ou via
`ingestFile` de lib/media) e coloca um AudioClip no playhead.

### 7. Galerias (`components/library/*`)
Componentes reutilizáveis que o shell monta nos painéis: `FontPicker` (busca + categorias + prévia na
própria fonte), `CaptionStyleGallery` (miniaturas animadas renderizadas com o engine num canvas pequeno),
`TextTemplateGallery`, `MotionTemplateGallery`, `AnimationPicker` (prévia em loop ao passar/tocar),
`LookGallery` (miniatura do quadro atual com o look), `SfxList` (ouvir/inserir). Visual design v2.

## Integração com outros módulos
- **Engine:** implementar as TextAnimation novas, `wordBox`/`activeScale`/`inactiveOpacity`/`jitter`/`lines`,
  `glow`/`shadow*`/`backgroundPadding`, chamar `ensureFont` antes de render/export, respeitar `groupId` só como metadado.
- **Shell:** trocar listas próprias pelas galerias da biblioteca nos painéis Texto, Legendas, Efeitos/Filtros,
  Áudio (aba "Efeitos sonoros"), e uma ferramenta nova "Modelos".
- **Timeline:** mover/excluir em grupo clipes com o mesmo `groupId` (selecionar um seleciona o grupo; Alt solta).
- **IA:** o prompt conhece os ids (presets de legenda, looks, modelos, sfx, fontes) e pode aplicá-los.
