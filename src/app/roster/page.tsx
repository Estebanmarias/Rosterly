"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { generateRoster, DAYS } from "@/lib/rosterAlgorithm";
import { validateOverride } from "@/lib/rosterValidation";
import { Staff, RosterMap, ShiftValue, DayKey, RosterEntry, Roster } from "@/types";
import { useAdmin } from "@/context/AdminContext";

const SHIFT_CLASS: Record<ShiftValue, string> = {
  "3pm": "shift-3pm", "6pm": "shift-6pm", "8pm": "shift-8pm", "off": "shift-off",
};

const SHIFTS: ShiftValue[] = ["3pm", "6pm", "8pm", "off"];

function ShiftPicker({ value, onChange }: { value: ShiftValue; onChange: (v: ShiftValue) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className={`shift-pill ${SHIFT_CLASS[value]}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
      >
        {value}
      </button>
      {open && (
        <div className="dropdown-menu" onClick={e => e.stopPropagation()}>
          {SHIFTS.map(s => (
            <button key={s}
              className={`dropdown-item ${SHIFT_CLASS[s]}${s === value ? " active" : ""}`}
              onClick={() => { onChange(s); setOpen(false); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftBadge({ value }: { value: ShiftValue }) {
  return <span className={`shift-pill ${SHIFT_CLASS[value]}`} style={{ cursor: "default" }}>{value}</span>;
}

export default function RosterPage() {
  const { admin } = useAdmin();
  const [staff, setStaff]               = useState<Staff[]>([]);
  const [roster, setRoster]             = useState<RosterMap | null>(null);
  const [savedRoster, setSavedRoster]   = useState<Roster | null>(null);
  const [savedEntries, setSavedEntries] = useState<RosterEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [cellError, setCellError]       = useState<string | null>(null);
  const [weekStart, setWeekStart]       = useState<string>(getMonday());

  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => { if (staff.length > 0) fetchLastRoster(); }, [staff]);

  async function fetchStaff() {
    const { data, error } = await supabase.from("staff").select("*").eq("active", true);
    if (error) { setError(error.message); return; }
    setStaff(data as Staff[]);
  }

  const fetchLastRoster = useCallback(async () => {
    const { data: rosterRow } = await supabase
      .from("rosters").select("*")
      .order("generated_at", { ascending: false }).limit(1).single();
    if (!rosterRow) return;

    const { data: entries } = await supabase
      .from("roster_entries").select("*").eq("roster_id", rosterRow.id);
    if (!entries) return;

    setSavedRoster(rosterRow as Roster);
    setSavedEntries(entries as RosterEntry[]);
    setWeekStart(rosterRow.week_start);

    const map: RosterMap = {};
    for (const e of entries as RosterEntry[]) {
      if (!map[e.staff_id]) map[e.staff_id] = {} as Record<DayKey, ShiftValue>;
      map[e.staff_id][e.day] = e.shift;
    }
    setRoster(map);
  }, []);

  function getMonday(): string {
    const d = new Date();
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  }

  function handleGenerate() {
    setError(null); setCellError(null); setLoading(true);
    try {
      setRoster(generateRoster(staff));
      setSavedRoster(null);
      setSavedEntries([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally { setLoading(false); }
  }

  function handleCellEdit(staffId: string, day: DayKey, value: ShiftValue) {
    if (!roster) return;
    setCellError(null);

    const fakeEntry: RosterEntry = {
      id: "temp", roster_id: savedRoster?.id ?? "temp",
      staff_id: staffId, day, shift: roster[staffId][day], is_manual_override: true,
    };

    const allEntries: RosterEntry[] = savedEntries.length > 0
      ? savedEntries
      : Object.entries(roster).flatMap(([sid, days]) =>
          DAYS.map(d => ({ id: `${sid}-${d}`, roster_id: "temp", staff_id: sid, day: d, shift: days[d], is_manual_override: false }))
        );

    const result = validateOverride(fakeEntry, value, allEntries, staff);
    if (!result.valid) { setCellError(result.reason ?? "Invalid shift."); return; }

    setRoster(prev => ({ ...prev!, [staffId]: { ...prev![staffId], [day]: value } }));

    if (savedRoster) {
      const entry = savedEntries.find(e => e.staff_id === staffId && e.day === day);
      if (entry) {
        supabase.from("roster_entries")
          .update({ shift: value, is_manual_override: true })
          .eq("id", entry.id)
          .then(() => fetchLastRoster());
      }
    }
  }

  async function handleSave() {
    if (!roster) return;
    setSaving(true); setError(null);

    const { data: rosterRow, error: rErr } = await supabase
      .from("rosters").insert({ week_start: weekStart, is_published: false }).select().single();
    if (rErr) { setError(rErr.message); setSaving(false); return; }

    const entries = Object.entries(roster).flatMap(([staffId, days]) =>
      DAYS.map(day => ({
        roster_id: rosterRow.id, staff_id: staffId,
        day, shift: days[day as DayKey], is_manual_override: false,
      }))
    );

    const { error: eErr } = await supabase.from("roster_entries").insert(entries);
    if (eErr) { setError(eErr.message); setSaving(false); return; }

    setSavedRoster(rosterRow);
    setSaving(false);
    fetchLastRoster();
  }

  const kitchen  = staff.filter(s => s.department === "kitchen");
  const waitress = staff.filter(s => s.department === "waitress");

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Roster</h1>
          <p className="page-subtitle">
            {savedRoster
              ? `Week of ${savedRoster.week_start}`
              : "No roster saved yet"}
          </p>
        </div>

        {admin && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Week of</label>
              <input type="date" value={weekStart}
                onChange={e => setWeekStart(e.target.value)}
                className="form-input" style={{ width: "auto" }} />
            </div>
            <button className="btn btn-primary" onClick={handleGenerate}
              disabled={loading || staff.length === 0}>
              {loading ? "Generating…" : "Generate roster"}
            </button>
            {roster && !savedRoster && (
              <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save roster"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="stat-row">
        <div className="stat-pill">
          <span className="stat-pill-label">Total staff</span>
          <span className="stat-pill-value">{staff.length}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">Kitchen</span>
          <span className="stat-pill-value">{kitchen.length}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">Waitresses</span>
          <span className="stat-pill-value">{waitress.length}</span>
        </div>
      </div>

      {error     && <div className="alert alert-error">{error}</div>}
      {cellError && <div className="alert alert-warning">{cellError}</div>}

      {!roster && staff.length > 0 && (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "0.5rem", fontWeight: 600 }}>
            No roster for this week yet.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            {admin ? "Hit Generate roster to build the week." : "Check back once the manager publishes the roster."}
          </p>
        </div>
      )}

      {roster && staff.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          <RosterSection title="Kitchen"    staffList={kitchen}
            roster={roster} admin={admin} onEdit={handleCellEdit} />
          <RosterSection title="Waitresses" staffList={waitress}
            roster={roster} admin={admin} onEdit={handleCellEdit} />
        </div>
      )}
    </div>
  );
}

function RosterSection({ title, staffList, roster, admin, onEdit }: {
  title: string; staffList: Staff[]; roster: RosterMap;
  admin: boolean;
  onEdit: (staffId: string, day: DayKey, value: ShiftValue) => void;
}) {
  if (!staffList.length) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 800, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>{staffList.length} staff</span>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Staff</th>
              {DAYS.map(d => <th key={d}>{d.slice(0, 3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {staffList.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                {DAYS.map(d => {
                  const shift = roster[s.id]?.[d];
                  if (!shift) return <td key={d} />;
                  return (
                    <td key={d}>
                      {admin
                        ? <ShiftPicker value={shift} onChange={v => onEdit(s.id, d, v)} />
                        : <ShiftBadge value={shift} />
                      }
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}