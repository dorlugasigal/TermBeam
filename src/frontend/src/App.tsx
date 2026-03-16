import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LoginPage from '@/components/LoginPage/LoginPage';
import SessionsHub from '@/components/SessionsHub/SessionsHub';
import { TerminalApp } from '@/components/TerminalApp/TerminalApp';

function getPath() {
  return window.location.pathname;
}

/** Normalize ?id= to ?session= so TerminalApp can read it */
function normalizeSessionParam() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam && !params.get('session')) {
    params.set('session', idParam);
    params.delete('id');
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }
}

export default function App() {
  const { authenticated, passwordRequired, login, loading } = useAuth();
  const [path, setPath] = useState(getPath);

  useEffect(() => {
    normalizeSessionParam();
  }, [path]);

  useEffect(() => {
    const onPopState = () => setPath(getPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Still checking auth
  if (authenticated === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg)',
          color: 'var(--text)',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  if (!authenticated) {
    // No-password mode: server is unreachable — show reconnecting UI instead of login
    if (!passwordRequired) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '16px',
            background: 'var(--bg)',
            color: 'var(--text)',
          }}
        >
          <div className="spinner" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Reconnecting to server…
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px',
              padding: '8px 20px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <LoginPage onLogin={login} loading={loading} />;
  }

  // Authenticated — route by pathname
  if (path === '/terminal') {
    return <TerminalApp />;
  }

  return <SessionsHub />;
}
