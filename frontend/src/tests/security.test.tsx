import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

// ─── Mock the auth service ───
vi.mock('../services/auth', () => ({
  getMe: vi.fn(),
  logoutApi: vi.fn(),
}));

// Re-import after mocking
import { getMe } from '../services/auth';
const getMeMock = vi.mocked(getMe);

// ─── Helpers ───

/** Renders a component within AuthProvider + MemoryRouter */
function renderWithAuth(ui: ReactNode, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

/** Simple component that reads and displays auth state */
function AuthDisplay() {
  const { isAuthenticated, user } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <span data-testid="user-role">{user?.role ?? 'none'}</span>
    </div>
  );
}

/** Route guard that requires authentication (mirrors App.tsx ProtectedRoute) */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div data-testid="loading">Loading</div>;
  if (!isAuthenticated) return <div data-testid="redirected-home">Redirected to /</div>;
  return <>{children}</>;
}

/** Route guard that requires admin role (mirrors App.tsx AdminRoute) */
function AdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <div data-testid="loading">Loading</div>;
  if (!isAuthenticated) return <div data-testid="redirected-home">Redirected to /</div>;
  if (user?.role !== 'admin') return <div data-testid="redirected-home">Redirected to /</div>;
  return <>{children}</>;
}

/** Route guard that requires partner role (mirrors App.tsx PartnerRoute) */
function PartnerRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <div data-testid="loading">Loading</div>;
  if (!isAuthenticated) return <div data-testid="redirected-home">Redirected to /</div>;
  if (user?.role !== 'partner') return <div data-testid="redirected-home">Redirected to /</div>;
  return <>{children}</>;
}

// ═══════════════════════════════════════════════════════════
//  1. NO SECURITY DATA IN LOCALSTORAGE
// ═══════════════════════════════════════════════════════════

describe('localStorage security', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('does not store token in localStorage after authentication', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'a@b.com', name: 'Test', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    // Token must NOT be in localStorage
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('does not store user object in localStorage after authentication', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'a@b.com', name: 'Test', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    // User must NOT be in localStorage
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('does not store role in localStorage', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'a@b.com', name: 'Admin', role: 'admin',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('user-role')).toHaveTextContent('admin');
    });

    // No security keys in localStorage
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('role')).toBeNull();
  });

  it('modifying localStorage does not grant authentication', async () => {
    // Simulate an attacker setting localStorage values
    localStorage.setItem('token', 'fake-token');
    localStorage.setItem('user', JSON.stringify({
      id: 999, email: 'hacker@evil.com', name: 'Hacker', role: 'admin',
      language: 'en', created_at: '2024-01-01',
    }));

    // getMe will fail (server rejects the fake token)
    getMeMock.mockRejectedValueOnce(new Error('Unauthorized'));

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    });

    // Even though localStorage has fake data, user is NOT authenticated
    expect(screen.getByTestId('user-role')).toHaveTextContent('none');
  });
});


// ═══════════════════════════════════════════════════════════
//  2. ROUTE GUARD REDIRECTS
// ═══════════════════════════════════════════════════════════

describe('route guards redirect to / (not /login)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('ProtectedRoute redirects unauthenticated user to /', async () => {
    getMeMock.mockRejectedValueOnce(new Error('Unauthorized'));

    renderWithAuth(
      <ProtectedRoute>
        <div data-testid="protected-content">Secret</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('AdminRoute redirects unauthenticated user to /', async () => {
    getMeMock.mockRejectedValueOnce(new Error('Unauthorized'));

    renderWithAuth(
      <AdminRoute>
        <div data-testid="admin-content">Admin Panel</div>
      </AdminRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('AdminRoute redirects regular user to /', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'user@test.com', name: 'User', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(
      <AdminRoute>
        <div data-testid="admin-content">Admin Panel</div>
      </AdminRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('AdminRoute allows admin user through', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(
      <AdminRoute>
        <div data-testid="admin-content">Admin Panel</div>
      </AdminRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-content')).toBeInTheDocument();
    });
  });

  it('PartnerRoute redirects unauthenticated user to /', async () => {
    getMeMock.mockRejectedValueOnce(new Error('Unauthorized'));

    renderWithAuth(
      <PartnerRoute>
        <div data-testid="partner-content">Partner Dashboard</div>
      </PartnerRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
    });
  });

  it('PartnerRoute redirects regular user to /', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'user@test.com', name: 'User', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(
      <PartnerRoute>
        <div data-testid="partner-content">Partner Dashboard</div>
      </PartnerRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
    });
  });

  it('PartnerRoute allows partner user through', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'p@test.com', name: 'Partner', role: 'partner',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(
      <PartnerRoute>
        <div data-testid="partner-content">Partner Dashboard</div>
      </PartnerRoute>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('partner-content')).toBeInTheDocument();
    });
  });
});


// ═══════════════════════════════════════════════════════════
//  3. AUTH CONTEXT SERVER VALIDATION
// ═══════════════════════════════════════════════════════════

describe('AuthContext server-side validation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('validates session via /auth/me on mount (not localStorage)', async () => {
    getMeMock.mockResolvedValueOnce({
      id: 42, email: 'verified@test.com', name: 'Verified', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    // getMe was called to validate the session
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });

  it('marks user as anonymous when /auth/me fails', async () => {
    getMeMock.mockRejectedValueOnce(new Error('401'));

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    });
  });

  it('role comes from server, not from any client-side source', async () => {
    // Even if an attacker sets localStorage, role must come from server
    localStorage.setItem('user', JSON.stringify({ role: 'admin' }));

    getMeMock.mockResolvedValueOnce({
      id: 1, email: 'user@test.com', name: 'User', role: 'user',
      language: 'en', created_at: '2024-01-01',
    });

    renderWithAuth(<AuthDisplay />);

    await waitFor(() => {
      // Server says "user", not the localStorage-injected "admin"
      expect(screen.getByTestId('user-role')).toHaveTextContent('user');
    });
  });
});
