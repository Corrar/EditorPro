'use client';
/* pedidos de UI entre painéis e o shell (mesmo dono): abrir o chat com contexto */
import { create } from 'zustand';
import { useEditor } from '@/lib/store';
import type { ChatContext } from '@/lib/types';

export const useShellUi = create<{ chatRequest: number }>(() => ({ chatRequest: 0 }));

/** "apontar para qualquer coisa": define o contexto do chat e abre o chat (sheet no celular) */
export function askAI(ctx: ChatContext): void {
  useEditor.getState().setChatContext(ctx);
  useShellUi.setState((s) => ({ chatRequest: s.chatRequest + 1 }));
}
