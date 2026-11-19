'use client';

import { useState } from 'react';
import { useTheme } from '@/components/shell/theme';

export default function Login() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [dark] = useTheme();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) window.location.href = '/';
      else setErr('Senha inválida.');
    } catch {
      setErr('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`ep-root${dark ? ' dark' : ''}${dark === null ? ' theme-pending' : ''}`}>
      <div className="ep-login">
        <form className="ep-login-card" onSubmit={submit}>
          <div className="ep-logo">
            <div className="mark"><span /><i /></div>
            <b>EditorPro</b>
          </div>
          <h2>Editor de vídeo com IA</h2>
          <p className="sub">Acesso restrito</p>
          <label htmlFor="pw">Senha</label>
          <input
            id="pw"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          <div className="ep-login-err">{err}</div>
        </form>
      </div>
    </div>
  );
}
