import { create } from 'zustand';

// Login gate — presentational ONLY, never a security control (real access control is the
// repo / Pages ACL). `yad docs` sets DOCS_REQUIRE_LOGIN to `false` by default for public docs;
// teams publishing to a private Pages site can flip it to `true` (login_gate: true) and set
// credentials via the Vite env vars VITE_DOCS_USER / VITE_DOCS_PASS at build time.
const DOCS_REQUIRE_LOGIN = false;
const CREDENTIALS = {
  username: import.meta.env.VITE_DOCS_USER ?? 'docs',
  password: import.meta.env.VITE_DOCS_PASS ?? 'docs',
};

interface AuthStore {
  isAuthenticated: boolean;
  username: string | null;
  error: string | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthenticated: !DOCS_REQUIRE_LOGIN || sessionStorage.getItem('auth') === 'true',
  username: sessionStorage.getItem('auth_user'),
  error: null,

  login: (username, password) => {
    if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
      sessionStorage.setItem('auth', 'true');
      sessionStorage.setItem('auth_user', username);
      set({ isAuthenticated: true, username, error: null });
      return true;
    }
    set({ error: 'Invalid username or password' });
    return false;
  },

  logout: () => {
    sessionStorage.removeItem('auth');
    sessionStorage.removeItem('auth_user');
    set({ isAuthenticated: false, username: null, error: null });
  },
}));
