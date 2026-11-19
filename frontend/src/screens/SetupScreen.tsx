import { useEffect, useMemo, useRef, useState } from "react";
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
import HelpTooltip from "../components/HelpTooltip";
import MultiSelectSearch from "../components/MultiSelectSearch";
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
  onOpenCharts?: () => void;
  selectionStatus?: SelectionStatus;
  onRefresh?: () => Promise<void>;
  onNotice?: (message: string | null) => void;
  hasChartRun?: boolean;
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
  onOpenCharts,
  selectionStatus = null,
  onRefresh,
  onNotice,
  hasChartRun = false
}: Props) {
  const { project, patent, patent_error, standards } = setup;
  const [decision, setDecision] = useState<TargetDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [chartTargets, setChartTargets] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
  const [standardUploadName, setStandardUploadName] = useState<string | null>(null);
  const [standardUploadMessage, setStandardUploadMessage] = useState<string | null>(null);
  const [standardUploading, setStandardUploading] = useState(false);
  const standardFileRef = useRef<HTMLInputElement | null>(null);

  const selectedClaims = project.selected_claim_numbers;
  const selectedStandards = project.selected_standard_ids;
  const claimCount = selectedClaims.length;
  const indexedStandards = standards.filter((item) => item.status === "indexed");
  const selectedIndexed = indexedStandards.filter((item) =>
    selectedStandards.includes(item.id)
  );
  const providerReady = Boolean(health?.provider.ready);
  const awaitingConfirm = selectionStatus?.status === "awaiting_target_confirm";
  const selecting =
    selectionStatus && ["queued", "selecting"].includes(selectionStatus.status);
  const showDecision = Boolean(decision?.candidates?.length);
  const locked = Boolean(selecting || starting || confirming);
  const setupReady = Boolean(patent && claimCount > 0 && selectedIndexed.length > 0);
  const canCreateChart =
    Boolean(
      showDecision &&
        chartTargets.length > 0 &&
        selectionStatus?.runId &&
        onConfirmTargets &&
        (awaitingConfirm || selectionStatus?.status === "complete")
    ) &&
    !confirming &&
    !saving &&
    !selecting &&
    !starting;

  const startBlockedReason = !patent
    ? patent_error || "Patent input is not ready"
    : claimCount < 1
      ? "Select at least one claim"
      : selectedIndexed.length < 1
        ? "Select at least one standard to evaluate"
        : !providerReady
          ? `Model provider not ready (${health?.provider.missing.join(", ") || "check .env"})`
          : null;

  const canGetRecommendations =
    Boolean(setupReady && providerReady) &&
    !starting &&
    !selecting &&
    !confirming &&
    !saving;

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

  const recommendedId = decision?.target_document_id;
  const candidateById = useMemo(() => {
    const map = new Map<string, CandidateDecision>();
    for (const item of decision?.candidates || []) {
      map.set(item.document_id, item);
    }
    return map;
  }, [decision]);

  const orderedStandards = useMemo(() => {
    if (!decision?.candidates?.length) return indexedStandards;
    const order = decision.candidates.map((c) => c.document_id);
    return [...indexedStandards].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  }, [indexedStandards, decision]);

  const screeningLabel = patent
    ? `Evaluating ${selectedIndexed.length || "selected"} standard${
        selectedIndexed.length === 1 ? "" : "s"
      } against ${patent.identifier} Claim ${selectedClaims[0] || 1}…`
    : "Evaluating selected standards…";

  useEffect(() => {
    if (patent?.id) setSelectedPatentOption(patent.id);
  }, [patent?.id]);

  // Seed the pool with all indexed standards once when none are selected yet.
  // Analyst can narrow the set before confirming Get recommendations.
  useEffect(() => {
    if (!indexedStandards.length || selectedStandards.length > 0) return;
    void onPatch({ selected_standard_ids: indexedStandards.map((s) => s.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed empty pool only
  }, [indexedStandards.length, selectedStandards.length]);

  // Load decision for the current selection run.
  useEffect(() => {
    if (!selectionStatus?.runId) {
      setDecision(null);
      return;
    }
    if (["queued", "selecting"].includes(selectionStatus.status)) {
      setDecisionLoading(true);
      setDecision(null);
      return;
    }
    let cancelled = false;
    setDecisionLoading(true);
    api<RunDetail>(`/api/runs/${selectionStatus.runId}`)
      .then((detail) => {
        if (cancelled) return;
        const next = detail.target_decision || null;
        setDecision(next);
        const recommended = next?.target_document_id;
        const defaults =
          recommended && (next?.candidates || []).some((c) => c.document_id === recommended)
            ? [recommended]
            : recommended
              ? [recommended]
              : [];
        setChartTargets(defaults);
      })
      .catch(() => {
        if (!cancelled) setDecision(null);
      })
      .finally(() => {
        if (!cancelled) setDecisionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectionStatus?.runId, selectionStatus?.status]);

  const toggleClaim = async (number: number) => {
    const next = selectedClaims.includes(number)
      ? selectedClaims.filter((item) => item !== number)
      : [...selectedClaims, number].sort((a, b) => a - b);
    await onPatch({ claim_scope: "select", selected_claim_numbers: next });
  };

  const setSelectedStandards = async (ids: string[]) => {
    await onPatch({ selected_standard_ids: ids });
  };

  const selectAllStandards = async () => {
    await setSelectedStandards(indexedStandards.map((s) => s.id));
  };

  const clearStandards = async () => {
    await setSelectedStandards([]);
  };

  const standardOptions = useMemo(
    () =>
      indexedStandards.map((standard) => ({
        id: standard.id,
        label: standard.version_label || standard.family,
        description: [standard.title, standard.date_label, standard.edition]
          .filter(Boolean)
          .join(" · "),
        searchText: [
          standard.family,
          standard.version_label,
          standard.title,
          standard.edition,
          standard.filename,
          standard.technology_area
        ]
          .filter(Boolean)
          .join(" ")
      })),
    [indexedStandards]
  );

  const toggleChartTarget = (id: string) => {
    setChartTargets((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const handleGetRecommendations = async () => {
    if (!canGetRecommendations) return;
    setDecision(null);
    setChartTargets([]);
    await onStart();
  };

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
          setDecision(null);
          setChartTargets([]);
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
          onNotice?.(
            `${result.message} Added to the screening pool — click Get recommendations to evaluate.`
          );
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

  const handleCreateChart = () => {
    if (!selectionStatus?.runId || !chartTargets.length || !onConfirmTargets) return;
    void onConfirmTargets(selectionStatus.runId, chartTargets);
  };

  return (
    <section className="setup-page matter-setup">
      <div className="page-header-compact">
        <div>
          <h1 className="page-title-compact">Setup</h1>
          <p className="page-sub-compact">
            Choose the patent, select standards to evaluate, review accepted or rejected
            recommendations, then create a claim chart for Claim 1.
          </p>
        </div>
      </div>

      {startBlockedReason && !selecting && !showDecision ? (
        <div className="inline-alert">{startBlockedReason}</div>
      ) : null}
      {selecting || starting ? (
        <div className="inline-alert info matter-screening-banner">
          <LoaderCircle size={14} className="spin" /> {screeningLabel}
        </div>
      ) : null}

      {/* Patent */}
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
              Select existing
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
                    onChange={(e) => setSelectedPatentOption(e.target.value)}
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
                    {claimCount ? `Claim ${selectedClaims.join(", ")} selected` : "None selected"}
                  </span>
                </button>
                {claimsOpen ? (
                  <div className="claims-check-list">
                    {patent.claims.map((claim) => (
                      <label key={claim.number} className="claim-check-row">
                        <input
                          type="checkbox"
                          checked={selectedClaims.includes(claim.number)}
                          disabled={locked}
                          onChange={() => void toggleClaim(claim.number)}
                        />
                        <span>
                          <strong>Claim {claim.number}</strong>
                          <span className="doc-sub">{claim.preview || claim.exact_text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          )
        ) : (
          <label className="upload-dropzone">
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={locked}
              onChange={(e) => handlePatentUpload(e.target.files?.[0] || null)}
            />
            <FileUp size={20} />
            <strong>
              {patentParseState === "parsing"
                ? "Uploading…"
                : "Drop patent PDF here or Browse"}
            </strong>
            <span className="doc-sub">
              {patentParseState === "parsing"
                ? `Uploading ${patentUploadName}…`
                : patentParseState === "parsed"
                  ? `Matched ${patentUploadName} — select standards below to evaluate`
                  : patentParseState === "error"
                    ? patentUploadMessage || "Upload retained, but claim parsing failed"
                    : "PDF only · matching SHA-256 binds the assessment patent"}
            </span>
          </label>
        )}
      </section>

      {/* Select standards — before recommendations */}
      {patent ? (
        <section className="ui-card matter-card matter-standards-section">
          <div className="matter-card-head">
            <div>
              <h2>Select standards</h2>
              <span className="meta-quiet">
                Choose which indexed standards the recommendation engine should evaluate. Each
                selected option is returned as accepted or rejected.
              </span>
            </div>
            <div className="matter-card-actions">
              <input
                ref={standardFileRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                disabled={locked || standardUploading}
                onChange={(e) => {
                  handleStandardUpload(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={locked || !indexedStandards.length || selectedIndexed.length === indexedStandards.length}
                onClick={() => void selectAllStandards()}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={locked || selectedIndexed.length === 0}
                onClick={() => void clearStandards()}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={locked || standardUploading}
                title="Upload another standard PDF into the screening pool"
                onClick={() => standardFileRef.current?.click()}
              >
                {standardUploading ? (
                  <>
                    <LoaderCircle size={14} className="spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Upload standard
                  </>
                )}
              </button>
            </div>
          </div>

          {standardUploadMessage ? (
            <p className="doc-sub" style={{ marginTop: 0 }}>
              {standardUploadName ? `${standardUploadName}: ` : ""}
              {standardUploadMessage}
            </p>
          ) : null}

          {!indexedStandards.length ? (
            <div className="empty-compact">
              No indexed standards available. Upload a standard PDF to add one.
            </div>
          ) : (
            <MultiSelectSearch
              label="Standards to evaluate"
              options={standardOptions}
              value={selectedStandards.filter((id) =>
                indexedStandards.some((standard) => standard.id === id)
              )}
              onChange={(next) => void setSelectedStandards(next)}
              disabled={locked}
              placeholder="Search and select standards…"
              searchPlaceholder="Search by family, title, or edition…"
              emptyLabel="No indexed standards available"
              noMatchesLabel="No standards match that search"
            />
          )}

          <div
            className="matter-reco-footer"
            style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}
          >
            <button
              type="button"
              className="btn btn-action"
              disabled={!canGetRecommendations}
              title={
                canGetRecommendations
                  ? "Evaluate each selected standard and return accepted or rejected"
                  : startBlockedReason || "Select standards to evaluate"
              }
              onClick={() => void handleGetRecommendations()}
            >
              {starting || selecting ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Evaluating standards…
                </>
              ) : showDecision ? (
                "Re-screen selected"
              ) : (
                "Get recommendations"
              )}
            </button>
            <HelpTooltip text="Runs the recommendation engine on every checked standard. Each option comes back accepted or rejected with a rationale before you create a chart." />
            <span className="doc-sub">
              {selectedIndexed.length
                ? `${selectedIndexed.length} standard${selectedIndexed.length === 1 ? "" : "s"} selected`
                : "No standards selected"}
            </span>
            {startBlockedReason && patent ? (
              <span className="doc-sub" style={{ flexBasis: "100%" }}>
                {startBlockedReason}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Recommendations — after user confirms screening */}
      {patent && (showDecision || selecting || starting || decisionLoading) ? (
        <section className="ui-card matter-card matter-reco-section">
          <div className="matter-reco-head">
            <div>
              <h2>Recommendations</h2>
              <span className="meta-quiet">
                {showDecision
                  ? `${chartTargets.length} selected to chart · Accepted is pre-selected; you can also include a rejected standard`
                  : screeningLabel}
              </span>
            </div>
          </div>

          {showDecision ? (
            <div className="standard-card-grid matter-reco-grid">
              {orderedStandards
                .filter((standard) => candidateById.has(standard.id))
                .map((standard) => (
                  <StandardCard
                    key={standard.id}
                    standard={standard}
                    candidate={candidateById.get(standard.id)}
                    recommended={standard.id === recommendedId}
                    checked={chartTargets.includes(standard.id)}
                    expanded={Boolean(expanded[standard.id])}
                    locked={locked}
                    onToggleCheck={() => toggleChartTarget(standard.id)}
                    onToggleExpand={() =>
                      setExpanded((current) => ({
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
          ) : (
            <div className="empty-compact" style={{ marginTop: 8 }}>
              <LoaderCircle size={14} className="spin" /> Evaluating each selected standard…
            </div>
          )}

          <div className="matter-reco-footer" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-action"
              disabled={!canCreateChart || confirming}
              title={
                canCreateChart
                  ? "Confirm the selected standard(s) and start mapping Claim 1"
                  : "Wait for recommendations, then select at least one standard to chart"
              }
              onClick={handleCreateChart}
            >
              {confirming ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Creating chart…
                </>
              ) : (
                "Create chart"
              )}
            </button>
            <HelpTooltip text="Locks in the selected standard(s) and starts AI mapping for Claim 1. You can review every element before exporting." />
            {hasChartRun && onOpenCharts ? (
              <button
                type="button"
                className="btn btn-ghost"
                title="Open a chart that is already in progress or complete"
                onClick={() => onOpenCharts()}
              >
                Open existing chart
              </button>
            ) : null}
            {!canCreateChart && showDecision ? (
              <span className="doc-sub" style={{ flexBasis: "100%" }}>
                Select at least one accepted or rejected standard, then create the chart.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

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
  checked: boolean;
  expanded: boolean;
  locked: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onView: () => void;
}) {
  const disposition = candidate?.disposition;
  const rejected = Boolean(
    disposition === "rejected" || (!recommended && disposition !== "selected")
  );
  const isRecommended = Boolean(recommended || disposition === "selected");
  const fallbackReject =
    standard.family === "G.722.2"
      ? "Rejected for Claim 1 charting: G.722.2 is an AMR-WB wideband speech codec. The claim is directed to video chroma QP / transform quantization — not speech coding."
      : standard.family === "TS 136 211"
        ? "Rejected for Claim 1 charting: TS 136 211 defines LTE/E-UTRA physical channels — wrong domain for HEVC chroma QP derivation."
        : `Rejected for Claim 1 charting: ${standard.family} is not a suitable primary standard for this claim.`;
  const rationale =
    candidate?.rationale?.trim() ||
    (rejected ? fallbackReject : "No rationale returned for this candidate.");
  const clipped = clampLines(rationale, 3);
  const badge = isRecommended
    ? { className: "badge badge-success", label: "Accepted" }
    : { className: "badge badge-danger", label: "Rejected" };

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
            disabled={locked}
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

      <div className="rationale-block">
        <div className="rationale-label">
          {isRecommended ? "Why accepted" : "Why rejected"}
        </div>
        <p className={`standard-rationale ${expanded ? "is-expanded" : "is-clamped"}`}>
          {expanded ? clipped.full : clipped.short}
        </p>
      </div>

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
          >
            PDF
          </a>
        </div>
      </div>
    </article>
  );
}
