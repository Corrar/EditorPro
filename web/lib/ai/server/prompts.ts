/* carrega os prompts de web/prompts/*.md (servidor). Incluídos no bundle via
   outputFileTracingIncludes (next.config.mjs). Cache em memória. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type PromptName = 'edit-system' | 'analyze-reference' | 'transcribe';

const cache = new Map<PromptName, string>();

export async function loadPrompt(name: PromptName): Promise<string> {
  const hit = cache.get(name);
  if (hit && process.env.NODE_ENV === 'production') return hit;
  const file = path.join(process.cwd(), 'prompts', `${name}.md`);
  const text = await readFile(file, 'utf8');
  cache.set(name, text);
  return text;
}
