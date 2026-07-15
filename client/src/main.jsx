import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './index.css';
import './session-design.css';

function reportRendererError(error, source, fatal = false) {
  const normalized = error instanceof Error ? error : new Error(String(error || 'Unknown renderer error'));
  window.electronAPI?.reportRendererError?.({
    message: normalized.message,
    stack: normalized.stack,
    source,
    fatal,
  });
}

window.addEventListener('error', (event) => {
  reportRendererError(event.error || event.message, 'window.error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError(event.reason, 'window.unhandledrejection');
});

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    reportRendererError(error, 'react.error-boundary', true);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32, background: '#f8fafc', color: '#0f172a', fontFamily: 'sans-serif' }}>
          <section style={{ maxWidth: 560, textAlign: 'center' }}>
            <h1 style={{ marginBottom: 12 }}>LabKom Siswa gagal dimuat</h1>
            <p>Aplikasi akan ditutup dengan aman. Silakan jalankan kembali atau hubungi pengelola lab.</p>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  const error = new Error('Elemen root renderer tidak ditemukan.');
  reportRendererError(error, 'renderer.bootstrap', true);
  throw error;
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>
);
