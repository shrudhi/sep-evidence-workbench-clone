import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  LoaderCircle,
  Plus,
  X
} from "lucide-react";
import { api, apiForm } from "../api";
import type { Health, PatentInput, SetupBundle, StandardRecord } from "../types";

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
  kind: "pdf" | "patent-claims";
  patent?: PatentInput;
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
  onRefresh?: () => Promise<void>;
  onNotice?: (message: string | null) => void;
};

function pdfUrl(documentId: string) {
  return `/api/documents/${documentId}/pdf`;
}

function clampLines(text: string, lines = 3): { short: string; full: string; needsToggle: boolean } {
  const full = (text || "").trim();
  const parts = full.split(/(?<=\.)\s+/).filter(Boolean);
  if (parts.length <= lines && full.length < 280) {
    return { short: full, full, needsToggle: false };
  }
  const short = parts.slice(0, lines).join(" ");
  return {
    short: short || full.slice(0, 260) + "…",
    full,
    needsToggle: full.length > short.length
  };
}

const DEMO_PATENTS = [
  {
    id: "demo-us10111222",
    label: "US10111222B2 — Adaptive Bitrate Encoding Controller (Granted 12 Jan 2019)",
    demo: true
  },
  {
    id: "demo-us10998877",
    label: "US10998877B2 — Motion Vector Prediction for Video Blocks (Granted 04 Mar 2021)",
    demo: true
  }
];

