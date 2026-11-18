import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  LoaderCircle,
  X
} from "lucide-react";
import { api } from "../api";
import type { Health, SetupBundle, StandardRecord } from "../types";

type SelectionStatus = {
  runId: string;
  status: string;
  statusLabel: string;
} | null;

type Proof = {
  span_id?: string;
  section?: string;
  page?: string | number | null;
  quote?: string;
};

type CandidateDecision = {
  document_id: string;
  disposition: "selected" | "rejected" | string;
  rationale: string;
  evidence_span_ids?: string[];
  proofs?: Proof[];
};

type TargetDecision = {
  target_document_id: string;
  candidates: CandidateDecision[];
};

type RunDetail = {
  id: string;
  status: string;
  target_document_id?: string | null;
  target_decision?: TargetDecision | null;
};

type DocPreview = {
  id: string;
  title: string;
  subtitle?: string;
};

type Props = {
  setup: SetupBundle;
  health: Health | null;
  saving: boolean;
  starting: boolean;
  confirming?: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onResetAutomation: () => Promise<void>;
  onStart: () => Promise<void>;
  onConfirmTargets?: (runId: string, documentIds: string[]) => Promise<void>;
  selectionStatus?: SelectionStatus;
};

function pdfUrl(documentId: string) {
  return `/api/documents/${documentId}/pdf`;
}

