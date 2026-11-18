'use client';
import { useEffect } from 'react';
import { registerPWA } from '@/lib/pwa';

export default function PwaRegister() {
  useEffect(() => { registerPWA(); }, []);
  return null;
}
