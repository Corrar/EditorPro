# Timeline — análise de lacunas (DaVinci Resolve Edit/Cut · CapCut × EditorPro)

> Módulo Timeline · 2026-11-19. Referências: DaVinci Resolve 19 (páginas **Edit** e **Cut**) e
> CapCut (desktop e celular). Legenda: ✅ temos · 🟡 parcial · ❌ falta.
> Prioridade: **P0** = sem isso não parece um editor profissional · **P1** = esperado por quem
> vem do DaVinci/CapCut · **P2** = diferencial ou nicho.

## 1. Edição básica e modos de ferramenta

| Ferramenta | DaVinci | CapCut | EditorPro hoje | Prio |
|---|---|---|---|---|
| Modo Seleção (A) / Lâmina (B) | ✅ | 🟡 (só botão Dividir) | ❌ só "Dividir no cursor" | **P0** |
| Dividir no cursor (Ctrl+B / S) | ✅ | ✅ | ✅ `S` | — |
| Cortar em **todas** as trilhas | ✅ Ctrl+Shift+B | ❌ | ❌ | **P0** |
| Excluir / excluir com ripple | ✅ | ✅ | ✅ Del / Shift+Del | — |
| Trilha magnética (sem buracos) | 🟡 | ✅ | ✅ ímã + magnetismo | — |
| Inserir / sobrescrever ao soltar | ✅ F9/F10 | 🟡 | ✅ | — |
| Duplicar / copiar / recortar / colar | ✅ | ✅ | ✅ | — |
| **Colar atributos** (Alt+V) | ✅ | 🟡 copiar estilo | ❌ | **P1** |
| Desfazer/refazer | ✅ | ✅ | ✅ (1 op-array = 1 desfazer) | — |

## 2. Aparar (trim) profissional

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Aparar pontas com encaixe | ✅ | ✅ | ✅ | — |
| **Ripple trim** (aparar empurra o resto) | ✅ | ✅ (magnético) | 🟡 só na principal magnética | **P0** |
| **Roll** (move o corte entre 2 clipes) | ✅ | ❌ | ❌ | **P0** |
| **Slip** (muda o trecho da mídia, mantém posição) | ✅ | ❌ | ❌ | **P1** |
| **Slide** (move o clipe, ajusta vizinhos) | ✅ | ❌ | ❌ | **P1** |
| Prévia de quadros nas pontas (2-up) | ✅ | ❌ | ❌ | **P1** |
| Tooltip de duração/delta ao aparar | ✅ | ✅ | ✅ duração | — |

## 3. Trilhas

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Travar / mudo / ocultar | ✅ | ✅ | ✅ | — |
| **Solo** | ✅ | ❌ | ❌ | **P1** |
| **Altura ajustável** por trilha | ✅ | ❌ | ❌ (altura automática) | **P1** |
| Reordenar / renomear / adicionar | ✅ | 🟡 | ✅ | — |

## 4. Vínculo áudio/vídeo

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Separar áudio do vídeo | ✅ | ✅ | ✅ "Separar áudio" | — |
| **Vincular/desvincular** (move/apara junto) | ✅ Ctrl+Alt+L | 🟡 | ❌ (grupos servem p/ modelos) | **P0** |
| **J-cut / L-cut** (aparar só o áudio vinculado) | ✅ Alt+arrastar | ❌ | ❌ | **P1** |

## 5. Seleção e organização

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Laço (retângulo) no desktop | ✅ | ✅ | ✅ marquee | — |
| Multi-seleção no toque | ❌ | ✅ | 🟡 só por Ctrl/laço | **P1** |
| Agrupar | 🟡 | ✅ | ✅ `groupId` (modelos) — falta "Agrupar/Desagrupar" manual | **P1** |
| Clipe composto | ✅ | ✅ | ❌ (exige engine; ver §10) | **P2** |
| Marcadores com cor e nota | ✅ | 🟡 | ✅ cor, nome, capítulo, comentário | — |
| Faixa In/Out (I/O) | ✅ | ❌ | 🟡 seleção de trecho na régua, sem I/O | **P0** |

