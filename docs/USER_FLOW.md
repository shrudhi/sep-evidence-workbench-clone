# User flow — Agentic SEP Chart Builder (one page)

Happy path for a technical patent analyst on US10063856B2 → H.265 V10 Claim 1, plus two failure branches.

```mermaid
flowchart TD
  start([Open Setup]) --> ingest[Confirm patent + 3 indexed standards]
  ingest --> startRun[Start analysis]
  startRun --> select[Selection agent: recommend / reject with rationales]
  select --> confirm{Analyst confirms target?}
  confirm -->|Yes: H.265| map[Mapping agent builds Claim-1 chart]
  confirm -->|No / change selection| select
  map --> chart[Claim charts: 3-col table]
  chart --> review[AI Review: Passed / Correction / Incomplete / Ambiguous]
  review --> hitl[Analyst: Apply fix / View Evidence / Ask Agent / Edit / Accept / Reject]
  hitl -->|Challenge or Request Revision| remap[Remap revision with note]
  remap --> review
  hitl -->|All decided| export[Word export + run trace]
  export --> done([Conclusion / submit])

  select -.->|F1| wrongStd[Failure 1: analyst rejects recommended standard]
  wrongStd --> alt[Confirm alternate or re-run selection]
  alt --> select

  map -.->|F2| noSection[Failure 2: no matching section for an element]
  noSection --> nomap[Row labeled No map + rationale]
  nomap --> chart
```

## Happy path (compressed)

1. **Setup** — patent US10063856B2; standards G.722.2 / H.265 V10 / TS 36.211 indexed; Start analysis  
2. **Target** — system recommends H.265, rejects audio + LTE with reasons; analyst confirms H.265  
3. **Chart** — each Claim-1 element gets Source · Quote · Screenshot and Full / Partial / No + rationale  
4. **AI Review** — auto after map; four statuses; Correction rows offer one-click Apply recommended fix  
5. **HITL** — Apply fix / View Evidence / Ask Agent / Edit / Request Revision / Rerun; then Accept/Reject  

6. **Export** — draft Word anytime; final after all dispositions; download run trace (`ai_review_completed` events)  

## Failure branch 1 — Analyst rejects the recommended standard

**Trigger:** Analyst disagrees with H.265 (or wants to force a rejected standard for stress-test).  
**System:** Does not hardcode the winner; keeps recommend/reject rationales visible.  
**Analyst:** Unchecks H.265 / selects another standard and confirms — or restarts selection.  
**Outcome:** Chart builds only for confirmed target(s). Wrong-domain charts should trend No map / Partial with clear rejects in Setup history.  
**Guardrail:** Export still requires verifiable cites; no invented clauses to “make” a bad standard look essential.

## Failure branch 2 — No matching section for an element

**Trigger:** Retrieval finds no normative support (or only informative/tangential text).  
**System:** Emits **No map** (or Partial with explicit gaps) — absence is a valid, valuable outcome.  
**Analyst:** Can Challenge (“search again / wrong gap”) or Accept No map.  
**Outcome:** Row stays without fake quote/screenshot pressure; review agent does not require screenshot for pure No-map rows.  
**Guardrail:** Prefer under-mapping to false Full; evals score rationale honesty (C05) and label policy (C06).

## Checkpoints (HITL)

| After | Analyst can |
|---|---|
| Selection | Confirm / change standards |
| Chart + AI Review | View Evidence, Ask Agent, Edit, Request Revision, Rerun, Challenge, Accept, Reject |
| Before final export | Resolve every included row disposition |
