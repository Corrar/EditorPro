'use client';
/* =====================================================================
   Módulos opcionais de outras sessões (FX: lib/fx · COR: components/color).
   Import dinâmico com "contexto" restrito do webpack: se o arquivo ainda não
   existir, o bundle compila igual e a promessa rejeita em tempo de execução
   → caímos nas listas atuais. Quando a sessão publicar, entra sozinho.
   ===================================================================== */
type Mod = Record<string, unknown>;

function libModule(dir: string): Promise<Mod> {
  return import(/* webpackInclude: /[\\/]lib[\\/]fx[\\/]index\.tsx?$/ */ /* webpackMode: "lazy" */ `@/lib/${dir + '/index'}`);
}
// o contexto parte de uma pasta que JÁ existe (components/); o filtro escolhe só color/index|ColorPanel
function colorModule(file: string): Promise<Mod> {
  return import(/* webpackInclude: /[\\/]components[\\/]color[\\/](index|ColorPanel)\.tsx?$/ */ /* webpackMode: "lazy" */ `@/components/${'color/' + file}`);
}

let fx: Promise<Mod | null> | null = null;
export function loadFx(): Promise<Mod | null> {
  fx ??= libModule('fx').catch(() => null);
  return fx;
}

let color: Promise<Mod | null> | null = null;
export function loadColor(): Promise<Mod | null> {
  color ??= colorModule('index').catch(() => colorModule('ColorPanel')).catch(() => null);
  return color;
}
