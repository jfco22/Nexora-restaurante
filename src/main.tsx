import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// App instalable y que abre sin internet. Solo en producción: en desarrollo el service worker estorba.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin service worker la app funciona igual, solo no abre sin internet */ });
    // Pide al navegador que no borre las ventas guardadas si falta espacio.
    void navigator.storage?.persist?.().catch(() => undefined);
  });
}