export default function SetupScreen({
  setup,
  health,
  saving,
  starting,
  confirming = false,
  onPatch,
  onStart,
  onConfirmTargets,
  selectionStatus = null
}: Props) {
  const { project, patent, patent_error, standards } = setup;
  const [decision, setDecision] = useState<TargetDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [chartTargets, setChartTargets] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [preview, setPreview] = useState<DocPreview | null>(null);

  const selectedClaims = project.selected_claim_numbers;
  const selectedStandards = project.selected_standard_ids;
  const claimCount = selectedClaims.length;
  const selectedIndexed = standards.filter(
    (item) => selectedStandards.includes(item.id) && item.status === "indexed"
  );
  const providerReady = Boolean(health?.provider.ready);
  const awaitingConfirm = selectionStatus?.status === "awaiting_target_confirm";
  const selecting =
    selectionStatus && ["queued", "selecting"].includes(selectionStatus.status);
  const showDecision =
    Boolean(decision?.candidates?.length) &&
    Boolean(
      awaitingConfirm ||
        selectionStatus?.status === "complete" ||
        selectionStatus?.status === "analyst_review"
    );
  const locked = Boolean(awaitingConfirm || selecting || starting || confirming);

  useEffect(() => {
    if (!selectionStatus?.runId) {
      setDecision(null);
      return;
    }
    // While selecting, clear stale rationales until the new decision arrives.
    if (["queued", "selecting"].includes(selectionStatus.status)) {
      setDecision(null);
      setDecisionLoading(true);
      return;
    }
    let cancelled = false;
    setDecisionLoading(true);
    const load = () =>
      api<RunDetail>(`/api/runs/${selectionStatus.runId}`)
        .then((run) => {
          if (cancelled) return;
          const next = run.target_decision || null;
          setDecision(next);
          const recommended =
            next?.target_document_id ||
            next?.candidates.find((c) => c.disposition === "selected")?.document_id ||
            run.target_document_id ||
            "";
          setChartTargets((current) =>
            awaitingConfirm || current.length === 0
              ? recommended
                ? [recommended]
                : []
              : current
          );
          if (recommended) {
            setExpanded((current) =>
              Object.keys(current).length ? current : { [recommended]: true }
            );
          }
        })
        .catch(() => {
          if (!cancelled) setDecision(null);
        })
        .finally(() => {
          if (!cancelled) setDecisionLoading(false);
        });
    load();
    return () => {
      cancelled = true;
    };
  }, [selectionStatus?.runId, selectionStatus?.status, awaitingConfirm]);

  const candidateById = useMemo(() => {
    const map = new Map<string, CandidateDecision>();
    for (const item of decision?.candidates || []) {
      map.set(item.document_id, item);
    }
    return map;
  }, [decision]);

  const setupReady = Boolean(patent && claimCount > 0 && selectedIndexed.length > 0);
  const canStart =
    setupReady && !starting && !saving && providerReady && !awaitingConfirm && !selecting;
  const canConfirm =
    Boolean(awaitingConfirm && decision && chartTargets.length > 0 && onConfirmTargets) &&
    !confirming &&
    !saving;

  const startBlockedReason = !patent
    ? patent_error || "Patent input is not ready"
    : claimCount < 1
      ? "Select at least one claim"
      : selectedIndexed.length < 1
        ? "Select at least one indexed standard"
        : !providerReady
          ? `Model provider not ready (${health?.provider.missing.join(", ") || "check .env"})`
          : null;

  const toggleClaim = async (number: number) => {
    const next = selectedClaims.includes(number)
      ? selectedClaims.filter((item) => item !== number)
      : [...selectedClaims, number].sort((a, b) => a - b);
    await onPatch({ claim_scope: "select", selected_claim_numbers: next });
  };

  const toggleStandardForAnalysis = async (id: string) => {
    const next = selectedStandards.includes(id)
      ? selectedStandards.filter((item) => item !== id)
      : [...selectedStandards, id];
    await onPatch({ selected_standard_ids: next });
  };

  const toggleChartTarget = (id: string) => {
    setChartTargets((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  };

  const recommendedId = decision?.target_document_id;

  const orderedStandards = useMemo(() => {
    if (!decision?.candidates?.length) return standards;
    const order = decision.candidates.map((c) => c.document_id);
    return [...standards].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  }, [standards, decision]);

  return (
    <section className="setup-page">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title-compact">Matter setup</h1>
          <p className="page-sub-compact">
            Patent and claims first. Then select standards — with rationale and proof when ready.
          </p>
        </div>
        <div className="page-header-actions">
          {!awaitingConfirm ? (
            <button className="btn btn-primary" disabled={!canStart} onClick={() => onStart()}>
              {starting || selecting ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Starting…
                </>
              ) : (
                "Start analysis"
              )}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!canConfirm}
              onClick={() =>
                selectionStatus && onConfirmTargets?.(selectionStatus.runId, chartTargets)
              }
            >
              {confirming ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Building…
                </>
              ) : chartTargets.length > 1 ? (
                `Build ${chartTargets.length} charts`
              ) : (
                "Build claim chart"
              )}
            </button>
          )}
        </div>
      </div>

      {startBlockedReason && !awaitingConfirm ? (
        <div className="inline-alert">{startBlockedReason}</div>
      ) : null}
      {selecting ? (
        <div className="inline-alert info">
          Evaluating selected standards and drafting recommend / reject rationales with source
          proof…
        </div>
      ) : null}
      {awaitingConfirm && chartTargets.length > 1 ? (
        <div className="inline-alert warn">
          {chartTargets.length} standards selected — this will create{" "}
          <strong>{chartTargets.length} separate claim charts</strong>.
        </div>
      ) : null}

      {/* Patent + compact claims */}
      <section className="ui-card patent-block">
        <div className="ui-card-head">
          <h2>Patent</h2>
          {patent ? <span className="badge badge-success">Ready</span> : null}
        </div>
        {!patent ? (
          <div className="inline-alert">{patent_error || "Patent unavailable"}</div>
        ) : (
          <>
            <div className="patent-summary-row">
              <div className="patent-summary-main">
                <FileText size={16} />
                <div>
                  <strong>
                    {patent.identifier} — {patent.title}
                  </strong>
                  <span>
                    {[patent.version_label, patent.date_label].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <div className="doc-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setPreview({
                      id: patent.document_id || patent.id,
                      title: patent.identifier,
                      subtitle: patent.version_label || patent.filename
                    })
                  }
                >
                  <Eye size={13} /> View
                </button>
                <a
                  className="btn btn-ghost"
                  href={pdfUrl(patent.document_id || patent.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> PDF
                </a>
              </div>
            </div>
            <p className="doc-compact-summary clamp-2" style={{ marginTop: 8 }}>
              {patent.summary || patent.description}
            </p>

            <div className="claims-under-patent">
              <button
                type="button"
                className="claims-under-patent-head claims-disclosure"
                aria-expanded={claimsOpen}
                onClick={() => setClaimsOpen((open) => !open)}
              >
                <span className="claims-disclosure-title">
                  {claimsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Claims to chart
                </span>
                <span className="meta-quiet">
                  {claimCount === 1 && selectedClaims[0] === 1
                    ? "Claim 1 selected"
                    : `${claimCount} selected`}
                </span>
              </button>
              {!claimsOpen ? (
                <p className="claims-collapsed-summary">
                  {selectedClaims.length
                    ? `Charting Claim ${selectedClaims.join(", Claim ")}. Expand to change selection.`
                    : "No claims selected. Expand to choose claims."}
                </p>
              ) : (
                <div className="claim-chip-list">
                  {patent.claims.map((claim) => {
                    const checked = selectedClaims.includes(claim.number);
                    return (
                      <label
                        key={claim.number}
                        className={`claim-chip ${checked ? "is-checked" : ""}`}
                        title={claim.exact_text || claim.preview}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => toggleClaim(claim.number)}
                        />
                        <span className="claim-chip-label">Claim {claim.number}</span>
                        <span className="claim-chip-preview">
                          {(claim.preview || claim.exact_text || "").slice(0, 88)}
                          {(claim.preview || claim.exact_text || "").length > 88 ? "…" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Standards as separate cards */}
      <section className="standards-section">
        <div className="standards-section-head">
          <h2>Select a standard</h2>
          <span className="meta-quiet">
            {selecting || decisionLoading
              ? "Loading recommend / reject rationales…"
              : showDecision
                ? awaitingConfirm
                  ? `${chartTargets.length} selected for charting`
                  : "Latest recommend / reject rationales"
                : `${selectedIndexed.length} selected for analysis`}
          </span>
        </div>

        <div className="standard-card-grid">
          {orderedStandards.map((standard) => (
            <StandardCard
              key={standard.id}
              standard={standard}
              candidate={candidateById.get(standard.id)}
              recommended={standard.id === recommendedId}
              showDecision={showDecision}
              chartSelectable={Boolean(awaitingConfirm)}
              checked={
                awaitingConfirm
                  ? chartTargets.includes(standard.id)
                  : selectedStandards.includes(standard.id)
              }
              expanded={Boolean(expanded[standard.id])}
              locked={locked && !awaitingConfirm}
              onToggleCheck={() =>
                awaitingConfirm
                  ? toggleChartTarget(standard.id)
                  : toggleStandardForAnalysis(standard.id)
              }
              onToggleExpand={() => toggleExpanded(standard.id)}
              onView={() =>
                setPreview({
                  id: standard.id,
                  title: standard.family,
                  subtitle: standard.version_label || standard.edition
                })
              }
            />
          ))}
        </div>
      </section>

      {preview ? (
        <div
          className="doc-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`View ${preview.title}`}
          onClick={() => setPreview(null)}
        >
          <div className="doc-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="doc-preview-head">
              <div>
                <strong>{preview.title}</strong>
                {preview.subtitle ? <span>{preview.subtitle}</span> : null}
              </div>
              <div className="doc-actions">
                <a
                  className="btn btn-ghost"
                  href={pdfUrl(preview.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Open tab
                </a>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Close document preview"
                  onClick={() => setPreview(null)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <iframe
              title={preview.title}
              src={`${pdfUrl(preview.id)}#view=FitH`}
              className="doc-preview-frame"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StandardCard({
  standard,
  candidate,
  recommended,
  showDecision,
  chartSelectable,
  checked,
  expanded,
  locked,
  onToggleCheck,
  onToggleExpand,
  onView
}: {
  standard: StandardRecord;
  candidate?: CandidateDecision;
  recommended: boolean;
  showDecision: boolean;
  chartSelectable: boolean;
  checked: boolean;
  expanded: boolean;
  locked: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onView: () => void;
}) {
  const disabled = locked || (!chartSelectable && standard.status !== "indexed");
  const disposition = candidate?.disposition;
  const rejected = Boolean(
    showDecision && (disposition === "rejected" || (!recommended && disposition !== "selected"))
  );
  const isRecommended = Boolean(
    showDecision && (recommended || disposition === "selected")
  );
  const fallbackReject =
    standard.family === "G.722.2"
      ? "Rejected for Claim 1 charting: G.722.2 is an AMR-WB wideband speech codec. The claim is directed to an encoding apparatus that sets chroma QP (0–51) from luma QP plus a picture-level chroma QP offset and quantizes transform data — video coding subject matter, not speech coding. A speech-codec specification cannot supply normative clauses that map those claim elements."
      : standard.family === "TS 136 211"
        ? "Rejected for Claim 1 charting: TS 136 211 defines LTE/E-UTRA physical channels and modulation. It does not specify HEVC/video chroma QP derivation, picture-level chroma QP offsets, or transform-coefficient quantization of the kind claimed. Cellular PHY text is the wrong domain for this claim chart."
        : `Rejected for Claim 1 charting: ${standard.family} is not a suitable primary standard for the claimed video-coding / chroma QP subject matter.`;
  const rationale =
    candidate?.rationale?.trim() ||
    (!showDecision
      ? standard.summary || standard.title
      : rejected
        ? fallbackReject
        : "No rationale returned for this candidate.");
  const proofs = candidate?.proofs || [];
  const badge = showDecision
    ? isRecommended
      ? { className: "badge badge-success", label: "Recommended" }
      : { className: "badge badge-danger", label: "Rejected" }
    : {
        className:
          standard.status === "indexed" ? "badge badge-neutral" : "badge badge-warn",
        label: standard.status
      };

  return (
    <article
      className={`standard-select-card ${checked ? "is-checked" : ""} ${
        isRecommended ? "is-recommended" : ""
      } ${rejected ? "is-rejected" : ""}`}
    >
      <div className="standard-select-card-top">
        <label className="standard-select-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggleCheck}
            aria-label={`Select ${standard.family}`}
          />
          <span>
            <strong>
              {standard.version_label || standard.family}
              {standard.date_label ? (
                <span className="std-date"> {standard.date_label}</span>
              ) : null}
            </strong>
            <span className="std-subtitle">{standard.title}</span>
          </span>
        </label>
        <span className={badge.className}>{badge.label}</span>
      </div>

      {showDecision ? (
        <div className="rationale-block">
          <div className="rationale-label">
            {isRecommended ? "Why recommended" : "Why rejected"}
          </div>
          <p className="standard-rationale">{rationale}</p>
        </div>
      ) : (
        <p className="standard-rationale">{rationale}</p>
      )}

      <div className="standard-card-footer">
        <button type="button" className="source-toggle" onClick={onToggleExpand}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showDecision ? "Source excerpts" : "Document details"}
        </button>
        <div className="doc-actions">
          <button type="button" className="btn btn-ghost" onClick={onView}>
            <Eye size={13} /> View
          </button>
          <a
            className="btn btn-ghost"
            href={pdfUrl(standard.id)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} /> PDF
          </a>
        </div>
      </div>

      {expanded ? (
        <div className="source-excerpts">
          {showDecision ? (
            proofs.length ? (
              proofs.map((proof, index) => (
                <div key={`${standard.id}-proof-${index}`} className="source-excerpt">
                  <div className="source-excerpt-meta">
                    {[proof.section, proof.page != null ? `PDF page ${proof.page}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <blockquote>{proof.quote}</blockquote>
                </div>
              ))
            ) : (
              <div className="empty-compact">No linked source excerpts for this rationale.</div>
            )
          ) : (
            <div className="source-excerpt">
              <div className="source-excerpt-meta">
                {[standard.edition, standard.page_count != null ? `${standard.page_count} pages` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <p className="doc-compact-summary" style={{ margin: 0 }}>
                {standard.summary || standard.title}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
