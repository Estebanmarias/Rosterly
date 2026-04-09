"use client";

import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminProvider, useAdmin } from "@/context/AdminContext";
import { useState } from "react";

const geist = Geist({ subsets: ["latin"] });

const NAV = [
  { href: "/roster", label: "Roster" },
  { href: "/staff",  label: "Staff"  },
  { href: "/swaps",  label: "Swaps"  },
];

function AdminModal({ onClose }: { onClose: () => void }) {
  const { admin, login, logout } = useAdmin();
  const [pw, setPw]         = useState("");
  const [err, setErr]       = useState(false);

  function handleLogin() {
    const ok = login(pw);
    if (ok) { onClose(); setErr(false); }
    else setErr(true);
  }

  if (admin) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}>
        <div className="card" style={{ width: 360, padding: "2rem" }}>
          <p className="card-title">Admin session active</p>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
            You have full access to generate rosters, edit shifts, and manage staff.
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-danger-ghost" style={{ border: "1.5px solid #fecaca" }}
              onClick={() => { logout(); onClose(); }}>
              Sign out
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div className="card" style={{ width: 360, padding: "2rem" }}>
        <p className="card-title">Admin login</p>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
          Enter the admin password to unlock roster management.
        </p>
        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label className="form-label">Password</label>
          <input
            type="password" className="form-input" value={pw} autoFocus
            placeholder="Enter password"
            onChange={e => { setPw(e.target.value); setErr(false); }}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
          {err && <p style={{ fontSize: "13px", color: "#dc2626", marginTop: "4px" }}>Incorrect password.</p>}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn-primary" onClick={handleLogin}>Login</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Topbar() {
  const path = usePathname();
  const { admin } = useAdmin();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <header className="topbar">
        <Link href="/roster" className="topbar-logo">Rosterly</Link>
        <nav className="topbar-nav">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`nav-link${path.startsWith(n.href) ? " active" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: admin ? "rgba(255,255,255,0.15)" : "transparent",
            border: "1.5px solid rgba(255,255,255,0.2)",
            borderRadius: "var(--radius-sm)",
            color: admin ? "#ffffff" : "#9ca3af",
            padding: "5px 10px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          {admin ? "🔓 Admin" : "🔒 Admin"}
        </button>
      </header>
      {showModal && <AdminModal onClose={() => setShowModal(false)} />}
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <AdminProvider>
          <Topbar />
          {children}
        </AdminProvider>
      </body>
    </html>
  );
}