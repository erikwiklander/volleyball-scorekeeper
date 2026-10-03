import React from 'react';
import ReactDOM from 'react-dom/client';
import { startUpdates } from './updates';
import Root from './Root';
import './style.css';
void startUpdates();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
