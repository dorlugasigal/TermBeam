import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LoginPage from '@/components/common/LoginPage';

function getPath() {
  return window.location.pathname;
}

export default function App() {
  const { authenticated, login, loading } = useAuth();
  const [path, setPath] = useState(getPath);

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
    return <LoginPage onLogin={login} loading={loading} />;
  }

  // Authenticated — route by pathname
  if (path === '/terminal') {
    return <div>Terminal App</div>;
  }

  return <div>Sessions Hub</div>;
}