## 6. Navegação e atalhos

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| **J/K/L shuttle** (multi-velocidade) | ✅ | ❌ | ❌ (K = keyframe) | **P0** |
| Setas quadro a quadro, Shift = 1s | ✅ | ✅ | ✅ | — |
| ↑/↓ ir ao corte anterior/próximo | ✅ | ❌ | ❌ | **P1** |
| Shift+Z ajustar à janela | ✅ | ✅ | 🟡 botão, sem atalho | **P0** |
| **Tela de ajuda** de atalhos (?) | ✅ | ✅ | ❌ | **P0** |
| Minimapa | ❌ | ❌ | ✅ | — |

## 7. Keyframes

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Diamantes no clipe, arrastáveis | ✅ | ✅ | ✅ (transform inteiro) | — |
| **Lane por propriedade** (pos/escala/rot/opac/volume) | ✅ | 🟡 | ❌ | **P1** |
| **Editor de curva** (linear/ease/bezier) | ✅ | 🟡 presets | 🟡 `easing` no contrato, sem UI | **P1** |
| **Rampa de velocidade** (gráfico) | ✅ | ✅ curvas | 🟡 `speedCurve` no contrato, sem editor | **P1** |

## 8. Áudio na timeline

| Ferramenta | DaVinci | CapCut | EditorPro | Prio |
|---|---|---|---|---|
| Forma de onda real | ✅ | ✅ | ✅ (`asset.waveform`, ~100/s) | — |
| Onda nítida com zoom (detalhe) | ✅ | ✅ | 🟡 cap de 1024 barras | **P1** |
| Fades nas pontas (alças) | ✅ | ✅ | 🟡 desenhado, sem alça de arrastar | **P1** |
| **Batidas automáticas** + encaixe | ❌ | ✅ "Batida" | 🟡 detector em `lib/media/beats` (painel); falta botão na timeline | **P1** |
| Volume por keyframe (rubber band) | ✅ | ✅ | ❌ (entra com a lane de volume) | **P1** |

## 9. Celular

| Ferramenta | CapCut | EditorPro | Prio |
|---|---|---|---|
| Playhead fixo ao centro + rolar | ✅ | ✅ modo centro | — |
| Pinça para zoom | ✅ | ✅ ancorada no centro | — |
| Toque longo = arrastar clipe | ✅ | ✅ | — |
| Alças de corte grandes | ✅ | ✅ 44px | — |
| Multi-seleção | ✅ | ❌ | **P1** |
| Fricção medida (Pixel 7 / iPhone SE) | — | a medir (§ tarefa 5) | **P0** |

## 10. Fora do escopo da timeline (depende de outros módulos)

- **Clipe composto**: precisa de suporte no engine (renderizar sub-timeline) e no contrato.
- **Prévia 2-up no trim** usa quadros do engine; na timeline mostramos as miniaturas das pontas.
- Mixer/faders e EQ por trilha: painel de áudio (shell).

## Plano de execução (ordem)

1. **P0 de edição**: modos Seleção/Lâmina, cortar em todas as trilhas, ripple/roll, I/O, J/K/L,
   Shift+Z, tela de ajuda de atalhos, vincular/desvincular.
2. **P1 de edição**: slip/slide com prévia, J/L-cut, solo, altura de trilha, colar atributos,
   agrupar manual, ↑/↓ entre cortes, multi-seleção no toque.
3. **Keyframes**: lanes por propriedade + curvas; editor de rampa (`speedCurve`).
4. **Áudio**: onda em mais detalhe, alças de fade, batidas automáticas + encaixe.
5. **Celular**: medir fricção no Playwright e corrigir.
6. **Revisão de código** com testes de regressão.
