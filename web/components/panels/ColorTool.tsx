'use client';
/* ferramenta "Cor": monta o <ColorPanel/> da sessão COR (components/color) quando ele existir.
   Sem o módulo, a ferramenta não aparece no rail/menu/barra (useColorAvailable). */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import Icon from '@/components/ui/Icon';
import { EmptyHint } from './controls';
import { useSelectedClip } from './hooks';
import { loadColor } from './optional';

type PanelProps = { clip?: unknown; clipId?: string };
export const useColorModule = create<{ Panel: ComponentType<PanelProps> | null }>(() => ({ Panel: null }));
export const useColorAvailable = () => useColorModule((s) => !!s.Panel);

let started = false;
export function initColor(): void {
  if (started) return;
  started = true;
  void loadColor().then((m) => {
    const P = (m?.ColorPanel ?? m?.default) as ComponentType<PanelProps> | undefined;
    if (P && (typeof P === 'function' || typeof P === 'object')) useColorModule.setState({ Panel: P });
  });
}

export default function ColorTool() {
  const Panel = useColorModule((s) => s.Panel);
  const clip = useSelectedClip()?.clip;
  if (!Panel) return <EmptyHint icon={<Icon name="filters" />} title="Correção de cor" text="O painel de cor ainda está chegando." />;
  return <div className="ep-colortool"><Panel clip={clip} clipId={clip?.id} /></div>;
}
