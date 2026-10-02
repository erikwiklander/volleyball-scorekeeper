import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './style.css';
registerSW({
  onOfflineReady() {
    window.dispatchEvent(new Event('offline-ready'));
  },
  onRegisterError(error) {
    console.error('Offline setup failed', error);
    window.dispatchEvent(new Event('offline-failed'));
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
