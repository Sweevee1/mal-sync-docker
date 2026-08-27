import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import SyncHistory from "./pages/SyncHistory";
import Onboarding from "./pages/Onboarding";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">MAL-Sync Docker</div>
        <nav className="app-nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/settings">Connect Services</NavLink>
        </nav>
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