export default function SetupScreen({
  setup,
  health,
  saving,
  starting,
  confirming = false,
  onPatch,
  onStart,
  onConfirmTargets,
  selectionStatus = null,
  onRefresh,
  onNotice
}: Props) {
  const { project, patent, patent_error, standards } = setup;
  const [decision, setDecision] = useState<TargetDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [chartTargets, setChartTargets] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rationaleOpen, setRationaleOpen] = useState<Record<string, boolean>>({});
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [patentMode, setPatentMode] = useState<"existing" | "upload">("existing");
  const [selectedPatentOption, setSelectedPatentOption] = useState(
    patent?.id || patent?.identifier || ""
  );
  const [patentUploadName, setPatentUploadName] = useState<string | null>(null);
  const [patentParseState, setPatentParseState] = useState<
    "idle" | "parsing" | "parsed" | "error"
  >("idle");
  const [patentUploadMessage, setPatentUploadMessage] = useState<string | null>(null);
  const [standardUploadOpen, setStandardUploadOpen] = useState(false);
  const [standardUploadName, setStandardUploadName] = useState<string | null>(null);
  const [standardUploadMessage, setStandardUploadMessage] = useState<string | null>(null);
  const [standardUploading, setStandardUploading] = useState(false);

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
        selectionStatus?.status === "analyst_review" ||
        selectionStatus?.status === "mapping" ||
        selectionStatus?.status === "reviewing"
    );
  const locked = Boolean(awaitingConfirm || selecting || starting || confirming);

  useEffect(() => {
    if (patent?.id) setSelectedPatentOption(patent.id);
  }, [patent?.id]);

  useEffect(() => {
    if (!selectionStatus?.runId) {
      setDecision(null);
      return;
    }
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
          // Keep recommendation cards collapsed by default (short rationale only).
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
  const canRecommend =
    setupReady && !starting && !saving && providerReady && !awaitingConfirm && !selecting;
  const canContinue =
    Boolean(awaitingConfirm && decision && chartTargets.length > 0 && onConfirmTargets) &&
    !confirming &&
    !saving;

  const startBlockedReason = !patent
    ? patent_error || "Patent input is not ready"
    : claimCount < 1
      ? "Select at least one claim"
      : selectedIndexed.length < 1
        ? "Select at least one candidate standard"
        : !providerReady
          ? `Model provider not ready (${health?.provider.missing.join(", ") || "check .env"})`
          : null;

  const patentOptions = useMemo(() => {
    const primary = patent
      ? {
          id: patent.id,
          label: `${patent.identifier} — ${patent.title}${
            patent.date_label ? ` (${patent.date_label})` : ""
          }`,
          demo: false
        }
      : null;
    return primary ? [primary, ...DEMO_PATENTS] : DEMO_PATENTS;
  }, [patent]);

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

  const screeningLabel = patent
    ? `Screening ${selectedIndexed.length || selectedStandards.length || standards.length} standards against ${patent.identifier} Claim ${selectedClaims[0] || 1}…`
    : "Screening standards…";

  const handlePatentUpload = (file: File | null) => {
    if (!file) return;
    setPatentUploadName(file.name);
    setPatentParseState("parsing");
    setPatentUploadMessage(null);
    const form = new FormData();
    form.append("file", file);
    void apiForm<{
      status: string;
      message: string;
      matched_document_id?: string | null;
      claim_count?: number;
    }>(`/api/projects/${encodeURIComponent(project.id)}/patent-upload`, form)
      .then(async (result) => {
        setPatentUploadMessage(result.message);
        onNotice?.(result.message);
        if (result.status === "matched") {
          setPatentParseState("parsed");
          setPatentMode("existing");
          await onRefresh?.();
        } else {
          setPatentParseState("error");
        }
      })
      .catch((error) => {
        setPatentParseState("error");
        const message = error instanceof Error ? error.message : String(error);
        setPatentUploadMessage(message);
        onNotice?.(message);
      });
  };

  const handleStandardUpload = (file: File | null) => {
    if (!file) return;
    setStandardUploadName(file.name);
    setStandardUploading(true);
    setStandardUploadMessage(null);
    const form = new FormData();
    form.append("file", file);
    void apiForm<{
      status: string;
      message: string;
      document_id?: string;
      indexed?: boolean;
    }>("/api/documents/standard-upload", form)
      .then(async (result) => {
        setStandardUploadMessage(result.message);
        onNotice?.(result.message);
        if (result.document_id && result.indexed) {
          const next = Array.from(new Set([...selectedStandards, result.document_id]));
          await onPatch({ selected_standard_ids: next });
        }
        await onRefresh?.();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setStandardUploadMessage(message);
        onNotice?.(message);
      })
      .finally(() => setStandardUploading(false));
  };

  return (
    <section className="setup-page matter-setup">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title-compact">Matter setup</h1>
          <p className="page-sub-compact">
            Select a patent and candidate standards, then run AI recommendation before charting.
          </p>
        </div>
        <div className="page-header-actions">
          {canContinue ? (
            <button
              className="btn btn-action"
              disabled={!canContinue}
              title="Confirm the selected target and start claim-chart preparation"
              onClick={() =>
                selectionStatus && onConfirmTargets?.(selectionStatus.runId, chartTargets)
              }
            >
              {confirming ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Preparing…
                </>
              ) : (
                "Start Chart Preparation →"
              )}
            </button>
          ) : null}
        </div>
      </div>

      {startBlockedReason && !awaitingConfirm && !selecting ? (
        <div className="inline-alert">{startBlockedReason}</div>
      ) : null}
      {selecting || (starting && decisionLoading) ? (
        <div className="inline-alert info matter-screening-banner">
          <LoaderCircle size={14} className="spin" /> {screeningLabel}
        </div>
      ) : null}

      {/* 1 — Patent card */}
      <section className="ui-card matter-card">
        <div className="matter-card-head">
          <h2>Patent</h2>
          <div className="seg-toggle" role="group" aria-label="Patent source">
            <button
              type="button"
              className={patentMode === "existing" ? "active" : ""}
              disabled={locked}
              onClick={() => setPatentMode("existing")}
            >
              Select Existing
            </button>
            <button
              type="button"
              className={patentMode === "upload" ? "active" : ""}
              disabled={locked}
              onClick={() => setPatentMode("upload")}
            >
              Upload PDF
            </button>
          </div>
        </div>

        {patentMode === "existing" ? (
          !patent ? (
            <div className="inline-alert">{patent_error || "Patent unavailable"}</div>
          ) : (
            <>
              <div className="matter-patent-row">
                <label className="matter-select-label">
                  <span className="sr-only">Patent</span>
                  <select
                    className="matter-select"
                    value={selectedPatentOption}
                    disabled={locked}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedPatentOption(value);
                      if (DEMO_PATENTS.some((p) => p.id === value)) {
                        /* demo options are display-only */
                      }
                    }}
                  >
                    {patentOptions.map((opt) => (
                      <option key={opt.id} value={opt.id} disabled={opt.demo}>
                        {opt.label}
                        {opt.demo ? " (sample)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="matter-inline-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title="Preview patent abstract and claims"
                    onClick={() =>
                      setPreview({
                        id: patent.document_id || patent.id,
                        title: patent.identifier,
                        subtitle: patent.title,
                        kind: "patent-claims",
                        patent
                      })
                    }
                  >
                    <Eye size={14} /> Preview
                  </button>
                  <a
                    className="btn btn-ghost"
                    href={pdfUrl(patent.document_id || patent.id)}
                    target="_blank"
                    rel="noreferrer"
                    title="Download patent PDF"
                  >
                    <Download size={14} /> Download PDF
                  </a>
                </div>
              </div>

              <p className="doc-compact-summary clamp-2" style={{ marginTop: 10 }}>
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
                  <span className="badge badge-neutral">
                    {claimCount === 1 && selectedClaims[0] === 1
                      ? "Claim 1 selected"
                      : `${claimCount} selected`}
                  </span>
                </button>
                {claimsOpen ? (
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
                ) : null}
              </div>
            </>
          )
        ) : (
          <label className="matter-dropzone">
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={locked}
              onChange={(e) => handlePatentUpload(e.target.files?.[0] || null)}
            />
            <FileUp size={20} />
            <strong>Drop patent PDF here or Browse</strong>
            <span className="doc-sub">
              {patentParseState === "parsing"
                ? `Uploading ${patentUploadName}…`
                : patentParseState === "parsed"
                  ? `Matched ${patentUploadName} — bound prepared patent-input for charting`
                  : patentParseState === "error"
                    ? patentUploadMessage ||
                      "Upload retained, but claim parsing requires a prepared patent-input"
                    : "PDF only · SHA-256 match binds the assessment patent; other PDFs are retained without invented claims"}
            </span>
            {patentUploadMessage && patentParseState !== "parsing" ? (
              <span className="doc-sub" style={{ display: "block", marginTop: 6 }}>
                {patentUploadMessage}
              </span>
            ) : null}
          </label>
        )}
      </section>

      {/* 2 — Candidate standards */}
      <section className="ui-card matter-card">
        <div className="matter-card-head">
          <h2>Candidate Standards</h2>
          <div className="matter-card-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={locked}
              title="Upload another standard PDF into the candidate pool"
              onClick={() => setStandardUploadOpen(true)}
            >
              <Plus size={14} /> Upload Standard
            </button>
          </div>
        </div>

        <div className="matter-candidate-list">
          {standards.map((standard) => {
            const checked = selectedStandards.includes(standard.id);
            return (
              <div key={standard.id} className={`matter-candidate-row ${checked ? "is-on" : ""}`}>
                <label className="matter-candidate-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked || standard.status !== "indexed"}
                    onChange={() => toggleStandardForAnalysis(standard.id)}
                  />
                  <span>
                    <strong>
                      {standard.version_label || standard.family}
                      {standard.date_label ? ` (${standard.date_label})` : ""}
                    </strong>
                    <span className="doc-sub">{standard.edition || standard.title}</span>
                  </span>
                </label>
                <button
                  type="button"
                  className="linkish"
                  title="View standard document"
                  onClick={() =>
                    setPreview({
                      id: standard.id,
                      title: standard.family,
                      subtitle: standard.version_label || standard.edition,
                      kind: "pdf"
                    })
                  }
                >
                  View
                </button>
              </div>
            );
          })}
        </div>

        {standardUploadOpen ? (
          <div className="matter-inline-upload">
            <label className="matter-dropzone compact">
              <input
                type="file"
                accept=".pdf,application/pdf"
                disabled={locked || standardUploading}
                onChange={(e) => handleStandardUpload(e.target.files?.[0] || null)}
              />
              <strong>
                {standardUploading ? "Uploading…" : "Drop standard PDF or Browse"}
              </strong>
              <span className="doc-sub">
                {standardUploadMessage
                  ? standardUploadMessage
                  : standardUploadName
                    ? `${standardUploadName} uploaded — matching SHA-256 reuses indexed standards; others register as pending`
                    : "Matching SHA-256 reuses an indexed standard; other PDFs register as pending (not searchable until ingest)"}
              </span>
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => setStandardUploadOpen(false)}
            >
              Done
            </button>
          </div>
        ) : null}

        <div className="matter-recommend-row">
          <button
            type="button"
            className="btn btn-action"
            disabled={!canRecommend}
            title="Run AI screening to recommend or reject each selected standard"
            onClick={() => void onStart()}
          >
            {starting || selecting ? (
              <>
                <LoaderCircle size={14} className="spin" /> Screening…
              </>
            ) : (
              "Recommend Standard"
            )}
          </button>
          <span className="doc-sub">
            Screens selected candidates against the patent claim.
          </span>
        </div>

        {/* 3 — Recommendation output */}
        {showDecision ? (
          <div className="matter-reco-block">
            <div className="matter-reco-head">
              <div>
                <h3>AI recommendation</h3>
                <span className="meta-quiet">
                  {chartTargets.length} selected to proceed · override checkboxes if needed
                </span>
              </div>
              {canContinue ? (
                <button
                  type="button"
                  className="btn btn-action"
                  disabled={!canContinue}
                  title="Confirm selected target(s) and start claim-chart preparation"
                  onClick={() =>
                    selectionStatus && onConfirmTargets?.(selectionStatus.runId, chartTargets)
                  }
                >
                  {confirming ? (
                    <>
                      <LoaderCircle size={14} className="spin" /> Preparing…
                    </>
                  ) : (
                    "Start Chart Preparation →"
                  )}
                </button>
              ) : null}
            </div>
            <div className="standard-card-grid matter-reco-grid">
              {orderedStandards.map((standard) => (
                <StandardCard
                  key={standard.id}
                  standard={standard}
                  candidate={candidateById.get(standard.id)}
                  recommended={standard.id === recommendedId}
                  showDecision
                  chartSelectable={Boolean(awaitingConfirm)}
                  checked={
                    awaitingConfirm
                      ? chartTargets.includes(standard.id)
                      : selectedStandards.includes(standard.id)
                  }
                  expanded={Boolean(expanded[standard.id])}
                  rationaleOpen={Boolean(rationaleOpen[standard.id])}
                  locked={locked && !awaitingConfirm}
                  onToggleCheck={() =>
                    awaitingConfirm
                      ? toggleChartTarget(standard.id)
                      : toggleStandardForAnalysis(standard.id)
                  }
                  onToggleExpand={() => toggleExpanded(standard.id)}
                  onToggleRationale={() =>
                    setRationaleOpen((current) => ({
                      ...current,
                      [standard.id]: !current[standard.id]
                    }))
                  }
                  onView={() =>
                    setPreview({
                      id: standard.id,
                      title: standard.family,
                      subtitle: standard.version_label || standard.edition,
                      kind: "pdf"
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : decisionLoading && !selecting ? (
          <div className="empty-compact" style={{ marginTop: 12 }}>
            Loading recommendation cards…
          </div>
        ) : null}
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
                {preview.kind === "pdf" || preview.patent ? (
                  <a
                    className="btn btn-ghost"
                    href={pdfUrl(preview.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} /> Open PDF
                  </a>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Close preview"
                  onClick={() => setPreview(null)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {preview.kind === "patent-claims" && preview.patent ? (
              <div className="matter-patent-preview">
                <h4>Abstract / summary</h4>
                <p>{preview.patent.summary || preview.patent.description}</p>
                <h4>Claims</h4>
                <ul>
                  {preview.patent.claims.map((claim) => (
                    <li key={claim.number}>
                      <strong>Claim {claim.number}</strong>
                      <span>{claim.exact_text || claim.preview}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <iframe
                title={preview.title}
                src={`${pdfUrl(preview.id)}#view=FitH`}
                className="doc-preview-frame"
              />
            )}
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
  rationaleOpen,
  locked,
  onToggleCheck,
  onToggleExpand,
  onToggleRationale,
  onView
}: {
  standard: StandardRecord;
  candidate?: CandidateDecision;
  recommended: boolean;
  showDecision: boolean;
  chartSelectable: boolean;
  checked: boolean;
  expanded: boolean;
  rationaleOpen: boolean;
  locked: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onToggleRationale: () => void;
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
  const clipped = clampLines(rationale, 3);
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
      className={`standard-select-card matter-reco-card ${checked ? "is-checked" : ""} ${
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
          <p className={`standard-rationale ${expanded ? "is-expanded" : "is-clamped"}`}>
            {expanded ? clipped.full : clipped.short}
          </p>
        </div>
      ) : (
        <p className="standard-rationale is-clamped">{clipped.short}</p>
      )}

      <div className="standard-card-footer">
        <button type="button" className="source-toggle" onClick={onToggleExpand}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? "Collapse details" : "Expand details"}
        </button>
        <div className="doc-actions">
          <button type="button" className="btn btn-ghost" onClick={onView} title="View document">
            <Eye size={13} /> View
          </button>
          <a
            className="btn btn-ghost"
            href={pdfUrl(standard.id)}
            target="_blank"
            rel="noreferrer"
            title="Open PDF"
          >
            <ExternalLink size={13} /> PDF
          </a>
        </div>
      </div>

      {expanded ? (
        <div className="source-excerpts">
          {proofs.length ? (
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
          )}
        </div>
      ) : null}
    </article>
  );
}
