import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/screens.css';

const root = document.getElementById('root');
if (root) {
  if (typeof window.maqiri === 'undefined') {
    // Electron 外(通常のブラウザ)で開かれた場合: 静止 UI 見本であることを明示し、動作を偽らない
    createRoot(root).render(
      <StrictMode>
        <div className="container" style={{ paddingTop: 48 }}>
          <p className="callout warning">Windows アプリの画面見本です。この表示では動画の読み込み・解析・書き出しはできません。</p>
          <App />
        </div>
      </StrictMode>
    );
  } else {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
}
