"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Staff, RosterEntry, SwapRequest, Roster, DayKey, ShiftValue } from "@/types";
import { validateSwap } from "@/lib/rosterValidation";
import { useAdmin } from "@/context/AdminContext";

const SHIFT_CLASS: Record<ShiftValue, string> = {
  "3pm": "shift-3pm", "6pm": "shift-6pm", "8pm": "shift-8pm", "off": "shift-off",
};

type SwapWithNames = SwapRequest & {
  requester_name: string;
  target_name: string;
  requester_day: DayKey;
  target_day: DayKey;
  requester_shift: ShiftValue;
  target_shift: ShiftValue;
};

export default function SwapsPage() {
  const { admin } = useAdmin();

  const [staff, setStaff]       = useState<Staff[]>([]);
  const [rosters, setRosters]   = useState<Roster[]>([]);
  const [entries, setEntries]   = useState<RosterEntry[]>([]);
  const [swaps, setSwaps]       = useState<SwapWithNames[]>([]);
  const [selectedRoster, setSelectedRoster] = useState<string>("");

  // Form
  const [requesterId, setRequesterId]   = useState("");
  const [targetId, setTargetId]         = useState("");
  const [requesterDay, setRequesterDay] = useState<DayKey>("monday");
  const [targetDay, setTargetDay]       = useState<DayKey>("monday");
  const [formError, setFormError]       = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [submitted, setSubmitted]       = useState(false);

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { if (selectedRoster) fetchEntries(selectedRoster); }, [selectedRoster]);

  async function fetchAll() {
    const [{ data: s }, { data: r }, { data: sw }] = await Promise.all([
      supabase.from("staff").select("*").eq("active", true).order("name"),
      supabase.from("rosters").select("*").order("week_start", { ascending: false }),
      supabase.from("swap_requests").select("*").order("created_at", { ascending: false }),
    ]);

    const staffList = (s ?? []) as Staff[];
    const rosterList = (r ?? []) as Roster[];
    const rawSwaps = (sw ?? []) as SwapRequest[];

    setStaff(staffList);
    setRosters(rosterList);
    if (rosterList.length > 0 && !selectedRoster) setSelectedRoster(rosterList[0].id);

    // We'll enrich swaps with names/days after entries load
    // Store raw for now, enrich in enrichSwaps()
    enrichSwaps(rawSwaps, staffList, entries);
  }

  async function fetchEntries(rosterId: string) {
    const { data } = await supabase
      .from("roster_entries").select("*").eq("roster_id", rosterId);
    const e = (data ?? []) as RosterEntry[];
    setEntries(e);

    // Re-enrich swaps with new entries
    const { data: sw } = await supabase
      .from("swap_requests").select("*").order("created_at", { ascending: false });
    enrichSwaps((sw ?? []) as SwapRequest[], staff, e);
  }

  function enrichSwaps(raw: SwapRequest[], staffList: Staff[], entryList: RosterEntry[]) {
    const enriched: SwapWithNames[] = raw.map(sw => {
      const rEntry = entryList.find(e => e.id === sw.requester_entry_id);
      const tEntry = entryList.find(e => e.id === sw.target_entry_id);
      return {
        ...sw,
        requester_name: staffList.find(s => s.id === sw.requester_id)?.name ?? "Unknown",
        target_name:    staffList.find(s => s.id === sw.target_id)?.name ?? "Unknown",
        requester_day:  (rEntry?.day ?? "monday") as DayKey,
        target_day:     (tEntry?.day ?? "monday") as DayKey,
        requester_shift: (rEntry?.shift ?? "3pm") as ShiftValue,
        target_shift:    (tEntry?.shift ?? "3pm") as ShiftValue,
      };
    });
    setSwaps(enriched);
  }

  function getEntry(staffId: string, day: DayKey) {
    return entries.find(e => e.staff_id === staffId && e.day === day);
  }

  async function handleSubmit() {
    setFormError(null); setSubmitted(false);
    if (!requesterId || !targetId || !selectedRoster) {
      setFormError("Select both staff members and make sure a roster is loaded."); return;
    }
    if (requesterId === targetId) {
      setFormError("You cannot swap with yourself."); return;
    }

    const rEntry = getEntry(requesterId, requesterDay);
    const tEntry = getEntry(targetId, targetDay);
    if (!rEntry || !tEntry) {
      setFormError("Could not find roster entries for the selected days."); return;
    }

    const result = validateSwap(rEntry, tEntry, entries, staff);
    if (!result.valid) { setFormError(result.reason ?? "Invalid swap."); return; }

    // Check no pending swap already exists for same entries
    const duplicate = swaps.find(
      sw => sw.status === "pending" &&
        ((sw.requester_entry_id === rEntry.id && sw.target_entry_id === tEntry.id) ||
         (sw.requester_entry_id === tEntry.id && sw.target_entry_id === rEntry.id))
    );
    if (duplicate) {
      setFormError("A pending swap request already exists for these shifts."); return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("swap_requests").insert({
      requester_id: requesterId, target_id: targetId,
      requester_entry_id: rEntry.id, target_entry_id: tEntry.id, status: "pending",
    });
    if (error) { setFormError(error.message); setSubmitting(false); return; }

    setSubmitting(false);
    setSubmitted(true);
    setRequesterId(""); setTargetId("");
    fetchAll();
    if (selectedRoster) fetchEntries(selectedRoster);
  }

  async function handleApprove(swap: SwapWithNames) {
    const rEntry = entries.find(e => e.id === swap.requester_entry_id);
    const tEntry = entries.find(e => e.id === swap.target_entry_id);
    if (!rEntry || !tEntry) return;

    await Promise.all([
      supabase.from("roster_entries").update({ shift: tEntry.shift, is_manual_override: true }).eq("id", rEntry.id),
      supabase.from("roster_entries").update({ shift: rEntry.shift, is_manual_override: true }).eq("id", tEntry.id),
      supabase.from("swap_requests").update({ status: "approved" }).eq("id", swap.id),
    ]);
    fetchAll();
    if (selectedRoster) fetchEntries(selectedRoster);
  }

  async function handleReject(swapId: string) {
    await supabase.from("swap_requests").update({ status: "rejected" }).eq("id", swapId);
    fetchAll();
  }

  const pending  = swaps.filter(s => s.status === "pending");
  const history  = swaps.filter(s => s.status !== "pending");
  const requesterEntries = entries.filter(e => e.staff_id === requesterId);
  const targetEntries    = entries.filter(e => e.staff_id === targetId);

  return (
    <div className="page-sm">
      <div className="page-header">
        <div>
          <h1 className="page-title">Swap Requests</h1>
          <p className="page-subtitle">
            {pending.length > 0
              ? `${pending.length} pending request${pending.length > 1 ? "s" : ""} awaiting approval`
              : "No pending requests"}
          </p>
        </div>
      </div>

      {/* Roster selector */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <p className="card-title">Select roster week</p>
        <div className="form-group" style={{ maxWidth: 280 }}>
          <label className="form-label">Roster week</label>
          <select value={selectedRoster} onChange={e => setSelectedRoster(e.target.value)} className="form-select">
            {rosters.length === 0 && <option value="">No rosters saved yet</option>}
            {rosters.map(r => (
              <option key={r.id} value={r.id}>Week of {r.week_start}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Submit swap form */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <p className="card-title">Request a swap</p>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
          Select yourself and the person you want to swap with, then pick the days to trade.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div className="form-group">
            <label className="form-label">Your name</label>
            <select value={requesterId} onChange={e => { setRequesterId(e.target.value); setFormError(null); }} className="form-select">
              <option value="">Select your name</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Your day to trade</label>
            <select value={requesterDay} onChange={e => setRequesterDay(e.target.value as DayKey)} className="form-select"
              disabled={!requesterId}>
              {requesterEntries.length === 0
                ? <option>— select your name first —</option>
                : requesterEntries.map(e => (
                    <option key={e.day} value={e.day}>
                      {e.day.charAt(0).toUpperCase() + e.day.slice(1)} — {e.shift}
                    </option>
                  ))
              }
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Swap with</label>
            <select value={targetId} onChange={e => { setTargetId(e.target.value); setFormError(null); }} className="form-select">
              <option value="">Select staff member</option>
              {staff.filter(s => s.id !== requesterId).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Their day to trade</label>
            <select value={targetDay} onChange={e => setTargetDay(e.target.value as DayKey)} className="form-select"
              disabled={!targetId}>
              {targetEntries.length === 0
                ? <option>— select a staff member first —</option>
                : targetEntries.map(e => (
                    <option key={e.day} value={e.day}>
                      {e.day.charAt(0).toUpperCase() + e.day.slice(1)} — {e.shift}
                    </option>
                  ))
              }
            </select>
          </div>
        </div>

        {formError && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{formError}</div>}
        {submitted && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>Swap request submitted — waiting for admin approval.</div>}

        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || rosters.length === 0}>
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </div>

      {/* Admin: pending approvals */}
      {admin && pending.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 1rem" }}>
            Pending approvals
            <span style={{
              marginLeft: "10px", fontSize: "13px", fontWeight: 700,
              background: "#fef3c7", color: "#92400e",
              padding: "2px 10px", borderRadius: "99px",
            }}>{pending.length}</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pending.map(sw => (
              <SwapCard key={sw.id} swap={sw} admin={admin}
                onApprove={() => handleApprove(sw)}
                onReject={() => handleReject(sw.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Staff: pending view (read-only) */}
      {!admin && pending.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 1rem" }}>Pending</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pending.map(sw => <SwapCard key={sw.id} swap={sw} admin={false} />)}
          </div>
        </div>
      )}

      {/* History / log */}
      {history.length > 0 && (
        <div>
          <h2 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 1rem" }}>Log</h2>
          <div style={{
            border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)",
            overflow: "hidden", boxShadow: "var(--shadow-sm)",
          }}>
            {history.map((sw, i) => (
              <div key={sw.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "1rem", padding: "13px 20px",
                borderBottom: i < history.length - 1 ? "1px solid var(--border)" : "none",
                background: "var(--bg)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>{sw.requester_name}</span>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{sw.requester_day}</span>
                  <span className={`shift-pill ${SHIFT_CLASS[sw.requester_shift]}`} style={{ cursor: "default" }}>
                    {sw.requester_shift}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>↔</span>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>{sw.target_name}</span>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{sw.target_day}</span>
                  <span className={`shift-pill ${SHIFT_CLASS[sw.target_shift]}`} style={{ cursor: "default" }}>
                    {sw.target_shift}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {new Date(sw.created_at).toLocaleDateString()}
                  </span>
                  <span className={`status-badge status-${sw.status}`}>{sw.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SwapCard({ swap, admin, onApprove, onReject }: {
  swap: SwapWithNames;
  admin: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <div className="swap-card">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>From</span>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>{swap.requester_name}</span>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)", textTransform: "capitalize" }}>{swap.requester_day}</span>
          <span className={`shift-pill ${SHIFT_CLASS[swap.requester_shift]}`} style={{ cursor: "default", marginTop: "2px" }}>
            {swap.requester_shift}
          </span>
        </div>

        <span className="swap-arrow" style={{ fontSize: "20px", padding: "0 8px" }}>↔</span>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 600 }}>With</span>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>{swap.target_name}</span>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)", textTransform: "capitalize" }}>{swap.target_day}</span>
          <span className={`shift-pill ${SHIFT_CLASS[swap.target_shift]}`} style={{ cursor: "default", marginTop: "2px" }}>
            {swap.target_shift}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flexShrink: 0 }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {new Date(swap.created_at).toLocaleDateString()}
        </span>
        <span className={`status-badge status-${swap.status}`}>{swap.status}</span>
        {admin && swap.status === "pending" && onApprove && onReject && (
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: "13px" }}
              onClick={onApprove}>Approve</button>
            <button className="btn btn-danger-ghost" style={{ border: "1.5px solid #fecaca" }}
              onClick={onReject}>Reject</button>
          </div>
        )}
      </div>
    </div>
  );
}