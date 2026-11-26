import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, UNAUTHORIZED_EVENT } from "./api/client";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import SyncHistory from "./pages/SyncHistory";
import Onboarding from "./pages/Onboarding";
import Login from "./pages/Login";

type AuthState = "checking" | "authed" | "anon" | "unreachable";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [notice, setNotice] = useState<string | null>(null);
  const authRef = useRef<AuthState>("checking");
  authRef.current = auth;
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>("a.active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, [pathname, auth]);

  const checkSession = useCallback(async () => {
    setAuth("checking");
    try {
      setAuth((await api.getSession()) ? "authed" : "anon");
    } catch {
      setAuth("unreachable");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    function onUnauthorized() {
      if (authRef.current !== "authed") return;
      setNotice("Your session expired. Sign in again.");
      setAuth("anon");
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // The cookie may already be gone; either way this browser is done with the session.
    }
    setNotice(null);
    setAuth("anon");
  }

  if (auth === "checking") {
    return (
      <div className="boot" role="status">
        <span className="spinner" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (auth === "unreachable") {
    return (
      <div className="boot">
        <div className="boot-message" role="alert">
          <p>Could not reach the server. Check that it is running.</p>
          <button type="button" onClick={checkSession}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (auth === "anon") {
    return (
      <Login
        notice={notice}
        onSuccess={() => {
          setNotice(null);
          setAuth("authed");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">MAL-Sync Docker</div>
        <nav className="app-nav" aria-label="Main" ref={navRef}>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/settings">Connect Services</NavLink>
        </nav>
        <button type="button" className="secondary quiet sign-out" onClick={handleSignOut}>
          Sign out
        </button>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/history" element={<SyncHistory />} />
          <Route path="/settings" element={<Onboarding />} />
        </Routes>
      </main>
    </div>
  );
}
