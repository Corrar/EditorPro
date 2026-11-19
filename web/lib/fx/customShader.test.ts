import { describe, expect, it } from 'vitest';
import { checkShader, parseShaderLog, SHADER_EXAMPLES, SHADER_PRELUDE_DOC, shaderHash, staticCheck, wrapShader, SHADER_MAX_CHARS } from './customShader';
import { applyCustomEffect, runCustomTransition } from './customRender';
import { effectDisplayName, transitionDisplayName, effectEntry, transitionEntry } from './catalog';
import { EFFECT_LABELS, hasSurfaceEffects } from '../engine/effects';
import { TRANSITION_LABELS, transitionVisual } from '../engine/transitions';
import { isShaderTransition } from '../engine/shaderTransitions';

const preludeLines = (stage: 'effect' | 'transition') => wrapShader('X', stage).split('\n').indexOf('X');

describe('customShader', () => {
  it('wrapShader: prelúdio + código + main', () => {
    const src = wrapShader('vec4 effect(vec2 uv){return tex(uv);}', 'effect');
    expect(src).toContain('uniform sampler2D uTex;');
    expect(src).toContain('uniform float uParams[8];');
    expect(src).toMatch(/void main\(\)\{vec4 c=effect\(v_uv\)/);
    const tr = wrapShader('vec4 transition(vec2 uv){return getToColor(uv);}', 'transition');
    expect(tr).toContain('uniform sampler2D uFrom,uTo;');
    expect(tr).toContain('getFromColor');
  });
  it('linha do erro é relativa ao código do usuário', () => {
    const n = preludeLines('effect');
    const log = `ERROR: 0:${n + 3}: 'foo' : undeclared identifier\nERROR: 0:${n + 3}: '' : compilation terminated`;
    expect(parseShaderLog(log, 'effect')).toEqual({ error: "'foo' : undeclared identifier", line: 3 });
    expect(parseShaderLog('ERROR: 0:2: bad', 'effect').line).toBeUndefined(); // dentro do prelúdio
    expect(parseShaderLog('lixo', 'effect').error).toBe('lixo');
    const nt = preludeLines('transition');
    expect(parseShaderLog(`ERROR: 0:${nt + 1}: x`, 'transition').line).toBe(1);
  });
  it('checagens estáticas', () => {
    expect(staticCheck('', 'effect').ok).toBe(false);
    expect(staticCheck('vec4 transition(vec2 uv){return vec4(1.);}', 'effect').ok).toBe(false);
    expect(staticCheck('vec4 effect(vec2 uv){return vec4(1.);}\nvoid main(){}', 'effect')).toMatchObject({ ok: false, line: 2 });
    expect(staticCheck('#extension GL_OES_standard_derivatives : enable\nvec4 effect(vec2 uv){return vec4(1.);}', 'effect')).toMatchObject({ ok: false, line: 1 });
    expect(staticCheck('vec4 effect(vec2 uv){return vec4(1.);', 'effect').ok).toBe(false);
    expect(staticCheck('vec4 effect(vec2 uv){ gl_FragColor=vec4(1.); return vec4(1.);}', 'effect').ok).toBe(false);
    expect(staticCheck('vec4 effect(vec2 uv){return vec4(1.);}' + ' '.repeat(SHADER_MAX_CHARS), 'effect').ok).toBe(false);
    expect(staticCheck('vec4 effect( vec2 p ){return tex(p);}', 'effect').ok).toBe(true);
  });
  it('fora do navegador degrada sem quebrar', () => {
    expect(checkShader('vec4 effect(vec2 uv){return tex(uv);}', 'effect')).toEqual({ ok: true });
    expect(checkShader('nada', 'effect').ok).toBe(false);
  });
  it('hash estável e distinto por estágio', () => {
    expect(shaderHash('a', 'effect')).toBe(shaderHash('a', 'effect'));
    expect(shaderHash('a', 'effect')).not.toBe(shaderHash('a', 'transition'));
    expect(shaderHash('a', 'effect')).not.toBe(shaderHash('b', 'effect'));
  });
  it('exemplos: 8+, passam nas checagens estáticas, cobrem os pedidos', () => {
    expect(SHADER_EXAMPLES.length).toBeGreaterThanOrEqual(8);
    for (const ex of SHADER_EXAMPLES) expect(staticCheck(ex.code, ex.stage), ex.id).toEqual({ ok: true });
    const ids = SHADER_EXAMPLES.map((e) => e.id);
    for (const id of ['waves', 'neon-scanline', 'rain', 'gradient-bg', 'particles', 'beat-pulse', 'spiral', 'diagonal-pixels']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('doc do prelúdio ≤ 1.200 caracteres e cita o essencial', () => {
    expect(SHADER_PRELUDE_DOC.length).toBeLessThanOrEqual(1200);
    for (const w of ['effect', 'transition', 'uTex', 'uParams', 'getFromColor', 'fbm', 'for']) expect(SHADER_PRELUDE_DOC).toContain(w);
  });
  it('sem WebGL: efeito = passagem direta, transição = null (motor cai no dissolver)', () => {
    const fake = { canvas: {} } as unknown as CanvasRenderingContext2D;
    expect(applyCustomEffect(fake, 10, 10, { kind: 'custom', intensity: 1, code: SHADER_EXAMPLES[0].code }, 0)).toBe(false);
    expect(applyCustomEffect(fake, 10, 10, { kind: 'custom', intensity: 1, code: 'quebrado' }, 0)).toBe(false);
    expect(runCustomTransition({ kind: 'custom', duration: 0.5, code: 'x' }, {} as TexImageSource, {} as TexImageSource, 0.5, 10, 10)).toBeNull();
  });
});

describe("'custom' no catálogo e no motor", () => {
  it('painéis não quebram', () => {
    expect(effectEntry('custom')?.category).toBe('IA');
    expect(transitionEntry('custom')?.render).toBe('shader');
    expect(EFFECT_LABELS.custom).toBe('IA: personalizado');
    expect(TRANSITION_LABELS.custom).toBe('IA: personalizada');
    expect(effectDisplayName({ kind: 'custom', name: 'Ondas neon' })).toBe('IA: Ondas neon');
    expect(effectDisplayName({ kind: 'custom' })).toBe('IA: efeito personalizado');
    expect(effectDisplayName({ kind: 'inexistente' })).toBe('inexistente');
    expect(transitionDisplayName({ kind: 'custom', name: 'Espiral' })).toBe('IA: Espiral');
  });
  it('é shader (cai no dissolver sem WebGL) e efeito de superfície', () => {
    expect(isShaderTransition('custom')).toBe(true);
    expect(transitionVisual('custom', 0.5, 'in').opacity).toBeCloseTo(0.5);
    expect(hasSurfaceEffects([{ kind: 'custom', intensity: 1, code: 'x' }])).toBe(true);
  });
});
