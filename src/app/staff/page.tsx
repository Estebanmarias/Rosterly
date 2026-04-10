"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Staff, Department, DEPT_LABELS } from "@/types";
import { useAdmin } from "@/context/AdminContext";

const ALL_DEPTS: Department[] = ["kitchen", "bar", "store", "snooker", "waitress"];
const EMPTY_FORM = { name: "", department: "waitress" as Department };

export default function StaffPage() {
  const { admin }               = useAdmin();
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [editId, setEditId]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [leaveStaff, setLeaveStaff] = useState<Staff | null>(null);
  const [leaveForm, setLeaveForm]   = useState({ start: "", end: "" });

  useEffect(() => { fetchStaff(); }, []);

  async function fetchStaff() {
    const { data, error } = await supabase
      .from("staff").select("*").eq("active", true).order("department").order("name");
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
        .insert({ name: form.name.trim(), department: form.department, active: true, on_leave: false });
      if (error) { setError(error.message); setLoading(false); return; }
    }
    setForm(EMPTY_FORM); setEditId(null); setLoading(false); fetchStaff();
  }

  async function handleToggleActive(s: Staff) {
    await supabase.from("staff").update({ active: !s.active }).eq("id", s.id);
    fetchStaff();
  }

  async function handleSetLeave() {
    if (!leaveStaff) return;
    if (!leaveForm.start || !leaveForm.end) { return; }
    await supabase.from("staff").update({
      on_leave: true,
      leave_start: leaveForm.start,
      leave_end: leaveForm.end,
    }).eq("id", leaveStaff.id);
    setLeaveStaff(null);
    setLeaveForm({ start: "", end: "" });
    fetchStaff();
  }

  async function handleReturnFromLeave(s: Staff) {
    await supabase.from("staff").update({
      on_leave: false, leave_start: null, leave_end: null,
    }).eq("id", s.id);
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

  const active  = staff.filter(s => s.active && !s.on_leave).length;
  const onLeave = staff.filter(s => s.on_leave).length;

  return (
    <div className="page-sm">
      {/* Leave duration modal */}
      {leaveStaff && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
        }}>
          <div className="card" style={{ width: 360, padding: "2rem" }}>
            <p className="card-title">Set leave for {leaveStaff.name}</p>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
              This staff member will be excluded from roster generation during this period.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
              <div className="form-group">
                <label className="form-label">Leave start</label>
                <input type="date" className="form-input"
                  value={leaveForm.start}
                  onChange={e => setLeaveForm(f => ({ ...f, start: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Leave end</label>
                <input type="date" className="form-input"
                  value={leaveForm.end}
                  min={leaveForm.start}
                  onChange={e => setLeaveForm(f => ({ ...f, end: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button className="btn btn-primary"
                onClick={handleSetLeave}
                disabled={!leaveForm.start || !leaveForm.end}>
                Confirm leave
              </button>
              <button className="btn btn-secondary"
                onClick={() => { setLeaveStaff(null); setLeaveForm({ start: "", end: "" }); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">
            {active} active
            {onLeave > 0 && ` · ${onLeave} on leave`}
            {" · "}
            {ALL_DEPTS.map(d =>
              `${staff.filter(s => s.department === d).length} ${DEPT_LABELS[d]?.toLowerCase() || d}`
            ).join(" · ")}
          </p>
        </div>
      </div>

      {admin && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <p className="card-title">{editId ? "Edit staff member" : "Add staff member"}</p>
          <div className="input-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Name</label>
              <input type="text" value={form.name} placeholder="Full name"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="form-input" />
            </div>
            <div className="form-group">
              <label className="form-label">Department</label>
              <select value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value as Department }))}
                className="form-select">
                {ALL_DEPTS.map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", paddingBottom: "1px" }}>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                {loading ? "Saving…" : editId ? "Update" : "Add staff"}
              </button>
              {editId && <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>}
            </div>
          </div>
          {error && <p style={{ marginTop: "10px", fontSize: "13px", color: "#dc2626" }}>{error}</p>}
        </div>
      )}

      {ALL_DEPTS.map((dept, i) => {
        const list = staff.filter(s => s.department === dept);
        return (
          <div key={dept}>
            <StaffSection
              title={DEPT_LABELS[dept]} dept={dept} list={list} admin={admin}
              onEdit={handleEdit}
              onToggle={handleToggleActive}
              onLeave={s => { setLeaveStaff(s); setLeaveForm({ start: "", end: "" }); }}
              onReturn={handleReturnFromLeave}
              onDelete={handleDelete}
            />
            {i < ALL_DEPTS.length - 1 && <hr className="divider" />}
          </div>
        );
      })}
    </div>
  );
}

function StaffSection({ title, dept, list, admin, onEdit, onToggle, onLeave, onReturn, onDelete }: {
  title: string; dept: Department; list: Staff[]; admin: boolean;
  onEdit: (s: Staff) => void;
  onToggle: (s: Staff) => void;
  onLeave: (s: Staff) => void;
  onReturn: (s: Staff) => void;
  onDelete: (id: string) => void;
}) {
  const avatarColors: Record<Department, { bg: string; color: string }> = {
    kitchen:  { bg: "#fef3c7", color: "#b45309" },
    bar:      { bg: "#dbeafe", color: "#1d4ed8" },
    store:    { bg: "#bfdbfe", color: "#1e40af" },
    snooker:  { bg: "#dcfce7", color: "#166534" },
    waitress: { bg: "#ede9fe", color: "#6d28d9" },
  };
  const { bg, color } = avatarColors[dept];

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 800, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>
          {list.length} staff
        </span>
      </div>
      {list.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
          No {(title ?? dept).toLowerCase()} added yet.
        </p>
      ) : (
        <div style={{
          border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)",
          overflow: "hidden", boxShadow: "var(--shadow-sm)",
        }}>
          {list.map(s => (
            <div key={s.id} className="staff-row" style={{ opacity: s.on_leave ? 0.7 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: s.on_leave ? "#f3f4f6" : bg,
                  color: s.on_leave ? "#9ca3af" : color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "13px", flexShrink: 0,
                }}>
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <p style={{
                      margin: 0, fontWeight: 700, fontSize: "14px",
                      color: s.on_leave ? "var(--text-muted)" : s.active ? "var(--text-primary)" : "var(--text-muted)",
                      textDecoration: s.active ? "none" : "line-through",
                    }}>
                      {s.name}
                    </p>
                    {s.on_leave && (
                      <span style={{
                        fontSize: "11px", fontWeight: 700,
                        background: "#ede9fe", color: "#6d28d9",
                        padding: "2px 8px", borderRadius: "99px",
                      }}>
                        On leave
                      </span>
                    )}
                  </div>
                  {s.on_leave && s.leave_start && s.leave_end && (
                    <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                      {s.leave_start} → {s.leave_end}
                    </p>
                  )}
                  {!s.active && (
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>Inactive</p>
                  )}
                </div>
              </div>
              <div className="staff-row-actions">
                {admin && (
                  <>
                    <button className="btn btn-ghost" onClick={() => onEdit(s)}>Edit</button>
                    {s.on_leave ? (
                      <button className="btn btn-accent"
                        style={{ fontSize: "13px", padding: "6px 10px" }}
                        onClick={() => onReturn(s)}>
                        ↩ Return
                      </button>
                    ) : (
                      <button className="btn btn-ghost" onClick={() => onLeave(s)}>
                        On leave
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => onToggle(s)}>
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn btn-danger-ghost" onClick={() => onDelete(s.id)}>
                      Delete
                    </button>
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