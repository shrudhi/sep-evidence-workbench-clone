export type Screen =
  | "dashboard"
  | "setup"
  | "charts"
  | "conclusion"
  | "evaluations"
  | "settings";

export type Provider = {
  ready: boolean;
  adapter: string;
  base_url: string;
  missing: string[];
};

export type Health = {
  status: string;
  provider: Provider;
  indexed_standard_count: number;
  expected_standard_count: number;
  spans: number;
  embeddings: number;
};

export type PatentClaim = {
  number: number;
  preview: string;
  exact_text: string;
  depends_on: number[];
};

export type PatentInput = {
  id: string;
  identifier: string;
  title: string;
  filename: string;
  document_id: string;
  subject: string;
  description: string;
  claims: PatentClaim[];
  notes?: string;
  claims_source?: string;
  extraction_error?: string;
  summary?: string;
  version_label?: string;
  date_label?: string;
  doc_type_label?: string;
  technology_area?: string;
};

export type StandardRecord = {
  id: string;
  kind: string;
  family: string;
  title: string;
  edition: string;
  filename: string;
  sha256: string | null;
  status: string;
  page_count: number | null;
  suggested?: boolean;
  reason?: string | null;
  summary?: string;
  version_label?: string;
  date_label?: string;
  doc_type_label?: string;
  technology_area?: string;
};

export type Project = {
  id: string;
  name: string;
  workspace_label: string;
  analyst_display_name: string;
  patent_input_id: string | null;
  claim_scope: "all" | "select";
  selected_claim_numbers: number[];
  selected_standard_ids: string[];
  active_run_id: string | null;
  save_status: string;
  updated_at: string;
};

export type AutomationSettings = {
  mode: "review_before_send" | "send_when_checks_pass";
  recipients: string[];
  notify_review_required: boolean;
  notify_analysis_completed: boolean;
  attach_word_bundle: boolean;
  additional_formats: string[];
  require_human_approval: boolean;
  max_repair_attempts: number;
  policy_summary: string;
  using_defaults?: boolean;
  compact_label?: string;
  workspace_defaults?: Partial<AutomationSettings>;
};

export type EmailStatus = {
  configured: boolean;
  status: string;
  status_label: string;
  provider: string;
  message?: string | null;
  from_address?: string | null;
};

export type SetupBundle = {
  project: Project;
  patent: PatentInput | null;
  patent_error: string | null;
  standards: StandardRecord[];
  automation?: AutomationSettings;
  suggestion_disclaimer: string;
  flow?: {
    path?: string;
    claim_scope?: string;
    next_step?: string;
  };
};

export type RunSummary = {
  id: string;
  status: string;
  status_label?: string;
  family?: string;
  edition?: string;
  created_at: string;
  error?: string;
  target_document_id?: string;
  selection_only?: boolean;
  has_target_decision?: boolean;
};

export type EvidenceBlock = {
  evidence_number: number;
  evidence_id: string;
  available: boolean;
  error?: string;
  quote?: string;
  source?: {
    document_id: string;
    family: string;
    title: string;
    edition: string;
    sha256: string | null;
    short_label?: string;
  };
  highlight_available?: boolean;
  highlight_warning?: string | null;
  section_label?: string | null;
  section_ref?: string | null;
  citation_heading?: string;
  page_ordinal?: number;
  printed_label?: string | null;
  page_width?: number | null;
  page_height?: number | null;
  bbox?: number[] | null;
  quote_bbox?: number[] | null;
  quote_line_bboxes?: number[][] | null;
  context_bbox?: number[] | null;
  screenshot_url?: string;
  inspect_url?: string;
  role?: string;
  authorship?: "ai" | "human" | string;
  manual?: boolean;
};

export type ChangeLogEntry = {
  id: string;
  run_id: string;
  element_id: string;
  revision_id: string;
  prior_revision_id?: string | null;
  origin: "ai" | "human" | "ai_fix" | string;
  origin_label?: string;
  actor: string;
  summary: string;
  created_at: string;
  snapshot?: Record<string, unknown>;
};

