# EditorPro — análise de lacunas da UI (CapCut mobile × DaVinci Inspector × nós)

> Sessão Shell · 2026-11-19 · base: integração `71e9ee2`.
> Legenda de prioridade: **P0** (bloqueia o fluxo ou confunde) · **P1** (paridade esperada) · **P2** (pro) · **P3** (precisa de engine/IA nova).
> Status: ✅ temos · 🟡 parcial / escondido · ❌ falta.

## 1. Menu contextual do clipe no celular (CapCut)

| CapCut (vídeo selecionado) | Nós (barra contextual v2.2) | Status | Prioridade / ação |
|---|---|---|---|
| Dividir | Dividir (`splitAtPlayhead`) | ✅ | — |
| Velocidade › Normal / Curva | Velocidade (sheet: Normal \| Curva, presets) | ✅ | — |
| Volume (+ fade in/out) | Volume (sheet com fades, batidas, efeitos de voz) | ✅ | — |
| Animação › Entrada / Saída / Combo | Animações (Entrada/Saída/Loop) | ✅ | P2: prévia animada na miniatura |
| Excluir | Excluir | ✅ | — |
| Extrair áudio | Extrair áudio | ✅ | — |
| Substituir | Substituir (via sheet Editar) | 🟡 | P1: ação direta abre o seletor de arquivo |
| Duplicar | Duplicar | ✅ | — |
| Inverter (reverso) | Reverso | ✅ | P1: renomear para "Inverter" como no CapCut? → manter "Reverso" (Inverter = espelho V no Recortar) |
| Congelar | Congelar | ✅ | — |
| Cortar / Crop + Espelhar/Girar | Recortar (L/T/L/A + Espelhar/Inverter) | ✅ | P1: proporções fixas (9:16, 1:1…) no crop |
| Máscara | Máscara | ✅ | P2: inverter/suavizar via catálogo FX |
| Chroma | Chroma | ✅ | — |
| Opacidade | só dentro de "Posição" | 🟡 | **P0**: item próprio "Opacidade" (slider único) |
| Mistura (blend) | Mesclar | ✅ | P1: derivar modos do `BLEND_CATALOG` |
| Ajustar | Ajustes | ✅ | P1: virar "Cor" quando o `<ColorPanel/>` chegar (rodas/curvas) |
| Filtros | Filtros (+ Looks da biblioteca) | ✅ | — |
| Efeitos | Efeitos | ✅ | P1: derivar do `EFFECT_CATALOG` |
| Transição (entre clipes) | só pelo painel Transições | 🟡 | **P0**: item "Transição" no contextual do vídeo |
| Cor (DaVinci-like) | — | ❌ | P1: ferramenta "Cor" = `<ColorPanel/>` (módulo COR, import protegido) |
| Estabilizar | — | ❌ | P3: precisa de engine (análise de movimento) |
| Redução de ruído | efeito de voz `noise-reduction` | 🟡 | P1: atalho "Reduzir ruído" no contextual de áudio |
| Remover fundo | Remover fundo | ✅ | — |
| Ordem da camada (frente/trás) | — | ❌ | P2: precisa op/ação da timeline (`move_track`) |
| Keyframe (diamante) | botão na barra da timeline | 🟡 | **P0**: diamante por propriedade nos sliders de Posição/Opacidade |

Texto (CapCut: Editar, Estilo, Fonte, Animação, Texto→fala, Modelos): temos Editar/Estilo/Fonte/Animação/Duplicar/Excluir · ❌ Texto→fala (P3, IA) · 🟡 Modelos (no painel Texto).

Áudio (CapCut: Volume, Fades, Efeitos de voz, Velocidade, Batidas, Dividir, Redução de ruído, Separar voz): ✅ tudo menos Separar voz (P3) e atalho de ruído (P1).

## 2. Inspector do desktop (DaVinci)

| DaVinci › seção | Nós | Status | Prioridade / ação |
|---|---|---|---|
| **Transformar**: zoom X/Y, posição X/Y, rotação, âncora, pitch/yaw, espelhar | Escala única, X, Y, rotação, espelhar | 🟡 | P1: keyframe por propriedade + valor digitável; P3: zoom X/Y separados e âncora (contrato) |
| **Recorte**: L/R/T/B, suavidade | L/T/largura/altura | 🟡 | P2: suavidade (engine) |
| **Composição**: modo + opacidade | Mesclar + opacidade (separados) | 🟡 | P1: seção "Composição" junta modo + opacidade |
| **Velocidade dinâmica / Retime**: velocidade, direção, congelar, curva | Velocidade, reverso, congelar, curva | ✅ | — |
| **Estabilização** | — | ❌ | P3 (engine) |
| **Correção de lente** | — | ❌ | P3 (engine/FX) |
| **Áudio**: volume, pan, pitch, EQ | volume, pitch, efeitos | 🟡 | P2: pan/EQ (contrato + engine de áudio) |
| **Cor** (página Color) | Ajustes (sliders) | 🟡 | P1: aba "Cor" com `<ColorPanel/>` |
| Organização | sub-abas soltas | 🟡 | **P0**: seções recolhíveis com reset por seção (padrão DaVinci), estado lembrado |
| Valores digitáveis | só arrastar | ❌ | **P0**: tocar no número para digitar |

## 3. Projeto, histórico e app

| Item | Status | Prioridade |
|---|---|---|
| Projetos: abrir, renomear, duplicar, excluir | ✅ (linhas da home) | — |
| Buscar e ordenar projetos | ❌ | **P1** |
| Miniatura do projeto | ✅ (capa) | — |
| Histórico de desfazer visível (lista de passos, voltar a um ponto) | ❌ | **P1** |
| Tela de atalhos de teclado | ❌ | **P1** |
| Configurações: tema, qualidade do preview, idioma das legendas | 🟡 (só tema) | **P1** |

## 4. Plano (ordem de execução)

1. P0: Opacidade e Transição no contextual · seções recolhíveis com reset · valor digitável · diamante de keyframe por propriedade.
2. P1: catálogos FX (fallback às listas atuais) · aba/ferramenta Cor (import protegido) · busca/ordem de projetos · histórico visível · atalhos · configurações.
3. Teste de usabilidade (iniciante no celular; editor no desktop com teclado) → correções.
4. Revisão de código do módulo (object URLs, IndexedDB, estados presos, focus trap/scroll em sheets).
5. P2/P3 ficam registrados acima para as sessões donas (engine/FX/COR/timeline/IA).
