'use client';
/* código GLSL de um efeito/transição criado pela IA: só leitura, com o resultado da compilação */
import { useEffect, useState } from 'react';

export function ShaderCode({ code, stage }: { code: string; stage: 'effect' | 'transition' }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string; line?: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    import('@/lib/fx/customShader').then((m) => { if (alive) setCheck(m.checkShader(code, stage)); }).catch(() => {});
    return () => { alive = false; };
  }, [open, code, stage]);
  return (
    <div className="ep-shadercode">
      <button type="button" className="ep-btn sec ep-wide" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Esconder código' : 'Ver código'}
      </button>
      {open && (
        <>
          {check && (
            <p className={`ep-pnote${check.ok ? '' : ' err'}`}>
              {check.ok ? 'Compila sem erros.' : `Erro${check.line ? ` na linha ${check.line}` : ''}: ${check.error} — o vídeo segue sem este efeito.`}
            </p>
          )}
          <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 12, lineHeight: 1.45, padding: 10, borderRadius: 12, background: 'var(--bg-2, rgba(0,0,0,.06))', whiteSpace: 'pre', userSelect: 'text' }}>{code || '(sem código)'}</pre>
        </>
      )}
    </div>
  );
}
