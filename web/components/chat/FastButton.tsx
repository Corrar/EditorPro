'use client';
import Icon from '@/components/ui/Icon';
import { useAIChat } from '@/lib/ai/chatStore';

/** "Mais rápido" enquanto a IA edita (o cursor anda a 900 ms por passo; rápido = 350 ms) */
export function FastButton({ className = '' }: { className?: string }) {
  const fast = useAIChat((s) => s.fast);
  const setFast = useAIChat((s) => s.setFast);
  return (
    <button className={`ep-ch-fast${fast ? ' on' : ''} ${className}`} onClick={() => setFast(!fast)} aria-pressed={fast} title={fast ? 'Voltar ao ritmo normal (dá para acompanhar o cursor)' : 'Acelerar a edição ao vivo'}>
      <Icon name={fast ? 'play' : 'speed'} size={13} /> {fast ? 'Ritmo normal' : 'Mais rápido'}
    </button>
  );
}
