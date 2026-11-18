import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ChartRow, EvidenceBlock } from "../types";

type ScopeType = "element" | "standard";

type AgentCitation = {
  evidence_id: string;
  evidence_number?: number;
  quote?: string;
  section_label?: string | null;
  page_ordinal?: number;
  printed_label?: string | null;
  source?: { family?: string; edition?: string };
  screenshot_url?: string;
};

type AgentProposal = {
  id: string;
  status: "pending" | "accepted" | "rejected" | "stale";
  challenge: string;
  current_mapping_label?: string | null;
  proposed_mapping_label?: string | null;
  explanation?: string | null;
  rejection_reason?: string | null;
  review?: { disposition?: string; reasons?: string[] };
  proposed?: {
    rationale?: string;
    evidence_span_ids?: string[];
    missing_requirements?: string[];
    substantive_change?: boolean;
  };
  proposed_evidence_blocks?: EvidenceBlock[];
  current_evidence_blocks?: EvidenceBlock[];
};

type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  intent?: string | null;
  body: string;
  status: string;
  progress?: string[];
  evidence_refs?: AgentCitation[];
  base_revision_id?: string | null;
  proposal_id?: string | null;
  proposal?: AgentProposal;
  error?: string | null;
  created_at: string;
};

type AgentConversation = {
  id: string;
  run_id: string;
  scope_type: ScopeType;
  document_id: string;
  element_id?: string | null;
  scope_label: string;
  messages: AgentMessage[];
};

type Props = {
  runId: string;
  documentId: string;
  documentLabel: string;
  selectedRow: ChartRow | null;
  visible: boolean;
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
  onOpenCitation: (evidenceId: string) => void;
  onChartRefresh: () => Promise<void>;
};

const SUGGESTIONS = [
  { label: "Explain this mapping", text: "Why is this mapping labeled as it is?", intent: "question" as const },
  { label: "Find more evidence", text: "Find more supporting or contradictory evidence for this scope.", intent: "investigation" as const },
  { label: "Challenge this label", text: "Recheck this evidence and revise the mapping if justified.", intent: "revision" as const }
];

function progressLabel(status: string) {
  return (
    {
      queued: "Queued",
      searching: "Searching sources",
      examining: "Examining linked passages",
      preparing: "Preparing response",
      proposing: "Proposing revision",
      verifying: "Verifying evidence",
      reviewing: "Reviewing proposal",
      complete: "Complete",
      failed: "Failed"
    }[status] || status
  );
}

