"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateRoster, DAYS } from "@/lib/rosterAlgorithm";
import { validateOverride } from "@/lib/rosterValidation";
import { Staff, RosterMap, ShiftValue, DayKey, RosterEntry, Roster, DEPT_LABELS, Department } from "@/types";
import { useAdmin } from "@/context/AdminContext";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

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

function getMonday(date = new Date()): string {
  const d = new Date(date);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function getWeeksList(): { value: string; label: string }[] {
  const weeks = [];
  const today = new Date();
  for (let i = -8; i <= 4; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    const monday = getMonday(d);
    const label = i === 0 ? `This week (${monday})` : 
                  i === 1 ? `Next week (${monday})` :
                  i === -1 ? `Last week (${monday})` :
                  `Week of ${monday}`;
    weeks.push({ value: monday, label });
  }
  return weeks.reverse();
}

export default function RosterPage() {
  const { admin } = useAdmin();
  const searchParams = useSearchParams();
  const router = useRouter();
  const weeksList = getWeeksList();

  const [staff, setStaff] = useState<Staff[]>([]);
  const [roster, setRoster] = useState<RosterMap | null>(null);
  const [savedRoster, setSavedRoster] = useState<Roster | null>(null);
  const [savedEntries, setSavedEntries] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string>(getMonday());
  const [isLoadingWeek, setIsLoadingWeek] = useState(true);

  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => { if (staff.length > 0) fetchRosterForWeek(weekStart); }, [staff, weekStart]);

    // Load most recent published roster (any week) or specific week from URL
  useEffect(() => {
    async function loadRoster() {
      const urlWeek = searchParams.get("week");
      
      if (urlWeek) {
        // Load specific week from URL
        await fetchRosterForWeek(urlWeek);
        return;
      }
      
      // Otherwise, load most recent published roster (current or future)
      const { data: latestRoster } = await supabase
        .from("rosters")
        .select("*")
        .eq("is_published", true)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (latestRoster) {
        setWeekStart(latestRoster.week_start);
        setSavedRoster(latestRoster);
        
        const { data: entries } = await supabase
          .from("roster_entries")
          .select("*")
          .eq("roster_id", latestRoster.id);
        
        setSavedEntries(entries as RosterEntry[]);
        
        const map: RosterMap = {};
        for (const e of entries as RosterEntry[]) {
          if (!map[e.staff_id]) map[e.staff_id] = {} as Record<DayKey, ShiftValue>;
          map[e.staff_id][e.day] = e.shift;
        }
        setRoster(map);
        
        // Update URL to match
        router.push(`?week=${latestRoster.week_start}`, { scroll: false });
      }
    }
    
    loadRoster();
  }, []);

  async function fetchStaff() {
    const { data, error } = await supabase.from("staff").select("*").eq("active", true);
    if (error) { setError(error.message); return; }
    setStaff(data as Staff[]);
  }

  const fetchRosterForWeek = useCallback(async (week: string) => {
    const { data: rosterRow } = await supabase
      .from("rosters")
      .select("*")
      .eq("week_start", week)
      .maybeSingle();
      
    if (!rosterRow) {
      setSavedRoster(null);
      setSavedEntries([]);
      setRoster(null);
      return;
    }

    const { data: entries } = await supabase
      .from("roster_entries")
      .select("*")
      .eq("roster_id", rosterRow.id);
      
    setSavedRoster(rosterRow as Roster);
    setSavedEntries(entries as RosterEntry[]);

    const map: RosterMap = {};
    for (const e of entries as RosterEntry[]) {
      if (!map[e.staff_id]) map[e.staff_id] = {} as Record<DayKey, ShiftValue>;
      map[e.staff_id][e.day] = e.shift;
    }
    setRoster(map);
  }, []);

  function handleGenerate() {
    if (savedRoster) {
      const ok = confirm("A saved roster exists for this week. Generate new one?");
      if (!ok) return;
    }
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
          .then(() => fetchRosterForWeek(weekStart));
      }
    }
  }

    async function handleSave() {
    if (!roster) return;
    setSaving(true); setError(null);

       // Delete ALL existing rosters for this week (published and unpublished)
    await supabase.from("rosters").delete().eq("week_start", weekStart);

    const { data: rosterRow, error: rErr } = await supabase
      .from("rosters")
      .insert({ week_start: weekStart, is_published: true })
      .select()
      .single();
      
    if (rErr) { setError(rErr.message); setSaving(false); return; }

    const entries = Object.entries(roster).flatMap(([staffId, days]) =>
      DAYS.map(day => ({
        roster_id: rosterRow.id, staff_id: staffId,
        day, shift: days[day as DayKey], is_manual_override: false,
      }))
    );

    const { error: eErr } = await supabase.from("roster_entries").insert(entries);
    if (eErr) { setError(eErr.message); setSaving(false); return; }

    // Fast state update - no re-fetch needed
    setSavedRoster(rosterRow);
    setSavedEntries(entries as RosterEntry[]);
    setSaving(false);
  }

  async function handleExport(format: "png" | "pdf" = "png") {
    const element = document.getElementById("roster-export");
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
      });

      if (format === "png") {
        const link = document.createElement("a");
        link.download = `roster-${weekStart}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF("l", "mm", "a4"); // landscape
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
        const imgX = (pdfWidth - imgWidth * ratio) / 2;
        const imgY = 10;
        
        pdf.addImage(imgData, "PNG", imgX, imgY, imgWidth * ratio, imgHeight * ratio);
        pdf.save(`roster-${weekStart}.pdf`);
      }
    } catch (err) {
      setError("Export failed. Try again.");
    }
  }

  const ALL_DEPTS: Department[] = ["kitchen", "bar", "store", "snooker", "waitress"];
  const deptStaff = (d: Department) => staff.filter(s => s.department === d);

  const isFutureWeek = weekStart > getMonday();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Roster</h1>
          <p className="page-subtitle">
            {savedRoster ? `Saved: ${savedRoster.week_start}` : 
             roster ? `Generated (unsaved): ${weekStart}` : 
             `Week of ${weekStart}`}
          </p>
        </div>

        {admin && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Week</label>
              <select 
                value={weekStart} 
                onChange={e => {
                  const newWeek = e.target.value;
                  setWeekStart(newWeek);
                  router.push(`?week=${newWeek}`, { scroll: false });
                }}
                className="form-select" 
                style={{ width: "auto", minWidth: "200px" }}
              >
                {weeksList.map(w => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
            
            <button className="btn btn-primary" onClick={handleGenerate}
              disabled={loading || staff.length === 0}>
              {loading ? "Generating…" : (savedRoster ? "Regenerate" : "Generate")}
            </button>
            
                        {roster && !savedRoster && (
              <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save roster"}
              </button>
            )}
            {roster && (
              <>
                <button className="btn btn-secondary" onClick={() => handleExport("png")}>
                  Export PNG
                </button>
                <button className="btn btn-secondary" onClick={() => handleExport("pdf")}>
                  Export PDF
                </button>
              </>
            )}
          {savedRoster && (
            <button 
              className="btn btn-success" 
              onClick={async () => {
                await supabase.from("rosters").update({ is_published: true }).eq("id", savedRoster.id);
                setSavedRoster({ ...savedRoster, is_published: true });
              }}
              disabled={savedRoster.is_published}
              style={{ 
                background: savedRoster.is_published ? "var(--success)" : "var(--primary)",
                opacity: savedRoster.is_published ? 0.7 : 1 
              }}
            >
              {savedRoster.is_published ? "✓ Published" : "Publish"}
            </button>
          )}
          </div>
        )}
      </div>

      {isFutureWeek && !savedRoster && !roster && (
        <div className="alert alert-info" style={{ marginBottom: "1rem" }}>
          This is a future week. Generate a roster to get started.
        </div>
      )}

      <div className="stat-row">
        <div className="stat-pill">
          <span className="stat-pill-label">Total staff</span>
          <span className="stat-pill-value">{staff.length}</span>
        </div>
        {ALL_DEPTS.map(d => (
          <div key={d} className="stat-pill">
            <span className="stat-pill-label">{DEPT_LABELS[d]}</span>
            <span className="stat-pill-value">{deptStaff(d).length}</span>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {cellError && <div className="alert alert-warning">{cellError}</div>}

          {!roster && staff.length > 0 && !isLoadingWeek && (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "0.5rem", fontWeight: 600 }}>
            No roster for this week yet.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            {admin ? "Hit Generate to build the week." : "Check back once the manager publishes the roster."}
          </p>
        </div>
      )}

        {roster && staff.length > 0 && (
        <div id="roster-export" style={{ 
          display: "flex", 
          flexDirection: "column", 
          gap: "2.5rem",
          background: "white",
          padding: "20px",
        }}>
          {ALL_DEPTS.map(d => (
            <RosterSection key={d} title={DEPT_LABELS[d]} staffList={deptStaff(d)}
              roster={roster} admin={admin} onEdit={handleCellEdit} />
          ))}
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

  const counts: Record<DayKey, Record<ShiftValue, number>> = {} as never;
  for (const d of DAYS) {
    counts[d] = { "3pm": 0, "6pm": 0, "8pm": 0, "off": 0 };
    for (const s of staffList) {
      const shift = roster[s.id]?.[d];
      if (shift) counts[d][shift]++;
    }
  }

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
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--bg-muted)" }}>
              <td style={{ padding: "10px 20px", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                On shift
              </td>
              {DAYS.map(d => {
                const total = (["3pm","6pm","8pm"] as ShiftValue[]).reduce((sum, sh) => sum + counts[d][sh], 0);
                const parts = (["3pm","6pm","8pm"] as ShiftValue[])
                  .filter(sh => counts[d][sh] > 0)
                  .map(sh => `${counts[d][sh]}×${sh}`)
                  .join(" · ");
                return (
                  <td key={d} style={{ padding: "10px 8px", textAlign: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 800, color: "var(--text-primary)", display: "block", lineHeight: 1 }}>
                      {total}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 500, marginTop: "3px", display: "block", whiteSpace: "nowrap" }}>
                      {parts}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}