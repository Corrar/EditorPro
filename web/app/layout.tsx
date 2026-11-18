import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../styles/shell.css';
import '../styles/timeline.css';
import '../styles/preview.css';
import '../styles/chat.css';
import '../styles/panels.css';
import '../styles/media.css';

export const metadata: Metadata = {
  title: 'EditorPro — Editor de vídeo com IA',
  description: 'Descreva o vídeo, envie um exemplo e a IA edita ao vivo.',
};

export const viewport: Viewport = { themeColor: '#D9641E', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Poppins:wght@400;500;600;700;800;900&family=Anton&family=Montserrat:wght@700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
