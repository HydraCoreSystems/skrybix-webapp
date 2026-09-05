"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteResult = { ok: true; message: string } | { ok: false; message: string };

type Props = {
  id: string;
  /** Owner-facing noun, e.g. "mother plant" or "cutting". */
  label: string;
  onDelete: (id: string) => Promise<DeleteResult>;
  /** Where to send the owner after a successful delete (the record's own
   *  page no longer exists once this runs). */
  redirectTo: string;
};

/**
 * Explicit, two-step delete confirmation -- a real DELETE is permanent
 * (mother_id/cutting_id are otherwise treated as permanent identities in
 * this app), so this never fires from a single click. Mirrors the
 * confirm-panel pattern CuttingProfileActions already uses for "Record
 * outgoing" (open a panel, require an explicit second click, Cancel is
 * always available).
 */
export default function DeleteRecordButton({ id, label, onDelete, redirectTo }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const result = await onDelete(id);
    if (result.ok) {
      router.push(`${redirectTo}?success=${encodeURIComponent(result.message)}`);
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  if (!open) {
    return (
      <button className="btn small danger" type="button" onClick={() => setOpen(true)}>
        Delete this {label}
      </button>
    );
  }

  return (
    <div className="outgoing-confirmation">
      {error && <div className="flash error" role="status">{error}</div>}
      <p>
        <strong>Permanently delete {id}?</strong> This cannot be undone.
      </p>
      <div className="profile-secondary-actions">
        <button className="btn danger" type="button" disabled={busy} onClick={confirmDelete}>
          {busy ? "Deleting…" : `Yes, permanently delete this ${label}`}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
