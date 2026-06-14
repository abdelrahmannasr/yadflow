import { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, error } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(username, password);
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-10 shadow-2xl"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-default)',
        }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src="/logo.svg" alt="Logo" className="h-14" />
        </div>

        {/* Title */}
        <h1 className="text-center text-xl font-bold text-white mb-1">
          Booking Flow Documentation
        </h1>
        <p className="text-center text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
          Sign in to access the documentation
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="w-full px-4 py-3 rounded-lg text-sm text-white placeholder-slate-500 border outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{
                background: 'var(--color-surface-highlight)',
                borderColor: 'var(--color-border-default)',
              }}
              autoFocus
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-4 py-3 rounded-lg text-sm text-white placeholder-slate-500 border outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{
                background: 'var(--color-surface-highlight)',
                borderColor: 'var(--color-border-default)',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all hover:opacity-90 cursor-pointer"
            style={{
              background: 'var(--color-primary)',
              boxShadow: '0 4px 20px rgba(97, 22, 218, 0.4)',
            }}
          >
            Sign In
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--color-text-muted)' }}>
          Booking flow documentation portal
        </p>
      </div>
    </div>
  );
}
