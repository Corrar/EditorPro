'use client';
/* =====================================================================
   Seletores de arquivo do celular.
   - Galeria: accept SÓ "image/*,video/*" (sem áudio, sem extensões, sem capture):
     o Chrome do Android abre o Photo Picker do sistema direto, sem o
     "Escolha uma ação" (Câmera/Arquivos…). No iPhone abre a Fototeca.
   - Câmera: capture="environment" abre a câmera direto.
   - Áudio: input próprio "audio/*" (abre Arquivos).
   ===================================================================== */
import { useRef } from 'react';

export const GALLERY_ACCEPT = 'image/*,video/*';
export const AUDIO_ACCEPT = 'audio/*';

export type PickKind = 'gallery' | 'camera' | 'audio';

export function useFilePickers(onFiles: (files: File[], kind: PickKind) => void) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const take = (kind: PickKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (f.length) onFiles(f, kind);
  };
  const inputs = (
    <>
      <input ref={gallery} type="file" hidden multiple accept={GALLERY_ACCEPT} data-ep-pick="gallery" onChange={take('gallery')} />
      <input ref={camera} type="file" hidden accept={GALLERY_ACCEPT} capture="environment" data-ep-pick="camera" onChange={take('camera')} />
      <input ref={audio} type="file" hidden multiple accept={AUDIO_ACCEPT} data-ep-pick="audio" onChange={take('audio')} />
    </>
  );
  return {
    inputs,
    openGallery: () => gallery.current?.click(),
    openCamera: () => camera.current?.click(),
    openAudio: () => audio.current?.click(),
  };
}
