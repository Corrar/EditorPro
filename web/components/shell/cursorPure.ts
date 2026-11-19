/** deslocamento horizontal do balão do cursor da IA, preso dentro da tela dos dois lados (puro, testado) */
export function bubbleOffset(x: number, viewport: number, width: number, margin = 8, preferred = 16): number {
  const minDx = margin - x; // não passa da borda esquerda
  const maxDx = viewport - margin - width - x; // não passa da borda direita
  if (maxDx < minDx) return minDx; // tela menor que o balão: encosta à esquerda
  return Math.max(minDx, Math.min(maxDx, preferred));
}
