'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ACCESS_TOKEN_KEY, getCurrentUser, login as loginRequest, registerCustomer } from '@/lib/api/client';
import type { AppRole, AuthUser } from '@/types/auth';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (fullName: string, email: string, phone: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refresh: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const token = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await getCurrentUser(token));
    } catch {
      window.localStorage.removeItem(ACCESS_TOKEN_KEY);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginRequest(email, password);
    window.localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const signup = useCallback(async (fullName: string, email: string, phone: string, password: string) => {
    const session = await registerCustomer(fullName, email, phone, password);
    window.localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    login,
    signup,
    logout,
    refresh,
    hasRole: (...roles) => Boolean(user?.roles.some((role) => roles.includes(role))),
  }), [isLoading, login, logout, refresh, signup, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
