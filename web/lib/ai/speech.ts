'use client';
/* =====================================================================
   Ditado por voz (Web Speech API, pt-BR). Grátis, no navegador.
   Chrome/Android/Edge: webkitSpeechRecognition; Safari iOS 14.5+ também.
   Sem suporte -> supported=false (o botão do microfone some).
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;

export function speechCtor(w: unknown = typeof window !== 'undefined' ? window : undefined): SRCtor | undefined {
  const g = w as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor } | undefined;
  return g?.SpeechRecognition ?? g?.webkitSpeechRecognition;
}

/** junta o texto já digitado com o ditado (espaço único entre eles) */
export function joinDictation(base: string, spoken: string): string {
  const s = spoken.trim();
  if (!s) return base;
  const b = base.replace(/\s+$/, '');
  return b ? `${b} ${s}` : s.charAt(0).toUpperCase() + s.slice(1);
}

export function useDictation(onText: (text: string, final: boolean) => void, lang = 'pt-BR') {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<SR | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => { setSupported(!!speechCtor()); return () => rec.current?.abort(); }, []);

  const stop = useCallback(() => { rec.current?.stop(); }, []);

  const start = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let finalText = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
      }
      cb.current(finalText || interim, !!finalText && !interim);
    };
    r.onerror = () => {};
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try { r.start(); setListening(true); } catch { rec.current = null; setListening(false); }
  }, [lang]);

  return { supported, listening, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
