import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  History,
  Maximize2,
  Minimize2,
  Pencil,
  SendHorizontal,
  Trash2,
  X
} from "lucide-react";
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
  review?: { disposition?: string; reasons?: string[] };
  proposed?: {
    rationale?: string;
    evidence_span_ids?: string[];
    missing_requirements?: string[];
  };
  proposed_evidence_blocks?: EvidenceBlock[];
};

type SuggestedAction = { id: string; label: string };

type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  intent?: string | null;
  body: string;
  status: string;
  progress?: string[];
  evidence_refs?: AgentCitation[];
  proposal?: AgentProposal;
  suggested_actions?: SuggestedAction[];
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
  created_at?: string;
  updated_at?: string;
  messages: AgentMessage[];
};

type ConversationSummary = {
  id: string;
  run_id: string;
  scope_type: ScopeType;
  document_id: string;
  element_id?: string | null;
  scope_label: string;
  created_at: string;
  updated_at: string;
  preview?: string;
  message_count?: number;
};

type Props = {
  runId: string;
  documentId: string;
  documentLabel: string;
  selectedRow: ChartRow | null;
  chartRows?: ChartRow[];
  visible: boolean;
  /** When set, pre-select this claim element (row-level Ask agent). */
  preferredElementId?: string | null;
  /** When true, keep following the preferred/selected row into scope. */
  lockToPreferredElement?: boolean;
  seedPrompt?: string | null;
  analystName?: string;
  onClose?: () => void;
  onSeedConsumed?: () => void;
  onOpenCitation: (evidenceId: string) => void;
  onChartRefresh: () => Promise<void>;
  onSelectRow?: (rowId: string) => void;
  onUiStateChange?: (state: {
    historyOpen: boolean;
    layout: "normal" | "minimized" | "maximized";
  }) => void;
};

type PanelLayout = "normal" | "minimized" | "maximized";

const SUGGESTIONS = [
  {
    label: "Explain this mapping",
    text: "Why is this mapping labeled as it is? Explain using the claim text and cited standard evidence.",
    intent: "question" as const
  },
  {
    label: "Find more evidence",
    text: "Find more supporting or contradictory evidence in the selected standard for this claim element.",
    intent: "investigation" as const
  },
  {
    label: "What is missing",
    text: "What claim limitations are still unsupported, and which standard clauses should be checked next?",
    intent: "investigation" as const
  },
  {
    label: "Propose chart update",
    text: "Recheck the evidence and propose a revised mapping label, rationale, and evidence set if justified.",
    intent: "revision" as const
  }
];

