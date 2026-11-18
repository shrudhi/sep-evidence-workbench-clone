# AI Review model comparison

**Chart run:** `a4d4d0c4-ba50-4dc7-a6b5-8e23a0f2116b` (H.265 Claim 1, 8 rows)  
**Compared:** `gpt-4o-mini` · `gpt-4o` · `o4-mini` (all via OpenAI-compatible `/chat/completions`, `REVIEWER_MODEL`)  
**Mapper left on:** `gpt-4o-mini` (cost)  
**Date:** 2026-11-18  
**Raw outputs:** `docs/model_compare/`

## Method

For each model: set `REVIEWER_MODEL`, restart API, `POST /api/rows/{revision_id}/ai-review` on every latest Claim-1 revision. Compared overall status, Rationale / Mapping label checks, and wall-clock latency.

## Scoreboard (8/8 rows)

| Model | Passed rows | Attention rows | Avg latency | Notes |
|---|---|---|---|---|
| **gpt-4o** | 2 (`1[a]`,`1[h]`) | 6 | ~2.4s | Clearest Partial-gap language; useful fail text on empty No-map rows |
| gpt-4o-mini | 2 | 6 | ~2.6s | Same pass/fail pattern; slightly vaguer rationale wording |
| o4-mini | 2 | 6 | ~2.4s | Same pattern; on `1[d]` more generic “no evidence” vs naming the QP-range gap |

Pass/attention **counts matched** across models because many Attention outcomes are driven by **deterministic** checks (missing clause/printed page, empty No-map evidence), not the LLM.

## Where models differed (LLM checks)

| Row | gpt-4o-mini | gpt-4o | o4-mini |
|---|---|---|---|
| 1[a] Partial | Rationale **pass** | **pass** (best phrasing of apparatus gap) | **pass** |
| 1[d] No map | Rationale **fail** (names luma QP gap) | **fail** (names gap) | Rationale **unverified** (generic) |
| 1[c]/1[e]/1[g] | Rationale/mapping **pass**; Attention from clause/page check | same | same |
| 1[f] No map | Rationale **fail** | **fail** | **fail** |

## Cost impact (measured)

**Method:** Replay the real AI-review system prompt + Claim-1 row payloads against `/chat/completions`, read `usage.prompt_tokens` / `completion_tokens`, multiply by [OpenAI standard list prices](https://developers.openai.com/api/docs/pricing). Raw: `docs/model_compare/cost_measure.json`.

| Model | $/1M in · out | 1[a] Partial (w/ evidence) | 1[d] No-map (empty) | Est. Claim-1 review (5+3 mix) | Per 100 charts |
|---|---|---|---|---|---|
| gpt-4o-mini | $0.15 · $0.60 | **$0.00029** (1291/156 tok) | **$0.00022** (522/227) | **~$0.0021** | **~$0.21** |
| **gpt-4o** | $2.50 · $10.00 | **$0.00428** (1291/105) | **$0.00206** (522/75) | **~$0.028** | **~$2.76** |
| o4-mini† | $1.10 · $4.40 | ~$0.0020 est. | ~$0.0012 est. | **~$0.014** est. | **~$1.37** |

† `o4-mini` now returns `model_not_found` (shut down); $ estimated from measured token counts × published rates.

**Deltas vs keeping mini as reviewer**

| | |
|---|---|
| Cost multiple (reviewer LLM only) | **~13×** |
| Incremental $ / Claim-1 chart | **~$0.025** |
| Incremental $ / 100 charts | **~$2.55** |
| Latency | Neutral (~2.2–3.6s; 4o not slower) |

**Scope note:** Mapper stays on `gpt-4o-mini`. Chart-build spend is unchanged; only the independent review call is upgraded. App `INPUT_COST`/`OUTPUT_COST` env rates are generic and **understate** gpt-4o — tradeoff math uses official model prices, not those env vars.

## Winner / production choice

**Keep `REVIEWER_MODEL=gpt-4o`.**

Reasons:
1. **Quality that pays for itself at this absolute $:** ~$0.025 extra per Claim-1 review pass. Analyst time saved from clearer gap language / fewer vague “unverified” flags dwarfs ~$2.55/100 charts.
2. Stronger Partial-gap phrasing than mini (1[a]: names the *encoding apparatus* coverage hole, not only “complete apparatus” vagueness).
3. Better than `o4-mini` on empty No-map rows (1[d]: mini/4o **fail** and name the luma QP gap; o4-mini stayed generic **unverified**). o4 also costs ~6–7× mini without matching that specificity — and is now unavailable.
4. Latency parity; dual-model split keeps high-volume mapping cheap.

**Tradeoff one-liner for the decision log:** *~13× reviewer unit cost, but +$0.025/chart absolute — justified by sharper HITL-facing critique while mapper cost stays on mini.*

## Config locked

```bash
MAPPER_MODEL=gpt-4o-mini
REVIEWER_MODEL=gpt-4o
```

To re-bench: rerun AI review after changing `REVIEWER_MODEL` and restarting uvicorn; compare files under `docs/model_compare/`. Re-run the cost probe in `docs/model_compare/cost_measure.json` if prices or prompt size change.
