"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateRoster, DAYS } from "@/lib/rosterAlgorithm";
import { validateOverride } from "@/lib/rosterValidation";
import { Staff, RosterMap, ShiftValue, DayKey, RosterEntry, Roster, DEPT_LABELS, Department } from "@/types";
import { useAdmin } from "@/context/AdminContext";

export const dynamic = "force-dynamic";

const SHIFT_CLASS: Record<ShiftValue, string> = {
  "3pm": "shift-3pm", "6pm": "shift-6pm", "8pm": "shift-8pm", "off": "shift-off",
};
const SHIFTS: ShiftValue[] = ["3pm", "6pm", "8pm", "off"];
const ALL_DEPTS: Department[] = ["kitchen", "bar", "store", "snooker", "waitress"];

function ShiftPicker({ value, onChange, suggested = false }: {
  value: ShiftValue; onChange: (v: ShiftValue) => void; suggested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className={`shift-pill ${SHIFT_CLASS[value]}${suggested ? " suggested" : ""}`}
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
  return (
    <span className={`shift-pill readonly ${SHIFT_CLASS[value]}`} style={{ cursor: "default" }}>
      {value}
    </span>
  );
}

function StickyDeptHeader({ title, working, onLeave }: {
  title: string; working: number; onLeave: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    el.parentElement?.insertBefore(sentinel, el);
    const observer = new IntersectionObserver(
      ([entry]) => el.classList.toggle("is-pinned", !entry.isIntersecting),
      { threshold: 1, rootMargin: "-56px 0px 0px 0px" }
    );
    observer.observe(sentinel);
    return () => { observer.disconnect(); sentinel.remove(); };
  }, []);
  return (
    <div ref={ref} className="dept-section-header">
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
        <h2>{title}</h2>
        <span className="dept-section-meta">
          {working} working{onLeave > 0 ? ` · ${onLeave} on leave` : ""}
        </span>
      </div>
    </div>
  );
}