export type JudgeCriterion = {
  criterion_id: string;
  key?: string;
  label: string;
  short_label?: string;
  mandatory?: boolean;
  required?: boolean;
  status: string;
  score?: number | null;
  earned_points?: number | null;
  max_points?: number;
  finding?: string;
  verification_method?: string;
  requirement?: string | null;
  evidence_establishes?: string | null;
  gap?: string | null;
  analyst_action?: string | null;
  next_action?: string | null;
  evidence_ids?: string[];
  per_evidence?: Record<string, unknown>[];
  requirement_gaps?: Array<{
    requirement: string;
    supporting_evidence?: string | null;
    established_support?: string | null;
    gap?: string | null;
  }>;
  tags?: string[];
  na_justification?: string | null;
  label_recommendation?: string | null;
  details?: Record<string, unknown>;
  source?: string;
};

export type JudgeIssue = {
  criterion_id: string;
  label?: string;
  status?: string;
  issue?: string;
  requirement?: string | null;
  evidence_establishes?: string | null;
  gap?: string | null;
  next_action?: string | null;
  severity?: "critical" | "attention" | string;
  tags?: string[];
  evidence_ids?: string[];
};

export type JudgeRecommendation = {
  criterion_id?: string;
  label?: string;
  recommendation: string;
  severity?: "critical" | "attention" | string;
};

export type JudgeQualityDimension = {
  status?: "Pass" | "Fail" | "Needs review" | string;
  finding?: string;
  score?: number | null;
};

export type JudgeAnalystComment = {
  topic?: string;
  severity?: "critical" | "reconsider" | "note" | string;
  comment?: string;
  analyst_action?: string | null;
  criterion_id?: string | null;
};

export type JudgeConfidence = {
  score: number;
  band?: "high" | "mid" | "low" | string | null;
  rationale?: string;
  completeness?: JudgeQualityDimension | null;
  accuracy?: JudgeQualityDimension | null;
  groundedness?: JudgeQualityDimension | null;
  fact_check?: JudgeQualityDimension | null;
  relevance?: JudgeQualityDimension | null;
};

export type JudgeReport = {
  rubric_version?: string;
  overall_decision?: string;
  rubric_score?: number | null;
  score_label?: string | null;
  earned_points?: number | null;
  max_points?: number | null;
  score_provisional?: boolean;
  assessment_complete?: boolean;
  issue_count?: number;
  critical?: boolean;
  review_status?: "done" | "incomplete" | "in_progress" | string;
  summary?: string;
  next_action?: string;
  what_passed?: string;
  what_needs_attention?: string;
  groundedness?: JudgeQualityDimension | null;
  accuracy?: JudgeQualityDimension | null;
  relevance?: JudgeQualityDimension | null;
  completeness?: JudgeQualityDimension | null;
  fact_check?: JudgeQualityDimension | null;
  confidence?: JudgeConfidence | null;
  analyst_comments?: JudgeAnalystComment[];
  reconsider_items?: string[];
  approval_recommendation?: string | null;
  vision_screenshots_reviewed?: number | null;
  criteria?: JudgeCriterion[];
  issues?: JudgeIssue[];
  recommendations?: JudgeRecommendation[];
  finding_tags?: string[];
  evidence_context_tags?: string[];
  scorecard_note?: string | null;
  element_label?: string;
  element_text?: string;
  standard_family?: string;
  standard_edition?: string;
  disclaimer?: string;
  legacy?: boolean;
  semantic_error?: string | null;
};

export type AiReviewCheck = {
  id: string;
  status: "pass" | "fail" | "unverified" | "na" | string;
  reason: string;
  explanation?: string;
  recommendation?: string | null;
  failure_mode?: string | null;
  evidence_reference?: string | null;
};

export type AiReviewRecommendedFix = {
  summary: string;
  mapping_label?: string | null;
  rationale?: string | null;
  remove_evidence_ids?: string[];
  add_search_hints?: string[];
  change_ids?: string[];
  action?: string;
  recommended_label?: string | null;
};

export type AiReviewRecommendation = {
  id: string;
  action: "add" | "update" | "remove" | string;
  target: string;
  title: string;
  finding?: string;
  detail: string;
  mapping_label?: string | null;
  rationale?: string | null;
  evidence_id?: string | null;
  researched_quote?: string | null;
  researched_section?: string | null;
  researched_page?: string | null;
  applyable?: boolean;
};

/** @deprecated use AiReviewRecommendation */
export type AiReviewSuggestedChange = AiReviewRecommendation;

