import React from 'react';
import ReactDOM from 'react-dom/client';
import { startUpdates } from './updates';
import App from './App';
import './style.css';
void startUpdates();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