function formatWhen(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function truncateText(value: string, max = 72) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function elementOptionLabel(row: ChartRow) {
  const mapping = row.revisions.at(-1)?.mapping_label;
  const claimText = truncateText(row.exact_text || "");
  const parts = [row.label];
  if (claimText) parts.push(claimText);
  if (mapping) parts.push(mapping);
  return parts.join(" · ");
}

function progressLabel(status: string) {
  return (
    {
      queued: "Queued",
      searching: "Searching",
      examining: "Examining",
      preparing: "Preparing",
      proposing: "Proposing",
      verifying: "Verifying",
      reviewing: "Reviewing",
      complete: "Done",
      failed: "Failed"
    }[status] || status
  );
}

function MessageList({
  messages,
  emptyChat,
  busy,
  actionBusy,
  onSendSuggestion,
  onOpenCitation,
  onAcceptProposal,
  onRejectProposal,
  onSuggestedAction
}: {
  messages: AgentMessage[];
  emptyChat: boolean;
  busy: boolean;
  actionBusy: boolean;
  onSendSuggestion: (text: string, intent: "question" | "investigation" | "revision") => void;
  onOpenCitation: (evidenceId: string) => void;
  onAcceptProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onSuggestedAction: (message: AgentMessage, action: SuggestedAction) => void;
}) {
  if (emptyChat) {
    return (
      <div className="ask-empty-state">
        <h3>What can I help you with?</h3>
        <div className="ask-suggestion-list">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="ask-suggestion-row"
              disabled={busy}
              onClick={() => onSendSuggestion(item.text, item.intent)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ask-history ask-history-chat">
      {messages.map((message) => (
        <article key={message.id} className={`ask-message ${message.role} ${message.status}`}>
          <header>
            <strong>{message.role === "user" ? "You" : "Agent"}</strong>
            <span>{progressLabel(message.status)}</span>
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
                  [{citation.evidence_number || "cite"}] {citation.section_label || "passage"} · PDF
                  p. {citation.page_ordinal}
                </button>
              ))}
            </div>
          ) : null}
          {message.proposal?.status === "pending" ? (
            <div className="action-row">
              <button
                type="button"
                className="accept"
                disabled={actionBusy}
                onClick={() => onAcceptProposal(message.proposal!.id)}
              >
                Accept — update claim
              </button>
              <button
                type="button"
                className="reject"
                disabled={actionBusy}
                onClick={() => onRejectProposal(message.proposal!.id)}
              >
                Reject
              </button>
            </div>
          ) : null}
          {(message.suggested_actions || []).length ? (
            <div className="action-row">
              {message.suggested_actions!.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="secondary"
                  disabled={actionBusy || busy}
                  onClick={() => onSuggestedAction(message, action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default function AskAgentPanel({
  runId,
  documentId,
  documentLabel,
  selectedRow,
  chartRows = [],
  visible,
  preferredElementId = null,
  lockToPreferredElement = false,
  seedPrompt,
  analystName = "Analyst",
  onClose,
  onSeedConsumed,
  onOpenCitation,
  onChartRefresh,
  onSelectRow,
  onUiStateChange
}: Props) {
  const initialElementId =
    preferredElementId || selectedRow?.id || chartRows[0]?.id || null;
  const [scopeElementId, setScopeElementId] = useState<string | null>(initialElementId);
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyConversation, setHistoryConversation] = useState<AgentConversation | null>(null);
  const [layout, setLayout] = useState<PanelLayout>("normal");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const syncedPreferredRef = useRef<string | null>(null);

  useEffect(() => {
    onUiStateChange?.({ historyOpen, layout });
  }, [historyOpen, layout, onUiStateChange]);

  const scopedRow = useMemo(
    () => chartRows.find((row) => row.id === scopeElementId) || selectedRow,
    [scopeElementId, chartRows, selectedRow]
  );

  useEffect(() => {
    if (!seedPrompt?.trim()) return;
    setDraft(seedPrompt.trim());
    onSeedConsumed?.();
  }, [seedPrompt, onSeedConsumed]);

  const firstRowId = chartRows[0]?.id || null;

  // Row-level open: lock to that element once. Global open: all elements, default first/selected.
  useEffect(() => {
    if (!visible) {
      syncedPreferredRef.current = null;
      return;
    }
    if (preferredElementId) {
      if (syncedPreferredRef.current === preferredElementId && !lockToPreferredElement) return;
      syncedPreferredRef.current = preferredElementId;
      setScopeElementId(preferredElementId);
      return;
    }
    if (!scopeElementId && firstRowId) {
      setScopeElementId(selectedRow?.id || firstRowId);
    }
  }, [
    visible,
    preferredElementId,
    lockToPreferredElement,
    firstRowId,
    selectedRow?.id,
    scopeElementId
  ]);

  const openConversation = useCallback(
    async (options?: { forceNew?: boolean; conversationId?: string }) => {
      if (!runId || !documentId) return null;
      if (!scopeElementId) {
        setConversation(null);
        return null;
      }
      setError(null);
      if (options?.conversationId) {
        const full = await api<AgentConversation>(
          `/api/agent/conversations/${options.conversationId}`
        );
        setConversation(full);
        if (full.element_id) {
          setScopeElementId(full.element_id);
          onSelectRow?.(full.element_id);
        }
        return full;
      }
      const created = await api<AgentConversation>("/api/agent/conversations", {
        method: "POST",
        body: JSON.stringify({
          run_id: runId,
          scope_type: "element",
          document_id: documentId,
          element_id: scopeElementId,
          force_new: Boolean(options?.forceNew)
        })
      });
      const full = await api<AgentConversation>(`/api/agent/conversations/${created.id}`);
      setConversation(full);
      return full;
    },
    [runId, documentId, scopeElementId, onSelectRow]
  );

  const openConversationRef = useRef(openConversation);
  openConversationRef.current = openConversation;
  const loadedScopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      loadedScopeKeyRef.current = null;
      return;
    }
    if (!scopeElementId) return;
    const key = `${runId}:${documentId}:element:${scopeElementId}`;
    if (loadedScopeKeyRef.current === key) return;
    loadedScopeKeyRef.current = key;
    let cancelled = false;
    openConversationRef.current().catch((err: Error) => {
      if (!cancelled) {
        loadedScopeKeyRef.current = null;
        setError(err.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, runId, documentId, scopeElementId]);

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
        if (historyOpen && historyConversation?.id === full.id) {
          setHistoryConversation(full);
        }
        const assistant = full.messages.find((message) => message.id === pendingAssistantId);
        if (assistant && (assistant.status === "complete" || assistant.status === "failed")) {
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
  }, [conversation?.id, pendingAssistantId, historyOpen, historyConversation?.id]);

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
      if (historyOpen) setHistoryConversation(full);
    } catch (err) {
      setDraft(kept);
      setBusy(false);
      setError((err as Error).message);
    }
  };

  const startNewChat = async () => {
    setDraft("");
    setPendingAssistantId(null);
    setBusy(false);
    try {
      const full = await openConversation({ forceNew: true });
      if (historyOpen && full) setHistoryConversation(full);
      if (historyOpen) {
        const items = await api<ConversationSummary[]>(
          `/api/runs/${runId}/agent/conversations`
        );
        setHistoryItems(items);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setLayout("normal");
    setHistoryBusy(true);
    setError(null);
    try {
      const items = await api<ConversationSummary[]>(
        `/api/runs/${runId}/agent/conversations`
      );
      setHistoryItems(items);
      setHistoryConversation(conversation);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const closeHistory = () => {
    setHistoryOpen(false);
  };

  const loadHistoryConversation = async (id: string) => {
    setHistoryBusy(true);
    try {
      const full = await openConversation({ conversationId: id });
      if (full) setHistoryConversation(full);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const deleteHistoryConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    setHistoryBusy(true);
    setError(null);
    try {
      await api(`/api/agent/conversations/${id}`, { method: "DELETE" });
      const items = await api<ConversationSummary[]>(
        `/api/runs/${runId}/agent/conversations`
      );
      setHistoryItems(items);
      if (conversation?.id === id) {
        loadedScopeKeyRef.current = null;
        const next = await openConversation({ forceNew: true });
        setHistoryConversation(next);
      } else if (historyConversation?.id === id) {
        const fallback = items[0]
          ? await openConversation({ conversationId: items[0].id })
          : await openConversation({ forceNew: true });
        setHistoryConversation(fallback);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const acceptProposal = async (proposalId: string) => {
    setActionBusy(true);
    setError(null);
    try {
      await api(`/api/agent/proposals/${proposalId}/accept`, { method: "POST", body: "{}" });
      await onChartRefresh();
      if (conversation?.id) {
        const full = await api<AgentConversation>(
          `/api/agent/conversations/${conversation.id}`
        );
        setConversation(full);
        if (historyOpen) setHistoryConversation(full);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const rejectProposal = async (proposalId: string) => {
    const reason = window.prompt("Optional rejection reason") || "";
    setActionBusy(true);
    setError(null);
    try {
      await api(`/api/agent/proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      if (conversation?.id) {
        const full = await api<AgentConversation>(
          `/api/agent/conversations/${conversation.id}`
        );
        setConversation(full);
        if (historyOpen) setHistoryConversation(full);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const applyCitations = async (messageId: string) => {
    setActionBusy(true);
    setError(null);
    try {
      await api(`/api/agent/messages/${messageId}/apply-citations`, {
        method: "POST",
        body: JSON.stringify({ analyst_name: analystName })
      });
      await onChartRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const runSuggestedAction = async (message: AgentMessage, action: SuggestedAction) => {
    if (action.id === "add_citations") {
      await applyCitations(message.id);
      return;
    }
    if (action.id === "propose_revision") {
      await send(
        "Based on your last answer, propose a concrete chart update if justified.",
        "revision"
      );
    }
  };

  if (!visible) return null;

  const messages = conversation?.messages || [];
  const emptyChat = messages.length === 0;
  const historyMessages = historyConversation?.messages || [];
  const historyEmpty = historyMessages.length === 0;

  const scopeControls = (
    <div className="ask-scope ask-scope-inline">
      <label>
        Claim element
        <select
          value={scopeElementId || ""}
          onChange={(event) => {
            const id = event.target.value;
            setScopeElementId(id);
            onSelectRow?.(id);
          }}
          disabled={busy || chartRows.length === 0}
        >
          {chartRows.map((row) => (
            <option key={row.id} value={row.id}>
              {elementOptionLabel(row)}
            </option>
          ))}
        </select>
      </label>
      {scopedRow?.exact_text ? (
        <p className="ask-scope-claim-text" title={scopedRow.exact_text}>
          {scopedRow.exact_text}
        </p>
      ) : null}
      {documentLabel ? <p className="ask-scope-label muted">{documentLabel}</p> : null}
    </div>
  );

  const composeBar = (
    <div className="ask-compose ask-compose-pill">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Ask about this claim chart, patent, or standard…"
        rows={1}
        disabled={busy || !scopedRow}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (draft.trim() && !busy) void send(draft);
          }
        }}
      />
      <button
        type="button"
        className="ask-send-fab"
        disabled={busy || !draft.trim()}
        aria-label="Send"
        onClick={() => void send(draft)}
      >
        <SendHorizontal size={16} />
      </button>
    </div>
  );

  const headerActions = (
    <div className="ask-chat-header-actions">
      <button
        type="button"
        className="ask-icon-btn"
        title="Conversation history"
        aria-label="Conversation history"
        onClick={() => void openHistory()}
      >
        <History size={16} />
      </button>
      <button
        type="button"
        className="ask-icon-btn"
        title="New conversation"
        aria-label="New conversation"
        onClick={() => void startNewChat()}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        className="ask-icon-btn"
        title={layout === "minimized" ? "Restore" : "Minimize"}
        aria-label={layout === "minimized" ? "Restore" : "Minimize"}
        onClick={() => setLayout((prev) => (prev === "minimized" ? "normal" : "minimized"))}
      >
        <Minimize2 size={16} />
      </button>
      <button
        type="button"
        className="ask-icon-btn"
        title={layout === "maximized" ? "Restore" : "Maximize"}
        aria-label={layout === "maximized" ? "Restore" : "Maximize"}
        onClick={() => setLayout((prev) => (prev === "maximized" ? "normal" : "maximized"))}
      >
        <Maximize2 size={16} />
      </button>
      {onClose ? (
        <button
          type="button"
          className="ask-icon-btn"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Bottom dock is hidden while the full history workspace is open. */}
      {!historyOpen ? (
        layout === "minimized" ? (
          <section className="ask-agent ask-agent-chatbot ask-agent-minimized open">
            <header className="ask-chat-header">
              <button
                type="button"
                className="ask-minimized-title"
                onClick={() => setLayout("normal")}
              >
                Ask agent
                {scopedRow ? ` · ${scopedRow.label}` : ""}
              </button>
              {headerActions}
            </header>
          </section>
        ) : (
          <section
            className={`ask-agent ask-agent-chatbot open ${
              layout === "maximized" ? "ask-agent-maximized" : ""
            }`}
          >
            <header className="ask-chat-header">
              <strong>Ask agent</strong>
              {headerActions}
            </header>

            <div className="ask-agent-body">
              {scopeControls}
              <div className="ask-chat-main">
                <MessageList
                  messages={messages}
                  emptyChat={emptyChat}
                  busy={busy}
                  actionBusy={actionBusy}
                  onSendSuggestion={(text, intent) => void send(text, intent)}
                  onOpenCitation={onOpenCitation}
                  onAcceptProposal={(id) => void acceptProposal(id)}
                  onRejectProposal={(id) => void rejectProposal(id)}
                  onSuggestedAction={(message, action) =>
                    void runSuggestedAction(message, action)
                  }
                />
              </div>
              {error ? <div className="warn-box">{error}</div> : null}
              {composeBar}
            </div>
          </section>
        )
      ) : null}

      {historyOpen
        ? createPortal(
            <div
              className="modal-backdrop ask-history-backdrop"
              role="presentation"
              onClick={closeHistory}
            >
              <div
                className="ask-history-workspace"
                role="dialog"
                aria-label="Ask agent history"
                onClick={(event) => event.stopPropagation()}
              >
                <aside className="ask-history-sidebar">
                  <header className="ask-history-sidebar-head">
                    <strong>History</strong>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void startNewChat()}
                    >
                      New chat
                    </button>
                  </header>
                  {historyBusy && !historyItems.length ? (
                    <p className="doc-sub" style={{ padding: "0 12px" }}>
                      Loading…
                    </p>
                  ) : null}
                  {!historyBusy && !historyItems.length ? (
                    <div className="empty" style={{ padding: 16 }}>
                      No conversations yet.
                    </div>
                  ) : (
                    <ul className="ask-history-list">
                      {historyItems.map((item) => {
                        const active =
                          (historyConversation?.id || conversation?.id) === item.id;
                        return (
                          <li key={item.id} className="ask-history-row">
                            <button
                              type="button"
                              className={`ask-history-item ${active ? "active" : ""}`}
                              onClick={() => void loadHistoryConversation(item.id)}
                            >
                              <div className="ask-history-item-top">
                                <strong>{item.scope_label}</strong>
                                <span>{formatWhen(item.updated_at || item.created_at)}</span>
                              </div>
                              <p>{item.preview || "Empty conversation"}</p>
                              <span className="doc-sub">
                                {item.message_count || 0} messages · {item.scope_type}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="ask-history-delete"
                              title="Delete conversation"
                              aria-label={`Delete ${item.scope_label}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteHistoryConversation(item.id);
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </aside>
                <div className="ask-history-main">
                  <header className="ask-history-main-head">
                    <div>
                      <strong>
                        {historyConversation?.scope_label ||
                          conversation?.scope_label ||
                          "Chat"}
                      </strong>
                      <span className="doc-sub">
                        {formatWhen(
                          historyConversation?.updated_at || conversation?.updated_at
                        )}
                      </span>
                    </div>
                    <div className="ask-history-main-actions">
                      {historyConversation?.id || conversation?.id ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            void deleteHistoryConversation(
                              historyConversation?.id || conversation!.id
                            )
                          }
                        >
                          Delete
                        </button>
                      ) : null}
                      <button type="button" className="ghost" onClick={closeHistory}>
                        Close
                      </button>
                    </div>
                  </header>
                  <div className="ask-history-main-body">
                    <MessageList
                      messages={historyMessages}
                      emptyChat={historyEmpty}
                      busy={busy}
                      actionBusy={actionBusy}
                      onSendSuggestion={(text, intent) => void send(text, intent)}
                      onOpenCitation={onOpenCitation}
                      onAcceptProposal={(id) => void acceptProposal(id)}
                      onRejectProposal={(id) => void rejectProposal(id)}
                      onSuggestedAction={(message, action) =>
                        void runSuggestedAction(message, action)
                      }
                    />
                  </div>
                  {error ? <div className="warn-box">{error}</div> : null}
                  <div className="ask-history-main-compose">{composeBar}</div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
