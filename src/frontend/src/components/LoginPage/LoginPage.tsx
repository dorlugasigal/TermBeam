import { useState, type FormEvent } from 'react';
import styles from './LoginPage.module.css';

interface LoginPageProps {
  onLogin: (password: string) => Promise<boolean>;
  loading: boolean;
}

export default function LoginPage({ onLogin, loading }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!password.trim()) return;

    try {
      const success = await onLogin(password);
      if (!success) setError('Incorrect password');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('429') || message.toLowerCase().includes('too many')) {
        setError('Too many attempts. Please wait and try again.');
      } else {
        setError('Login failed. Please try again.');
      }
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>📡</span>
          TermBeam
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
          <button className={styles.button} type="submit" disabled={loading || !password.trim()}>
            {loading ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
