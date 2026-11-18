import { describe, expect, it } from 'vitest';
import { PROJECT_TEMPLATES, projectFromTemplate } from './templates';

describe('modelos de projeto', () => {
  it('cada modelo cria projeto no formato certo', () => {
    for (const t of PROJECT_TEMPLATES) {
      const p = projectFromTemplate(t.id);
      expect(p.aspect).toBe(t.aspect);
      expect(p.name).toBe(t.label);
      expect(p.tracks.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('Reels com legenda liga as legendas bold-pop e tem gancho', () => {
    const p = projectFromTemplate('reels-captions');
    expect(p.captions.enabled).toBe(true);
    expect(p.captions.style.preset).toBe('bold-pop');
    expect(p.tracks.find((t) => t.kind === 'text')!.clips[0].label).toBe('gancho');
  });
});