export type AiReviewSourceReview = {
  evidence_number: number;
  evidence_id?: string | null;
  label: string;
  checks: AiReviewCheck[];
};

export type AiReview = {
  status:
    | "passed"
    | "needs_correction"
    | "incomplete"
    | "ambiguous"
    | "sent_back"
    | "flagged"
    | "attention"
    | "pending"
    | "running"
    | "unavailable"
    | string;
  status_label?: string;
  reason: string;
  explanation?: string;
  ai?: "reviewed" | "not_configured" | "unavailable" | string;
  checks?: AiReviewCheck[];
  claim_checks?: AiReviewCheck[];
  source_reviews?: AiReviewSourceReview[];
  evidence_checks?: AiReviewCheck[];
  recommendations?: AiReviewRecommendation[];
  suggested_changes?: AiReviewRecommendation[];
  current_mapping_label?: string | null;
  recommended_mapping_label?: string | null;
  recommended_fix?: AiReviewRecommendedFix | null;
  review_run_id?: string;
  revision_id?: string;
  element_id?: string;
  element_label?: string;
  run_id?: string;
  reviewed_at?: string;
  schema_version?: number;
  superseded?: boolean;
};

export type ChartRevision = {
  id: string;
  revision_number: number;
  mapping_label: string | null;
  analysis_status?: string;
  analysis_status_label?: string | null;
  evidence_status: string;
  match_strength?: string | null;
  requirement_applicability?: string | null;
  requirement_condition?: string | null;
  rationale: string;
  evidence_ids: string[];
  counterevidence_ids?: string[];
  missing_requirements: string[];
  evidence_blocks?: EvidenceBlock[];
  candidate_blocks?: EvidenceBlock[];
  review_disposition?: string;
  reasons?: string[];
  mapping_review_status?: string;
  mapping_review_incomplete?: boolean;
  analyst_disposition?: string;
  analyst_comment?: string;
  analyst_overrides_judge?: number | boolean | null;
  analyst_judge_override_reason?: string | null;
  integrity?: { pass?: boolean; [key: string]: unknown };
  checks?: Record<string, unknown> | null;
  review_model_name?: string | null;
  review_created_at?: string | null;
  review_id?: string | null;
  judge?: JudgeReport | null;
  ai_review?: AiReview | null;
  authorship?: "ai" | "human" | "ai_fix" | string;
  authorship_label?: string;
  chart_edit?: {
    origin?: string;
    actor?: string;
    manual_evidence?: Record<string, unknown>[];
    evidence_overrides?: Record<string, unknown>;
  } | null;
  change_logs?: ChangeLogEntry[];
  model_name?: string | null;
};

export type ProductEvidenceItem = {
  id: string;
  run_id: string;
  element_id: string;
  product_id: string;
  finding: string;
  evidence_text?: string;
  evidence_source?: string;
  source_link?: string;
  unverified_notes?: string;
  product_name?: string;
  product_model?: string;
  product_software_version?: string;
  element_label?: string;
};

export type AccusedProduct = {
  id: string;
  run_id: string;
  name: string;
  model?: string;
  software_version?: string;
  configuration?: string;
  notes?: string;
};

export type SupplementalDocument = {
  id: string;
  run_id: string;
  title: string;
  kind: string;
  url_or_path?: string;
  notes?: string;
  created_at?: string;
};

export type ChartRow = {
  id: string;
  ordinal: number;
  label: string;
  exact_text: string;
  requirements: { text: string; category: string }[];
  thread_count?: number;
  revisions: ChartRevision[];
  product_evidence?: ProductEvidenceItem[];
};

export type Chart = {
  run: {
    id: string;
    status: string;
    status_label?: string;
    target_document_id: string;
    family?: string;
    edition?: string;
    title?: string;
  };
  rows: ChartRow[];
  accused_products?: AccusedProduct[];
  supplemental_documents?: SupplementalDocument[];
};

export type NoteComment = {
  id: string;
  thread_id: string;
  author_display_name: string;
  body: string;
  created_at: string;
};

export type NoteThread = {
  id: string;
  element_id: string;
  revision_id?: string | null;
  evidence_id?: string | null;
  author_display_name: string;
  body?: string;
  status: string;
  assignee?: string | null;
  assigned_reviewer_name?: string | null;
  created_at: string;
  comments?: NoteComment[];
};
