'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { openHappySeedsLogin } from './auth-popup';

export interface CurrentUser {
  openid: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isPremium: boolean;
  premiumLifetime: boolean;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const csrfTokenRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      const payload = await res.json();
      if (payload?.success && payload.data) {
        setUser(payload.data);
        // Also fetch csrf token for logout from /api/auth/me
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (meRes.ok) {
          const me = await meRes.json();
          csrfTokenRef.current = me?.csrf_token ?? null;
        }
      } else {
        setUser(null);
        csrfTokenRef.current = null;
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    openHappySeedsLogin(() => refresh());
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfTokenRef.current ?? '',
        },
      });
    } catch { /* local logout always proceeds */ }
    setUser(null);
    csrfTokenRef.current = null;
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
