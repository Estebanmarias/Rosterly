"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Staff, Department } from "@/types";

import { useAdmin } from "@/context/AdminContext";

const EMPTY_FORM = { name: "", department: "waitress" as Department };

export default function StaffPage() {
  const { admin } = useAdmin();
  const [staff, setStaff]     = useState<Staff[]>([]);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [editId, setEditId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => { fetchStaff(); }, []);

  async function fetchStaff() {
    const { data, error } = await supabase
      .from("staff").select("*").order("department").order("name");
    if (error) { setError(error.message); return; }
    setStaff(data as Staff[]);
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setLoading(true); setError(null);

    if (editId) {
      const { error } = await supabase.from("staff")
        .update({ name: form.name.trim(), department: form.department }).eq("id", editId);
      if (error) { setError(error.message); setLoading(false); return; }
    } else {
      const { error } = await supabase.from("staff")
        .insert({ name: form.name.trim(), department: form.department, active: true });
      if (error) { setError(error.message); setLoading(false); return; }
    }

    setForm(EMPTY_FORM); setEditId(null); setLoading(false); fetchStaff();
  }

  async function handleToggleActive(s: Staff) {
    await supabase.from("staff").update({ active: !s.active }).eq("id", s.id);
    fetchStaff();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this staff member? This cannot be undone.")) return;
    await supabase.from("staff").delete().eq("id", id);
    fetchStaff();
  }

  function handleEdit(s: Staff) {
    setEditId(s.id);
    setForm({ name: s.name, department: s.department });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancel() { setEditId(null); setForm(EMPTY_FORM); setError(null); }

  const kitchen  = staff.filter(s => s.department === "kitchen");
  const waitress = staff.filter(s => s.department === "waitress");
  const active   = staff.filter(s => s.active).length;

  return (
    <div className="page-sm">
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">{active} active · {kitchen.length} kitchen · {waitress.length} waitresses</p>
        </div>
      </div>

      {/* Form — admin only */}
      {admin && (
      <div className="card" style={{ marginBottom: "2rem" }}>
        <p className="card-title">{editId ? "Edit staff member" : "Add staff member"}</p>
        <div className="input-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Name</label>
            <input
              type="text" value={form.name} placeholder="Full name"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Department</label>
            <select
              value={form.department}
              onChange={e => setForm(f => ({ ...f, department: e.target.value as Department }))}
              className="form-select"
            >
              <option value="waitress">Waitress</option>
              <option value="kitchen">Kitchen</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: "8px", paddingBottom: "1px" }}>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving…" : editId ? "Update" : "Add staff"}
            </button>
            {editId && (
              <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            )}
          </div>
        </div>
        {error && <p style={{ marginTop: "10px", fontSize: "13px", color: "#dc2626" }}>{error}</p>}
      </div>
      )}

      {/* Kitchen */}
      <StaffSection
        title="Kitchen" dept="kitchen" list={kitchen}
        onEdit={handleEdit} onToggle={handleToggleActive} onDelete={handleDelete}
      />

      <hr className="divider" />

      {/* Waitresses */}
      <StaffSection
        title="Waitresses" dept="waitress" list={waitress}
        onEdit={handleEdit} onToggle={handleToggleActive} onDelete={handleDelete}
      />
    </div>
  );
}

function StaffSection({ title, list, admin, onEdit, onToggle, onDelete }: {
  title: string; dept: Department; list: Staff[]; admin: boolean;
  onEdit: (s: Staff) => void;
  onToggle: (s: Staff) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 800, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>{list.length} staff</span>
      </div>
      {list.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No {title.toLowerCase()} added yet.</p>
      ) : (
        <div style={{ border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          {list.map(s => (
            <div key={s.id} className="staff-row">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: s.department === "kitchen" ? "#fef3c7" : "#ede9fe",
                  color: s.department === "kitchen" ? "#b45309" : "#6d28d9",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "13px", flexShrink: 0,
                }}>
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p style={{
                    margin: 0, fontWeight: 700, fontSize: "14px",
                    color: s.active ? "var(--text-primary)" : "var(--text-muted)",
                    textDecoration: s.active ? "none" : "line-through",
                  }}>
                    {s.name}
                  </p>
                  {!s.active && <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>Inactive</p>}
                </div>
              </div>
              <div className="staff-row-actions">
                  {admin && (
                    <>
                      <button className="btn btn-ghost" onClick={() => onEdit(s)}>Edit</button>
                      <button className="btn btn-ghost" onClick={() => onToggle(s)}>
                        {s.active ? "Deactivate" : "Activate"}
                      </button>
                      <button className="btn btn-danger-ghost" onClick={() => onDelete(s.id)}>Delete</button>
                    </>
                  )}
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}