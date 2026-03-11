import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error handling for debugging white screen
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Global Error:", message, "at", source, ":", lineno, ":", colno, error);
  const root = document.getElementById('root');
  if (root && root.innerHTML === "") {
    root.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; color: #ef4444; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; margin: 20px;">
        <h1 style="font-size: 18px; font-weight: bold; margin-bottom: 8px;">Critical Startup Error</h1>
        <p style="font-size: 14px; color: #7f1d1d; margin-bottom: 16px;">${message}</p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; background: #18181b; color: white; border: none; border-radius: 6px; cursor: pointer;">Reload Page</button>
      </div>
    `;
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
