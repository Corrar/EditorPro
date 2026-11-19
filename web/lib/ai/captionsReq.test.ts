/* "Coloque legenda no vídeo" (print do Bruno no celular): o modo local precisa entender as formas do verbo. */
import { describe, expect, it } from 'vitest';
import { CAPTION_ADD, canonVerbs, demoNeeds } from './demo';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

describe('pedido de legenda', () => {
  it.each(['Coloque legenda no vídeo', 'coloca legendas', 'gere as legendas', 'adicione legenda', 'põe legenda aí', 'bota legenda', 'quero legenda', 'insira legendas', 'faça as legendas'])('entende "%s"', (txt) => {
    expect(CAPTION_ADD.test(norm(txt))).toBe(true);
    expect(demoNeeds(txt).silences).toBe(true);
  });
  it('não confunde com outros pedidos', () => {
    expect(CAPTION_ADD.test(norm('legenda maior'))).toBe(false);
  });

  it('normaliza verbos só no começo da oração', () => {
    expect(canonVerbs('Coloque legenda no vídeo')).toBe('coloca legenda no vídeo');
    expect(canonVerbs('pode adicionar um efeito VHS e corte os primeiros 3 s')).toBe('pode adiciona um efeito VHS e corta os primeiros 3 s');
    expect(canonVerbs('Faça um corte seco e aplique o look cinema')).toBe('faz um corte seco e aplica o look cinema');
    expect(canonVerbs('Remova o fundo, ligue as legendas')).toBe('remove o fundo, liga as legendas');
    expect(canonVerbs('lower third com meu nome João')).toBe('lower third com meu nome João');
    expect(canonVerbs('mais destaque no ajuste de cor')).toBe('mais destaque no ajuste de cor');
  });
});
