'use client';
import { flushAutosave } from '@/lib/persist';

/** sai da conta (cookie de sessão) e volta para /login */
export async function logout(): Promise<void> {
  flushAutosave();
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  window.location.href = '/login';
}
