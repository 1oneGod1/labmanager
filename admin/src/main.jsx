import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import './design-system.css';

function reportRendererError(error, source) {
  const details = {
    message: error?.message || String(error || 'Unknown renderer error'),
    stack: error?.stack || '',
    source,
  };
  console.error(`[RENDERER ERROR] ${source}`, error);
  window.electronAPI?.reportRendererError?.(details);
}

window.addEventListener('error', (event) => {
  reportRendererError(event.error || event.message, event.filename || 'window.error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError(event.reason, 'unhandledrejection');
});

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportRendererError(error, info?.componentStack || 'React error boundary');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08111f', color: '#e5edf8', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ width: 'min(680px, 100%)', border: '1px solid #334155', borderRadius: 16, background: '#111c2e', padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
          <p style={{ margin: '0 0 8px', color: '#f8c84f', fontWeight: 800, letterSpacing: '.08em', fontSize: 12 }}>LABKOM ADMIN</p>
          <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>Antarmuka gagal dimuat</h1>
          <p style={{ margin: '0 0 18px', color: '#aebdd0', lineHeight: 1.6 }}>Aplikasi sudah mencatat detail masalah ke file log. Tutup lalu buka kembali aplikasi. Jika masalah tetap terjadi, kirim file <code>main.log</code> dari folder log LabKom Admin.</p>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#fca5a5', background: '#07101d', borderRadius: 10, padding: 14, fontSize: 12 }}>{this.state.error?.message || 'Unknown renderer error'}</pre>
        </section>
      </main>
    );
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Elemen root aplikasi tidak ditemukan.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>
);

window.electronAPI?.reportRendererReady?.();
