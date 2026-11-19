/* =====================================================================
   Biblioteca · emoji automático por palavra-chave (PT-BR).
   Usado pelas legendas com `autoEmoji` (o engine pergunta emojiFor(word)).
   Mapa escrito à mão; sem dependência externa.
   ===================================================================== */

/** palavra (sem acento, minúscula) -> emoji. Radicais ganham variações por stemming leve. */
const MAP: Record<string, string> = {
  // dinheiro / negócios
  dinheiro: '💰', grana: '💸', reais: '💵', rico: '🤑', lucro: '📈', venda: '📈', vendas: '📈', vender: '🛒',
  comprar: '🛒', compra: '🛒', preco: '🏷️', desconto: '🏷️', promocao: '🏷️', oferta: '🏷️', gratis: '🎁', investir: '📊',
  investimento: '📊', negocio: '💼', empresa: '🏢', trabalho: '💼', emprego: '💼', cliente: '🤝', parceria: '🤝', meta: '🎯',
  objetivo: '🎯', foco: '🎯', crescer: '📈', crescimento: '📈', cair: '📉', queda: '📉', banco: '🏦', cartao: '💳', pix: '💸',
  // emoções
  amor: '❤️', amo: '❤️', coracao: '❤️', paixao: '😍', lindo: '😍', linda: '😍', feliz: '😄', alegria: '😄', rir: '😂',
  risada: '😂', engracado: '😂', kkk: '😂', triste: '😢', chorar: '😭', medo: '😱', susto: '😱', raiva: '😡', bravo: '😡',
  chocado: '😳', choque: '😳', surpresa: '😮', uau: '🤯', incrivel: '🤯', inacreditavel: '🤯', louco: '🤪', calma: '😌',
  cansado: '😴', sono: '😴', dormir: '😴', obrigado: '🙏', obrigada: '🙏', gratidao: '🙏', fe: '🙏', deus: '🙏',
  // pensar / atenção
  ideia: '💡', dica: '💡', dicas: '💡', segredo: '🤫', pensar: '🤔', pergunta: '❓', porque: '❓', duvida: '❓', resposta: '💬',
  atencao: '⚠️', cuidado: '⚠️', perigo: '🚨', alerta: '🚨', urgente: '🚨', importante: '❗', erro: '❌', errado: '❌',
  nunca: '🚫', proibido: '🚫', certo: '✅', correto: '✅', ok: '👌', perfeito: '👌', pronto: '✅', olha: '👀',
  veja: '👀', olho: '👀', cerebro: '🧠', inteligente: '🧠', inteligencia: '🧠', aprender: '📚', estudar: '📚', livro: '📚',
  escola: '🎓', faculdade: '🎓', curso: '🎓', aula: '🧑‍🏫', verdade: '💯', cem: '💯', mentira: '🤥',
  // energia / sucesso
  fogo: '🔥', top: '🔥', brabo: '🔥', quente: '🔥', viral: '🔥', rapido: '⚡', energia: '⚡', poder: '⚡', forca: '💪', forte: '💪',
  treino: '💪', academia: '🏋️', vencer: '🏆', vitoria: '🏆', sucesso: '🏆', campeao: '🏆', primeiro: '🥇', melhor: '🥇',
  estrela: '⭐', brilho: '✨', magia: '✨', novo: '✨', nova: '✨', novidade: '✨', foguete: '🚀', lancamento: '🚀', decolar: '🚀',
  subir: '🚀', festa: '🎉', parabens: '🎉', comemorar: '🎉', presente: '🎁', surpreender: '🎁',
  // tempo
  tempo: '⏰', hora: '⏰', hoje: '📅', amanha: '📅', semana: '📅', noite: '🌙',
  // tecnologia / mídia
  celular: '📱', telefone: '📱', app: '📱', computador: '💻', internet: '🌐', video: '🎬', filme: '🎬', foto: '📸', camera: '📸',
  musica: '🎵', som: '🔊', microfone: '🎤', podcast: '🎙️', jogo: '🎮', game: '🎮', robo: '🤖', ia: '🤖', email: '📧',
  mensagem: '💬', comentario: '💬', comente: '💬', link: '🔗', seguir: '➕', siga: '➕', inscreva: '🔔', notificacao: '🔔',
  // vida / lugares
  casa: '🏠', familia: '👨‍👩‍👧', amigo: '🫂', amigos: '🫂', bebe: '👶', filho: '👶', mae: '👩', pai: '👨', carro: '🚗', viagem: '✈️',
  viajar: '✈️', aviao: '✈️', praia: '🏖️', mar: '🌊', sol: '☀️', chuva: '🌧️', frio: '🥶', calor: '🥵', mundo: '🌍', brasil: '🇧🇷',
  cidade: '🏙️', natureza: '🌿', planta: '🌱', flor: '🌸', agua: '💧', saude: '🩺', medico: '🩺', remedio: '💊', coracaozinho: '💖',
  // comida
  comida: '🍔', comer: '🍽️', fome: '🤤', delicia: '🤤', gostoso: '😋', cafe: '☕', pizza: '🍕', hamburguer: '🍔', bolo: '🎂',
  doce: '🍬', chocolate: '🍫', cerveja: '🍺', vinho: '🍷', receita: '👩‍🍳', cozinhar: '👩‍🍳',
  // animais
  cachorro: '🐶', cao: '🐶', gato: '🐱', pet: '🐾', passaro: '🐦', peixe: '🐟',
};

export function normEmojiKey(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** emoji para a palavra (ou null). Tenta a palavra, depois plural/diminutivo/aumentativo simples. */
export function emojiFor(word: string): string | null {
  const k = normEmojiKey(word);
  if (k.length < 2) return null;
  if (MAP[k]) return MAP[k];
  const cands: string[] = [];
  if (k.endsWith('oes')) cands.push(`${k.slice(0, -3)}ao`);
  if (k.endsWith('aes')) cands.push(`${k.slice(0, -3)}ao`);
  if (k.endsWith('es')) cands.push(k.slice(0, -2));
  if (k.endsWith('s')) cands.push(k.slice(0, -1));
  if (k.endsWith('inho') || k.endsWith('inha')) cands.push(`${k.slice(0, -4)}o`, `${k.slice(0, -4)}a`, `${k.slice(0, -4)}e`, k.slice(0, -4));
  if (k.endsWith('inhos') || k.endsWith('inhas')) cands.push(`${k.slice(0, -5)}o`, `${k.slice(0, -5)}a`);
  if (k.endsWith('ao') && k.length > 5) cands.push(`${k.slice(0, -2)}o`, `${k.slice(0, -2)}a`);
  // verbos conjugados comuns -> infinitivo (ex.: "aprendi" -> "aprender")
  for (const suf of ['ando', 'endo', 'indo']) if (k.endsWith(suf)) cands.push(`${k.slice(0, -suf.length)}${suf[0]}r`);
  for (const c of cands) if (MAP[c]) return MAP[c];
  return null;
}

/** primeiro emoji de um conjunto de palavras (p/ 1 emoji por bloco de legenda) */
export function emojiForWords(words: string[]): string | null {
  for (const w of words) {
    const e = emojiFor(w);
    if (e) return e;
  }
  return null;
}

/** palavras-chave conhecidas (p/ a IA e testes) */
export const EMOJI_KEYWORDS = Object.keys(MAP);
