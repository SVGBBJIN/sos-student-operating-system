import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { sb } from './lib/supabase.js';
import App from './App.jsx';

// Lazy-loaded pages (loaded after auth check)
const Landing     = React.lazy(() => import('./pages/Landing.jsx'));
const Library     = React.lazy(() => import('./pages/Library.jsx'));
const CalendarPage = React.lazy(() => import('./pages/CalendarPage.jsx'));

/**
 * AppRouter — thin router wrapper.
 * Handles auth state and redirects between public (Landing) and
 * protected (/studio, /calendar, /library) routes.
 */
export default function AppRouter() {
  // undefined = loading, null = unauthenticated, object = authenticated user
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Suppress flash while auth state resolves
  if (user === undefined) {
    return (
      <div style={{
        height: '100vh',
        background: 'var(--background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }} />
    );
  }

  return (
    <React.Suspense fallback={
      <div style={{
        height: '100vh',
        background: 'var(--background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }} />
    }>
      <Routes>
        {/* Public */}
        <Route
          path="/"
          element={user ? <Navigate to="/studio" replace /> : <Landing />}
        />

        {/* Protected — studio (existing App.jsx experience) */}
        <Route
          path="/studio/*"
          element={user ? <App /> : <Navigate to="/" replace />}
        />

        {/* Protected — calendar */}
        <Route
          path="/calendar"
          element={user ? <CalendarPage /> : <Navigate to="/" replace />}
        />

        {/* Protected — library */}
        <Route
          path="/library"
          element={user ? <Library /> : <Navigate to="/" replace />}
        />

        {/* Redirects for old paths */}
        <Route path="/notes"     element={<Navigate to="/library" replace />} />
        <Route path="/skill-hub" element={<Navigate to="/library" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  );
}
