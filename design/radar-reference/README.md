# Referência visual — Radar Local (somente leitura)

Cópia do painel Radar Local (repo `Corrar/Radar-Local`, `painel-web/app/page.tsx` e `globals.css`)
para servir de **modelo de design** do EditorPro. Não é código do EditorPro (extensão `.txt` para
não entrar no build). Padrões a seguir:
- Shell: sidebar de altura total (`.rl-sidebar`/`.rl-rail`): cabeçalho com logo + botão recolher,
  busca, grupos com título (`.rl-sect`), itens `.rl-navitem` (ativo = gradiente laranja), seletor
  segmentado (`.rl-segside`), menu do usuário (`.rl-userwrap`) e rodapé com Sair + tema (`.rl-sbfoot`).
- Header dentro do conteúdo (`.rl-header`, `.rl-h1`, pílulas `.rl-statpill`).
- Mobile (≤900px): barra inferior de botões circulares (`.rl-bottomnav`/`.rl-bnitem`) + bottom-sheet
  "Menu" (`.rl-menusheet`). PWA instalável (botão `.rl-installbtn`).
- Cards sólidos com avatar (`.rl-card`, `.rl-cardav`), badges/pílulas, toasts, modais, skeleton.
- Ícones SVG de traço próprio (componente `Icon` no page.tsx).
No EditorPro as classes equivalentes usam o prefixo `.ep-` (já portadas em `web/app/globals.css`).
