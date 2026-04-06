"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { isAdmin, loginAdmin, logoutAdmin } from "@/lib/auth";

interface AdminContextValue {
  admin: boolean;
  login: (pw: string) => boolean;
  logout: () => void;
}

const AdminContext = createContext<AdminContextValue>({
  admin: false,
  login: () => false,
  logout: () => {},
});

export function AdminProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState(false);

  useEffect(() => { setAdmin(isAdmin()); }, []);

  function login(pw: string): boolean {
    const ok = loginAdmin(pw);
    if (ok) setAdmin(true);
    return ok;
  }

  function logout() { logoutAdmin(); setAdmin(false); }

  return (
    <AdminContext.Provider value={{ admin, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() { return useContext(AdminContext); }