export default function AskAgentPanel({
  runId,
  documentId,
  documentLabel,
  selectedRow,
  visible,
  seedPrompt,
  onSeedConsumed,
  onOpenCitation,
  onChartRefresh
}: Props) {
  const [open, setOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [scopeType, setScopeType] = useState<ScopeType>(selectedRow ? "element" : "standard");
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);

  useEffect(() => {
    if (!seedPrompt?.trim()) return;
    setDraft(seedPrompt.trim());
    setOpen(true);
    onSeedConsumed?.();
  }, [seedPrompt, onSeedConsumed]);

  const scopeLabel = useMemo(() => {
    if (scopeType === "element" && selectedRow) {
      return `Claim ${selectedRow.label} · ${documentLabel}`;
    }
    return `Selected standard · ${documentLabel}`;
  }, [scopeType, selectedRow, documentLabel]);

  const loadConversation = useCallback(async () => {
    if (!runId || !documentId) return;
    if (scopeType === "element" && !selectedRow) {
      setConversation(null);
      return;
    }
    setError(null);
    const created = await api<AgentConversation>("/api/agent/conversations", {
      method: "POST",
      body: JSON.stringify({
        run_id: runId,
        scope_type: scopeType,
        document_id: documentId,
        element_id: scopeType === "element" ? selectedRow?.id : null
      })
    });
    const full = await api<AgentConversation>(`/api/agent/conversations/${created.id}`);
    setConversation(full);
  }, [runId, documentId, scopeType, selectedRow]);

  useEffect(() => {
    if (!visible) return;
    if (selectedRow) setScopeType((current) => (current === "standard" ? current : "element"));
    else setScopeType("standard");
  }, [selectedRow, visible]);

  useEffect(() => {
    if (!visible) return;
    loadConversation().catch((err: Error) => setError(err.message));
  }, [visible, loadConversation]);

  useEffect(() => {
    if (!conversation?.id || !pendingAssistantId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const full = await api<AgentConversation>(
          `/api/agent/conversations/${conversation.id}`
        );
        if (cancelled) return;
        setConversation(full);
        const assistant = full.messages.find((message) => message.id === pendingAssistantId);
        if (
          assistant &&
          (assistant.status === "complete" || assistant.status === "failed")
        ) {
          setPendingAssistantId(null);
          setBusy(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setBusy(false);
          setPendingAssistantId(null);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversation?.id, pendingAssistantId]);

  const send = async (text: string, forceIntent?: "question" | "investigation" | "revision") => {
    if (!conversation || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const kept = text;
    setDraft("");
    try {
      const created = await api<{ assistant_message_id: string }>(
        `/api/agent/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ body: text.trim(), force_intent: forceIntent || null })
        }
      );
      setPendingAssistantId(created.assistant_message_id);
      const full = await api<AgentConversation>(
        `/api/agent/conversations/${conversation.id}`
      );
      setConversation(full);
    } catch (err) {
      setDraft(kept);
      setBusy(false);
      setError((err as Error).message);
    }
  };

  const acceptProposal = async (proposalId: string) => {
    setError(null);
    try {
      await api(`/api/agent/proposals/${proposalId}/accept`, { method: "POST", body: "{}" });
      await onChartRefresh();
      await loadConversation();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const rejectProposal = async (proposalId: string) => {
    const reason = window.prompt("Optional rejection reason") || "";
    setError(null);
    try {
      await api(`/api/agent/proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      await loadConversation();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!visible) return null;

  return (
    <section className={`ask-agent ${open ? "open" : "collapsed"}`}>
      <button type="button" className="ask-agent-toggle" onClick={() => setOpen((value) => !value)}>
        <strong>Ask agent</strong>
        <span>{open ? "Collapse" : "Expand"}</span>
      </button>
      {open ? (
        <div className="ask-agent-body">
          <div className="ask-scope">
            <label>
              Scope
              <select
                value={scopeType}
                onChange={(event) => setScopeType(event.target.value as ScopeType)}
                disabled={busy}
              >
                <option value="element" disabled={!selectedRow}>
                  Selected element
                </option>
                <option value="standard">Selected standard</option>
              </select>
            </label>
            <p className="ask-scope-label">{scopeLabel}</p>
          </div>

          <button
            type="button"
            className="ghost"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {historyOpen ? "Hide conversation" : "Show conversation"}
          </button>

          {historyOpen ? (
            <div className="ask-history">
              {!conversation?.messages?.length ? (
                <div className="empty" style={{ padding: 12 }}>
                  Ask a question, investigate sources, or request a revision proposal. Notes stay
                  separate for human discussion.
                </div>
              ) : (
                conversation.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`ask-message ${message.role} ${message.status}`}
                  >
                    <header>
                      <strong>{message.role === "user" ? "You" : "Agent"}</strong>
                      <span>{progressLabel(message.status)}</span>
                      {message.intent ? <span>{message.intent}</span> : null}
                    </header>
                    {message.body ? <p className="ask-message-body">{message.body}</p> : null}
                    {message.error ? <div className="warn-box">{message.error}</div> : null}
                    {message.evidence_refs?.length ? (
                      <div className="ask-citations">
                        {message.evidence_refs.map((citation) => (
                          <button
                            key={citation.evidence_id}
                            type="button"
                            className="citation-chip"
                            onClick={() => onOpenCitation(citation.evidence_id)}
                          >
                            [{citation.evidence_number || "cite"}]{" "}
                            {citation.section_label || "passage"} · PDF p.{" "}
                            {citation.page_ordinal}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.proposal ? (
                      <div className="ask-proposal">
                        <p>
                          <strong>Proposal:</strong> {message.proposal.current_mapping_label || "—"}{" "}
                          → {message.proposal.proposed_mapping_label || "—"} (
                          {message.proposal.status})
                        </p>
                        {message.proposal.proposed?.missing_requirements?.length ? (
                          <p>
                            Missing:{" "}
                            {message.proposal.proposed.missing_requirements
                              .map((value: string) => value.trim())
                              .filter(Boolean)
                              .filter(
                                (value: string) =>
                                  value.toLowerCase() !== "exact unresolved requirements"
                              )
                              .join("; ") ||
                              "Not identified — further review is required"}
                          </p>
                        ) : null}
                        {message.proposal.review?.reasons?.length ? (
                          <p>Review: {message.proposal.review.reasons.join("; ")}</p>
                        ) : null}
                        {message.proposal.status === "pending" ? (
                          <div className="action-row">
                            <button
                              type="button"
                              className="accept"
                              onClick={() => acceptProposal(message.proposal!.id)}
                            >
                              Accept revision
                            </button>
                            <button
                              type="button"
                              className="reject"
                              onClick={() => rejectProposal(message.proposal!.id)}
                            >
                              Reject revision
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setDraft("Follow-up: ")}
                            >
                              Ask a follow-up
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {message.status === "failed" ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          const prior = conversation.messages
                            .slice(
                              0,
                              conversation.messages.findIndex((item) => item.id === message.id)
                            )
                            .reverse()
                            .find((item) => item.role === "user");
                          if (prior) send(prior.body, prior.intent as "question" | "investigation" | "revision" | undefined);
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          ) : null}

          {error ? <div className="warn-box">{error}</div> : null}

          <div className="ask-suggestions">
            {SUGGESTIONS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="filter-pill"
                disabled={busy || (item.intent === "revision" && scopeType !== "element")}
                onClick={() => send(item.text, item.intent)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="ask-compose">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question or challenge this mapping…"
              rows={3}
              disabled={busy || (scopeType === "element" && !selectedRow)}
            />
            <button
              type="button"
              className="secondary"
              disabled={busy || !draft.trim()}
              onClick={() => send(draft)}
            >
              {busy ? "Working…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
