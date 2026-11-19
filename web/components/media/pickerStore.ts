'use client';
import { create } from 'zustand';

/** seletor "Adicionar mídia" em tela cheia (estilo CapCut) */
export const useMediaPicker = create<{ open: boolean; tab: 'video' | 'image' | 'audio' }>(() => ({ open: false, tab: 'video' }));
export const openMediaPicker = (tab: 'video' | 'image' | 'audio' = 'video') => useMediaPicker.setState({ open: true, tab });
export const closeMediaPicker = () => useMediaPicker.setState({ open: false });