function getMonday(date = new Date()): string {
  const d = new Date(date);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function getWeeksList() {
  const today = new Date();
  const thisWeek = getMonday(today);
  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeek = getMonday(lastWeekDate);
  const nextWeekDate = new Date(today);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeek = getMonday(nextWeekDate);
  return [
    { value: nextWeek,  label: `Next week (${nextWeek})` },
    { value: thisWeek,  label: `This week (${thisWeek})` },
    { value: lastWeek,  label: `Last week (${lastWeek})` },
  ];
}

export default function RosterPage() {
  const { admin } = useAdmin();
  const searchParams = useSearchParams();
  const router = useRouter();
  const weeksList = getWeeksList();

  const [staff, setStaff]               = useState<Staff[]>([]);
  const [roster, setRoster]             = useState<RosterMap | null>(null);
  const [savedRoster, setSavedRoster]   = useState<Roster | null>(null);
  const [savedEntries, setSavedEntries] = useState<RosterEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [cellError, setCellError]       = useState<string | null>(null);
  const [weekStart, setWeekStart]       = useState<string>(getMonday());
  const [isLoadingWeek, setIsLoadingWeek] = useState(true);

  // ── Initial load: staff + roster in parallel ──────────────────────────────
  useEffect(() => {
    async function init() {
      const urlWeek = searchParams.get("week");
      const targetWeek = urlWeek ?? getMonday();

      const [staffResult, rosterResult] = await Promise.all([
        supabase.from("staff").select("*").eq("active", true),
        urlWeek
          ? supabase.from("rosters").select("*").eq("week_start", urlWeek).maybeSingle()
          : supabase.from("rosters").select("*").eq("is_published", true)
              .order("week_start", { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (staffResult.error) { setError(staffResult.error.message); }
      else { setStaff(staffResult.data as Staff[]); }

      const rosterRow = rosterResult.data;
      if (!rosterRow) { setIsLoadingWeek(false); return; }

      const { data: entries } = await supabase
        .from("roster_entries").select("*").eq("roster_id", rosterRow.id);

      const week = rosterRow.week_start;
      setWeekStart(week);
      setSavedRoster(rosterRow as Roster);
      setSavedEntries((entries ?? []) as RosterEntry[]);

      const map: RosterMap = {};
      for (const e of (entries ?? []) as RosterEntry[]) {
        if (!map[e.staff_id]) map[e.staff_id] = {} as Record<DayKey, ShiftValue>;
        map[e.staff_id][e.day] = e.shift;
      }
      setRoster(map);
      if (!urlWeek) router.push(`?week=${week}`, { scroll: false });
      setIsLoadingWeek(false);
    }
    init();
  }, []);

  const fetchRosterForWeek = useCallback(async (week: string) => {
    setIsLoadingWeek(true);
    const { data: rosterRow } = await supabase
      .from("rosters").select("*").eq("week_start", week).maybeSingle();

    if (!rosterRow) {
      setSavedRoster(null); setSavedEntries([]); setRoster(null);
      setIsLoadingWeek(false); return;
    }

    const { data: entries } = await supabase
      .from("roster_entries").select("*").eq("roster_id", rosterRow.id);

    setSavedRoster(rosterRow as Roster);
    setSavedEntries((entries ?? []) as RosterEntry[]);

    const map: RosterMap = {};
    for (const e of (entries ?? []) as RosterEntry[]) {
      if (!map[e.staff_id]) map[e.staff_id] = {} as Record<DayKey, ShiftValue>;
      map[e.staff_id][e.day] = e.shift;
    }
    setRoster(map);
    setIsLoadingWeek(false);
  }, []);

  function handleGenerate() {
    if (savedRoster && !confirm("A saved roster exists for this week. Generate new one?")) return;
    setError(null); setCellError(null); setLoading(true);
    try {
      setRoster(generateRoster(staff.filter(s => !s.on_leave)));
      setSavedRoster(null); setSavedEntries([]);
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
          .update({ shift: value, is_manual_override: true }).eq("id", entry.id)
          .then(() => fetchRosterForWeek(weekStart));
      }
    }
  }

  async function handleSave() {
    if (!roster) return;
    setSaving(true); setError(null);

    // Delete all existing rosters (old weeks auto-purged on each save)
    await supabase.from("rosters").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { data: rosterRow, error: rErr } = await supabase
      .from("rosters").insert({ week_start: weekStart, is_published: true }).select().single();
    if (rErr) { setError(rErr.message); setSaving(false); return; }

    const entries = Object.entries(roster).flatMap(([staffId, days]) =>
      DAYS.map(day => ({ roster_id: rosterRow.id, staff_id: staffId, day, shift: days[day as DayKey], is_manual_override: false }))
    );
    const { error: eErr } = await supabase.from("roster_entries").insert(entries);
    if (eErr) { setError(eErr.message); setSaving(false); return; }

    setSavedRoster(rosterRow);
    setSavedEntries(entries as RosterEntry[]);
    setSaving(false);
  }

  // ── Export — lazy load heavy libraries ────────────────────────────────────
  async function handleExport(format: "png" | "pdf") {
    const el = document.getElementById("roster-export-desktop");
    if (!el) return;
    setExporting(true);

    try {
      // Lazy import — not loaded until first export click
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(el, {
        scale: 1.5,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        // Only capture the desktop element, ignore hidden mobile markup
        ignoreElements: el2 => el2.classList.contains("mobile-only"),
      });

      if (format === "png") {
        const link = document.createElement("a");
        link.download = `roster-${weekStart}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        // JPEG at 85% inside PDF — much smaller file than PNG
        const imgData = canvas.toDataURL("image/jpeg", 0.85);
        const pdf = new jsPDF("l", "mm", "a4");
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();

        // Add title header
        pdf.setFontSize(11);
        pdf.setTextColor(100);
        pdf.text(`Rosterly — Week of ${weekStart}`, 10, 8);

        const ratio = Math.min(pw / canvas.width, (ph - 14) / canvas.height);
        const imgX = (pw - canvas.width * ratio) / 2;
        pdf.addImage(imgData, "JPEG", imgX, 14, canvas.width * ratio, canvas.height * ratio);
        pdf.save(`roster-${weekStart}.pdf`);
      }
    } catch {
      setError("Export failed. Try again.");
    } finally { setExporting(false); }
  }

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
          <div className="admin-controls">
            <div className="admin-controls-row">
              <label className="form-label" style={{ whiteSpace: "nowrap", alignSelf: "center" }}>Week</label>
              <select value={weekStart}
                onChange={e => { const w = e.target.value; setWeekStart(w); router.push(`?week=${w}`, { scroll: false }); fetchRosterForWeek(w); }}
                className="form-select" style={{ minWidth: "200px" }}>
                {weeksList.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>
            <div className="admin-controls-row">
              <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || staff.length === 0}>
                {loading ? "Generating…" : savedRoster ? "Regenerate" : "Generate"}
              </button>
              {roster && !savedRoster && (
                <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save roster"}
                </button>
              )}
              {roster && (
                <>
                  <button className="btn btn-secondary" onClick={() => handleExport("png")} disabled={exporting}>
                    {exporting ? "…" : "PNG"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleExport("pdf")} disabled={exporting}>
                    {exporting ? "…" : "PDF"}
                  </button>
                </>
              )}
              {savedRoster && (
                <button className="btn btn-success"
                  onClick={async () => {
                    await supabase.from("rosters").update({ is_published: true }).eq("id", savedRoster.id);
                    setSavedRoster({ ...savedRoster, is_published: true });
                  }}
                  disabled={savedRoster.is_published}
                  style={{ opacity: savedRoster.is_published ? 0.7 : 1 }}>
                  {savedRoster.is_published ? "✓ Published" : "Publish"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {isFutureWeek && !savedRoster && !roster && (
        <div className="alert alert-info">This is a future week. Generate a roster to get started.</div>
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

      {error    && <div className="alert alert-error">{error}</div>}
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
        <>
          {/* Desktop export target — clean white, no mobile markup interference */}
          <div id="roster-export-desktop" style={{ background: "#ffffff" }}>
            {ALL_DEPTS.map(d => (
              <RosterSection key={d} title={DEPT_LABELS[d]} staffList={deptStaff(d)}
                roster={roster} admin={admin} onEdit={handleCellEdit} />
            ))}
          </div>
        </>
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

  const workingList = staffList.filter(s => !s.on_leave);

  const counts: Record<DayKey, Record<ShiftValue, number>> = {} as never;
  for (const d of DAYS) {
    counts[d] = { "3pm": 0, "6pm": 0, "8pm": 0, "off": 0 };
    for (const s of workingList) {
      const shift = roster[s.id]?.[d];
      if (shift) counts[d][shift]++;
    }
  }

  return (
    <div style={{ marginBottom: "2.5rem" }}>
      <StickyDeptHeader
        title={title}
        working={workingList.length}
        onLeave={staffList.length - workingList.length}
      />

      {/* Desktop table */}
      <div className="roster-table-wrap desktop-only">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Staff</th>
              {DAYS.map(d => <th key={d}>{d.slice(0, 3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {staffList.map(s => {
              if (s.on_leave) return (
                <tr key={s.id} style={{ opacity: 0.45, background: "var(--bg-muted)" }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span>{s.name}</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, background: "#ede9fe", color: "#6d28d9", padding: "1px 6px", borderRadius: "99px" }}>
                        on leave
                      </span>
                    </div>
                  </td>
                  {DAYS.map(d => <td key={d} style={{ color: "var(--text-muted)", fontWeight: 600 }}>—</td>)}
                </tr>
              );
              return (
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
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border-strong)", background: "var(--bg-muted)" }}>
              <td style={{ padding: "10px 20px", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                On shift
              </td>
              {DAYS.map(d => {
                const total = (["3pm","6pm","8pm"] as ShiftValue[]).reduce((sum, sh) => sum + counts[d][sh], 0);
                const parts = (["3pm","6pm","8pm"] as ShiftValue[]).filter(sh => counts[d][sh] > 0).map(sh => `${counts[d][sh]}×${sh}`).join(" · ");
                return (
                  <td key={d} style={{ padding: "10px 8px", textAlign: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 800, color: "var(--text-primary)", display: "block", lineHeight: 1 }}>{total}</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 500, marginTop: "3px", display: "block", whiteSpace: "nowrap" }}>{parts}</span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mobile-roster mobile-only">
        {staffList.map(s => {
          if (s.on_leave) return (
            <div key={s.id} className="roster-card" style={{ opacity: 0.5, background: "var(--bg-muted)" }}>
              <div className="roster-card-header">
                <span className="roster-card-name">{s.name}</span>
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#ede9fe", color: "#6d28d9", padding: "2px 8px", borderRadius: "99px" }}>On leave</span>
              </div>
              <div className="roster-card-shifts">
                {DAYS.map(d => (
                  <div key={d} className="roster-shift-cell">
                    <span className="roster-shift-day">{d.slice(0, 2)}</span>
                    <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 700 }}>—</span>
                  </div>
                ))}
              </div>
            </div>
          );
          return (
            <div key={s.id} className="roster-card">
              <div className="roster-card-header">
                <span className="roster-card-name">{s.name}</span>
              </div>
              <div className="roster-card-shifts">
                {DAYS.map(d => {
                  const shift = roster[s.id]?.[d];
                  if (!shift) return <div key={d} className="roster-shift-cell" />;
                  return (
                    <div key={d} className="roster-shift-cell">
                      <span className="roster-shift-day">{d.slice(0, 2)}</span>
                      {admin
                        ? <ShiftPicker value={shift} onChange={v => onEdit(s.id, d, v)} />
                        : <ShiftBadge value={shift} />
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Mobile coverage summary */}
        <div style={{ background: "var(--bg-muted)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px", marginTop: "8px" }}>
          <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Daily Coverage</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", textAlign: "center" }}>
            {DAYS.map(d => {
              const total = (["3pm","6pm","8pm"] as ShiftValue[]).reduce((sum, sh) => sum + counts[d][sh], 0);
              const parts = (["3pm","6pm","8pm"] as ShiftValue[]).filter(sh => counts[d][sh] > 0).map(sh => `${counts[d][sh]}×${sh}`).join("\n");
              return (
                <div key={d} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>{d.slice(0, 2)}</span>
                  <span style={{ fontSize: "15px", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{total}</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", whiteSpace: "pre", lineHeight: 1.4 }}>{parts}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}