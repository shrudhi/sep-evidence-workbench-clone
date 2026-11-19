import { useEffect, useState } from "react";
import { api } from "../api";
import InlineSpinner from "./InlineSpinner";
import type { ChartRevision, ChartRow } from "../types";

type Thread = {
  id: string;
  status: string;
  author_display_name?: string;
  assigned_reviewer_name?: string | null;
  created_at?: string;
  comments?: Array<{
    id: string;
    author_display_name?: string;
    body: string;
    created_at?: string;
  }>;
};

type Props = {
  row: ChartRow;
  revision: ChartRevision | null;
  analystName: string;
  onNotice?: (message: string | null) => void;
};

export default function NotesPanel({ row, revision, analystName, onNotice }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const next = await api<Thread[]>(`/api/elements/${encodeURIComponent(row.id)}/threads`);
      setThreads(next);
    } catch (error) {
      onNotice?.((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const createNote = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api(`/api/elements/${encodeURIComponent(row.id)}/threads`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim(),
          author_display_name: analystName || "Analyst",
          revision_id: revision?.id || null
        })
      });
      setBody("");
      await load();
      onNotice?.("Note saved.");
    } catch (error) {
      onNotice?.((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resolveThread = async (threadId: string) => {
    setBusy(true);
    try {
      await api(`/api/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" })
      });
      await load();
    } catch (error) {
      onNotice?.((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notes-panel">
      <p className="doc-sub" style={{ marginTop: 0 }}>
        Analyst notes for <strong className="evd-mono">{row.label}</strong> — saved with the run.
      </p>

      <label className="notes-compose">
        Add note
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Follow-up, assignment context, or review note…"
        />
      </label>
      <button
        type="button"
        className="btn btn-action"
        disabled={busy || !body.trim()}
        onClick={() => void createNote()}
      >
        {busy ? "Saving note…" : "Save note"}
      </button>

      <div className="notes-list">
        {loading ? (
          <p className="doc-sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <InlineSpinner label="Loading notes" /> Loading notes…
          </p>
        ) : null}
        {!loading && !threads.length ? (
          <p className="doc-sub">No notes yet for this element.</p>
        ) : null}
        {threads.map((thread) => (
          <article key={thread.id} className={`notes-thread ${thread.status}`}>
            <div className="notes-thread-head">
              <span className="evd-mono">{thread.status}</span>
              <span className="doc-sub">
                {(thread.created_at || "").slice(0, 19)} · {thread.author_display_name || "Analyst"}
              </span>
            </div>
            {(thread.comments || []).map((comment) => (
              <p key={comment.id} className="notes-comment">
                {comment.body}
              </p>
            ))}
            {thread.status === "open" ? (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void resolveThread(thread.id)}
              >
                Resolve
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
