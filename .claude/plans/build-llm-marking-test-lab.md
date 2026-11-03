# Feature: LLM Client Test Lab (greenfield build)

Validate documentation and task sanity before implementing. Use the vocabulary in `GLOSSARY.md` exactly, in code as well as in the UI.

## Feature Description

A single-user Next.js app on localhost that tests how well LLM Models mark exam Answers. You define a Harness, try it in a Trial, then run an Experiment across several Models. A worker makes the Calls, submits Results to Marking Lab, closes each Run and saves its Score. The app keeps a local record of every Call and compares Models side by side.

## User Story

As the person evaluating LLM models for exam marking
I want to run the same Harness across different Models and compare their Scores, cost and latency
So that I can choose a Model and prompt from evidence, and inspect why a Model disagreed with the Reference Marks

## Problem Statement

Marking Lab scores Runs but expects a harness to do the work: fetching data, calling Models, parsing replies, submitting Results. Its API can't return submitted Results and has no place for latency, tokens, cost or failed Calls. Results are also permanent, so a parser bug that reaches it can't be undone.

## Solution Statement

A Next.js UI and a separate Node worker share one SQLite database. The UI writes intent to the database and the worker carries it out. Results stay local until a Model finishes, and a Trial exposes parser problems before anything is submitted. Marking Lab remains the only source of Scores (`docs/adr/0001-marking-lab-scores-local-call-record.md`).

## Out of Scope / Non-Goals

- Not included: hidden Runs, custom answers, examiner marking (`/results/{id}/review`)
- Not included: several Harnesses in one Experiment (run two Experiments instead)
- Not included: dataset browser, login, deployment, native provider SDKs
- Not included: charts other than the error histogram
- Not included: installing Ollama or any local LLM server
- Never: calculating agreement locally, or storing API keys in SQLite or exports

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: New Next.js app, new worker, SQLite database
**Dependencies**: Marking Lab (`http://102.202.45.215:3000/api`), OpenAI-compatible endpoints

## Related Work

**Implements**: the design settled in the grilling session of 2026-11-03
**Back-references**: `GLOSSARY.md`, `docs/adr/0001-marking-lab-scores-local-call-record.md`
**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Files to read before implementing

- `GLOSSARY.md` - Why: required names for every concept
- `docs/adr/0001-marking-lab-scores-local-call-record.md` - Why: the boundary between local data and Marking Lab

There is no existing code, so there are no local patterns to mirror. The conventions below set them.

### Package versions (checked with `npm view` on 2026-11-03)

next 16.4.5, react 19.3.1, typescript 7.0.2, better-sqlite3 13.0.3, drizzle-orm 0.45.4, drizzle-kit 0.31.11, openai 7.48.0, zod 4.6.7, tailwindcss 4.3.4, shadcn 4.23.0, vitest 5.1.0, tsx 4.23.15, concurrently 10.0.6.

Environment: Node 22.22.1, npm 9.2.0, with make, g++ and python3 available for the native SQLite build. pnpm is not installed.

### Documentation

- [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) - Why: `better-sqlite3` must not be bundled
- [Drizzle with SQLite](https://orm.drizzle.team/docs/get-started-sqlite) - Why: schema and migrations
- [shadcn/ui for Next.js](https://ui.shadcn.com/docs/installation/next) - Why: UI setup
- [OpenRouter API docs](https://openrouter.ai/docs) - Why: `/models` pricing and per-request usage cost

### Marking Lab contract (from the OpenAPI spec v0.2.0)

Auth is `Authorization: Bearer msk_…`. Errors are `{ error: string, details?: string[] }`.

| Call | Use |
|---|---|
| `GET /dataset/version` | Current version and counts |
| `GET /questions/{id}?version=` or `?runId=` | `{ datasetVersion, question }` |
| `GET /questions/{id}/scheme?version=` or `?runId=` | `{ datasetVersion, scheme }` |
| `GET /answers?source=&page=&pageSize=&runId=` or `&version=` | Paged, `pageSize` max 500 |
| `POST /runs` | Returns 201 `{ runId, datasetVersion, run }` |
| `GET /runs/{id}` | `{ run }`, where `run.results` is the stored count |
| `POST /runs/{id}/results` | Batch stored or refused together, returns 201 `{ stored, resultIds, … }` |
| `POST /runs/{id}/close` | 409 if already closed |
| `GET /runs/{id}/score` | Score; breakdowns only for closed open Runs |
| `POST /runs/{id}/withdraw` | `{ reason }`, 403 if not a maintainer |

**`RunStart`** requires `harnessName`, `gitCommit`, `model`, `usedMarkingScheme`. Also send `dirty`, `modelSettings`, `promptTemplate`, `split: "open"`, `extra`, `datasetVersion`.

**`Question`**: `id, topic, syllabusRef, tier, ao, totalMarks, markedMarks, stem, lines[]`. Each Line has `label, text, marks, answerLineUnit (nullable), marked`.

**`Scheme`**: `markedMarks, lines[]`. Each has `label, marks, points[]`, and each point has `code, type, marks, text`.

**`Answer`**: `id, questionId, source, split, tags[], lines` (a map of label to text).

**`ResultSubmit`** requires `prompt` and `rawOutput`. Also `answerId`, `datasetVersion`, `repeat`, `lines` (a map of label to `{ marks?: int[], total: int }`), `reason`, `parseFailed`. Leave out `lines` when `parseFailed` is true.

**`Score`**: `overall`, `clearCases`, `greyCases`, `repeatConsistency`, `errorHistogram`, `byQuestion`, `byLine`, `bySyllabusRef`, `byTag`, `bySource`, `disagreements`, plus `answersMarked`, `answersInSplit`, `closed`, `withdrawn`, `note`. `GroupStats` numbers are nullable. The `disagreements` item shape isn't specified, so parse it loosely.

### New Files to Create

```
.gitignore, .env.example, next.config.ts, drizzle.config.ts, vitest.config.ts
src/lib/db/{schema,index}.ts
src/lib/marking-lab/{schemas,client,dataset}.ts
src/lib/harness/{render,hash,output-instructions,starters}.ts
src/lib/marking/{parse,check,totals}.ts
src/lib/llm/{client,errors,cost}.ts
src/lib/experiments/{create,start,estimate,comparability}.ts
src/lib/git.ts
src/worker/{index,loop,trial,calls,submit}.ts
src/app/experiments/, src/app/compare/, src/app/calls/[id]/, src/app/harnesses/, src/app/connections/
src/app/api/ (progress and export routes)
tests/fakes/{marking-lab,llm-endpoint}.ts
tests/**/*.test.ts
```

### Patterns to Follow

- **Boundaries:** the worker and web app share `src/lib`. Only `src/lib/marking-lab` and `src/lib/llm` make outbound calls. All of this is server-only, and keys never reach client components.
- **Control flow:** the web app and worker talk only through SQLite. The UI sets a status and the worker notices it by polling.
- **External data:** every Marking Lab and Model response goes through Zod before use.
- **Errors:** show Marking Lab's `error` and `details` text unchanged, because they are written for people.
- **Naming:** files are kebab-case, types are PascalCase using glossary terms, database columns are snake_case.

---

## IMPLEMENTATION PLAN

### Data model

| Table | Key columns |
|---|---|
| `connections` | `name, base_url, api_key_env_var (nullable), locality (local/cloud), concurrency` |
| `harnesses` | `name` |
| `harness_versions` | `harness_id, version, prompt_template, used_marking_scheme, parser, hash`; unique `(harness_id, version)` |
| `experiments` | `harness_version_id, repeats, allow_real_on_cloud, answer_filter (json), spend_limit_usd, dataset_version, git_commit, dirty, status` |
| `experiment_models` | `experiment_id, connection_id, model_name, model_settings (json), run_id, status, price fields (nullable)` |
| `calls` | `experiment_model_id, is_trial, answer_id, question_id, repeat, status, attempts, prompt, raw_output, parsed_lines (json), reason, finish_reason, latency_ms, input_tokens, output_tokens, cost_usd, error, batch_id, result_id`; unique `(experiment_model_id, is_trial, answer_id, repeat)` |
| `submission_batches` | `experiment_model_id, status (sending/stored/refused), call_count, run_results_before, result_ids (json), error` |
| `score_snapshots` | `experiment_model_id, run_id, score (json), fetched_at` |
| `dataset_cache` | `version, kind, external_id, body (json)`; unique on the first three |
| `worker_heartbeat` | a single row with `pid, beat_at` |

- `experiments.status`: `draft`, `running`, `paused`, `finished`
- `experiment_models.status`: `pending`, `marking`, `submitting`, `needs_attention`, `closed`, `withdrawn`
- `calls.status`: `pending`, `in_flight`, `succeeded`, `unreadable`, `failed`

### Phase 1: Foundation

Project setup, database, Marking Lab client, git information.

### Phase 2: Marking core

**Depends on:** Phase 1 for types only.

Pure functions for rendering, parsing, checking and totals. These carry the most risk, so they get the most tests.

### Phase 3: Worker

**Depends on:** Phases 1 and 2.

Trials, Calls with retries, submission, closing, Scores, crash recovery. Tested against the fake servers.

### Phase 4: UI

**Depends on:** Phases 1 and 2. The Connections and Harnesses pages don't need Phase 3 and could be built alongside it. The Experiment and Compare pages need Phase 3.

### Phase 5: End-to-end validation

**Depends on:** everything above, plus real keys for the final step.

---

## STEP-BY-STEP TASKS

### CREATE project scaffold

- **IMPLEMENT**: Next.js App Router, TypeScript, Tailwind, `src/` layout with npm. Add better-sqlite3, drizzle-orm, drizzle-kit, openai, zod, shadcn/ui, vitest, tsx and concurrently. Scripts: `dev` and `start` run web and worker together; also `worker`, `test`, `typecheck`, `lint`, `db:generate`, `db:migrate`.
- **GOTCHA**: `create-next-app` may refuse a folder that already has `GLOSSARY.md`, `docs/` and `.claude/`. If so, scaffold in the scratchpad and copy the files in.
- **GOTCHA**: TypeScript 7 is the newest release. Keep whichever version `create-next-app` installs, and only pin an older one if Next or Drizzle tooling breaks.
- **GOTCHA**: `next dev` and `next start` must use `-H 127.0.0.1`. There's no login, and the database holds student Answers, so the app must not be reachable from the network.
- **VALIDATE**: `npm run build && npm run typecheck`
- **SATISFIES**: AC 1

### CREATE .gitignore, .env.example and git repo

- **IMPLEMENT**: Ignore `data/`, `.env*.local`, `.next/`, `node_modules/`. `.env.example` lists `MARKING_LAB_URL`, `MARKING_LAB_KEY`, `OPENROUTER_API_KEY`. Run `git init` and make the first commit, because Runs need a real commit hash.
- **GOTCHA**: confirm `data/` and `.env.local` are ignored *before* the first commit.
- **VALIDATE**: `mkdir -p data && touch data/x .env.local && git check-ignore data/x .env.local`
- **SATISFIES**: AC 9

### CREATE src/lib/git.ts

- **IMPLEMENT**: `getCodeState()` returns `{ commit, dirty }` from `git rev-parse --short HEAD` and `git status --porcelain`.
- **GOTCHA**: read it when an Experiment starts, and store it on the Experiment so all its Runs report the same state. Throw a plain error if there's no commit.
- **VALIDATE**: `npx vitest run tests/lib/git.test.ts`
- **SATISFIES**: AC 4

### CREATE src/lib/db/schema.ts and index.ts

- **IMPLEMENT**: the tables above, with one shared connection in WAL mode plus `busy_timeout` and foreign keys on. Store the file at `data/lab.db`.
- **GOTCHA**: confirm `better-sqlite3` is treated as external by Next (`serverExternalPackages`). Keep database writes short because two processes share the file.
- **VALIDATE**: `npm run db:generate && npm run db:migrate && npx vitest run tests/lib/db.test.ts`
- **SATISFIES**: AC 2

### CREATE tests/fakes/marking-lab.ts

- **IMPLEMENT**: an in-memory HTTP server implementing the contract above, with a small dataset and these refusal rules: wrong mark count, Line not marked, total out of range, closed Run (409), batch all-or-nothing. It can be told to fail a response *after* storing, which is needed for the crash test.
- **GOTCHA**: this fake encodes our reading of the spec, so passing tests don't prove the real server agrees. Phase 5 checks that.
- **VALIDATE**: `npx vitest run tests/fakes`
- **SATISFIES**: AC 12

### CREATE src/lib/marking-lab/ (schemas, client, dataset)

- **IMPLEMENT**: Zod schemas and a typed client that reads URL and key from the environment. `dataset.ts` fetches all pages at `pageSize` 500 and caches in `dataset_cache` by version.
- **GOTCHA**: caching by version is safe because each version is a fixed snapshot. Always pass `runId` or `version`. Use loose schemas for `disagreements`, and allow nulls in `GroupStats`.
- **VALIDATE**: `npx vitest run tests/lib/marking-lab.test.ts`
- **SATISFIES**: AC 2, AC 5

### CREATE src/lib/harness/ (render, hash, output-instructions, starters)

- **IMPLEMENT**:
  - Placeholders: `{{stem}}`, `{{lines}}`, `{{answer}}`, `{{scheme}}`. `{{lines}}` labels context-only Lines as not marked.
  - Save-time check: `{{scheme}}` must be present if and only if the Marking Scheme setting is on. Unknown placeholders are refused.
  - The app appends the JSON output instructions after the template, listing the marked Lines the Answer has, in order. With a scheme, it lists how many marks each Line needs.
  - The hash is SHA-256 of the template, scheme setting and parser ID.
  - Two starter Harnesses, one with the scheme and one without, seeded on first run.
- **GOTCHA**: an edit creates a new Harness Version only if the current one has been used by an Experiment. `RunStart.promptTemplate` sends the template and output instructions pattern, while each Result's `prompt` is the full text as sent.
- **VALIDATE**: `npx vitest run tests/lib/harness.test.ts`
- **SATISFIES**: AC 3

### CREATE src/lib/marking/ (parse, check, totals)

- **IMPLEMENT**:
  - `parse`: accepts plain JSON, fenced JSON or JSON inside extra text. Reply shape with a scheme is `{ lines: { b: { marks: [1,0,1] } }, reason }`; without one, `{ lines: { b: { total: 2 } }, reason }`.
  - `check`: requires exactly the marked Lines this Answer has. With a scheme, it requires one mark per Marking Point, each from 0 to that point's `marks`. Without one, the total must be from 0 to the Line's `marks`.
  - `totals`: `min(sum of marks, Line's marks)`.
  - All failures return an unreadable outcome with a stated reason, never a thrown error.
- **GOTCHA**: a total stated by the Model when a scheme is in use is ignored, though it remains in `rawOutput`.
- **GOTCHA**: `finish_reason: "length"` is unreadable even if the JSON happens to parse. Include `content_filter` and an empty reply as unreadable too.
- **VALIDATE**: `npx vitest run tests/lib/marking.test.ts`
- **SATISFIES**: AC 6

### CREATE src/lib/llm/ (client, errors, cost)

- **IMPLEMENT**:
  - `client`: `openai` SDK with `baseURL` and a key looked up from the Connection's env var name. Set the SDK's own `maxRetries` to 0 so all retries are counted by us. Request `response_format` JSON schema, and if the endpoint refuses it with a 400, remember that for the Connection and fall back to plain JSON instructions.
  - `errors`: retryable means network errors, timeouts, 408, 409, 429 and 5xx. 400, 401, 403 and 404 are configuration problems: stop that Model right away and set `needs_attention`, rather than spending attempts on every Answer.
  - `cost`: OpenRouter's usage cost when returned; otherwise price fields × tokens; 0 for local Connections; null if unknown.
- **GOTCHA**: backoff is exponential with jitter, honouring `Retry-After`, up to 5 attempts.
- **VALIDATE**: `npx vitest run tests/lib/llm.test.ts`
- **SATISFIES**: AC 7

### CREATE tests/fakes/llm-endpoint.ts

- **IMPLEMENT**: an OpenAI-compatible server with scriptable replies: valid, unreadable, truncated, 429 then success, and permanent 500.
- **VALIDATE**: `npx vitest run tests/fakes`
- **SATISFIES**: AC 12

### CREATE src/lib/experiments/ (create, start, estimate, comparability)

- **IMPLEMENT**:
  - `start`: stores code state, creates a Run for the first Model, pins its `datasetVersion`, and passes that to the rest. `harnessName` is `llm-client-test-lab/<slug>-v<version>`. `extra` holds `harnessHash`, `harnessVersionId`, `experimentId`, `answerFilter`.
  - Answer filter: `source=synthetic` for the *whole* Experiment if any Connection is cloud, unless the override is ticked.
  - `estimate`: prompt length ÷ 4 for input tokens, the token limit as a ceiling for output, × Answers × repeats × prices.
  - `comparability`: warns on differing Dataset Version, Answer filter or Harness hash, partly marked Runs, `dirty` code, and repeats at temperature 0.
- **GOTCHA**: if creating a later Run fails, leave the Experiment paused with the error showing. Empty open Runs on the server are harmless but should be visible.
- **VALIDATE**: `npx vitest run tests/lib/experiments.test.ts`
- **SATISFIES**: AC 4, AC 5, AC 10

### CREATE src/worker/ (index, loop, trial, calls, submit)

- **IMPLEMENT**:
  - `index`: refuses to start if a fresh heartbeat from another process exists. Resets `in_flight` Calls to `pending` on startup, and writes a heartbeat every few seconds.
  - `loop`: polls SQLite each second for work and honours pause and resume. Applies per-Connection concurrency across all Experiments. Pauses when the spend limit is reached.
  - `trial`: picks 10 Answers round-robin across Questions, with a fixed seed from the Experiment ID, at the current Dataset Version with no Run. Stores Calls with `is_trial = 1`.
  - `calls`: renders, calls, parses and checks, then records the outcome. Finished Calls are never repeated.
  - `submit`: when a Model has no pending Calls, sends `succeeded` and `unreadable` Calls in batches of 50, then closes the Run and saves the Score if nothing `failed`. Otherwise it sets `needs_attention`, leaves the Run open, and offers Resume and Close anyway.
- **GOTCHA (crash during submission)**: if the worker dies after Marking Lab stores a batch but before we save `resultIds`, simply resending would duplicate it. So: record the batch as `sending` with `run_results_before` before the POST. On recovery, read `GET /runs/{id}` and compare `run.results`. If it grew by the batch size, mark the batch `stored` with unknown `resultIds`; if unchanged, resend. Submit one batch at a time per Run so the count can be trusted.
- **GOTCHA**: a 400 refusal stores nothing. Mark the batch `refused`, show `details`, set `needs_attention` and do not retry automatically. Since this means our rules disagree with the server's, it needs a person to look.
- **GOTCHA**: Calls for one Answer at repeat 2 or higher send `repeat`. Trial Calls are never submitted.
- **VALIDATE**: `npx vitest run tests/worker`
- **SATISFIES**: AC 5, AC 7, AC 8

### CREATE src/app/connections and src/app/harnesses

- **IMPLEMENT**:
  - Connections: create and edit, with a connection test that lists `/models`. Only the env var *name* is stored, and the page shows whether that variable is set.
  - Harnesses: editor with live preview on a real Question and Answer, version history, save-time checks.
- **VALIDATE**: `npm run build`, then manual check in the browser pane
- **SATISFIES**: AC 3, AC 9

### CREATE src/app/experiments and src/app/calls/[id]

- **IMPLEMENT**:
  - New Experiment form: Harness Version, Models with temperature and token limit, repeats, optional spend limit, estimate, real-Answer override, and a clear warning for `dirty` code.
  - Experiment detail: Trial output, live progress polled every 2 seconds, per-Model status, Scores, and Resume, Close anyway (with confirmation) and Withdraw (with required reason) actions.
  - Call detail: full prompt, raw reply, parsed marks, tokens, latency, cost, error.
- **GOTCHA**: Close and Withdraw can't be undone, so both need a confirmation naming the Run. Show Marking Lab's 403 text if the key isn't a maintainer key.
- **VALIDATE**: `npm run build`, then manual check in the browser pane
- **SATISFIES**: AC 4, AC 8, AC 11

### CREATE src/app/compare and export routes

- **IMPLEMENT**: comparison table with Scores from `score_snapshots` and cost and latency from `calls`; breakdowns by Question, Line, syllabus reference, tag and source; disagreements linked to their Call; comparability warnings; error histogram; CSV and JSON export.
- **GOTCHA**: load the `dataviz` skill before building the histogram. Plain SVG is enough, so no chart library is needed.
- **GOTCHA**: match each disagreement to its Call by `answerId` and `repeat`. If the server's shape doesn't include them, show it unlinked rather than failing.
- **GOTCHA**: in CSV, prefix values starting with `=`, `+`, `-` or `@`, because student text ends up in spreadsheets.
- **VALIDATE**: `npx vitest run tests/lib/export.test.ts && npm run build`
- **SATISFIES**: AC 10, AC 11

### VALIDATE against the real services

- **IMPLEMENT**: with your keys in `.env.local`, run a Trial, then a small Experiment with two cheap Models, confirming Scores appear.
- **GOTCHA**: this creates permanent Runs on Marking Lab. Use a clear `notes` value and the smallest possible Answer set. Ask before running it.
- **VALIDATE**: Level 4 below
- **SATISFIES**: AC 13

---

## TESTING STRATEGY

### Unit Tests

Vitest with a focus on `src/lib/marking`, `src/lib/harness`, cost and comparability. UI components get no unit tests in the first version.

### Integration Tests

The worker runs against both fake servers and a temporary SQLite file, covering a full Experiment from start to saved Score.

### Edge Cases

- Reply in code fences, with extra text, truncated, empty, or with the wrong mark count
- 5 Marking Points worth 3 marks, all awarded, gives a total of 3
- Answer with a blank marked Line; Answer with no marked Lines (no Call)
- Context-only Line in a reply (unreadable)
- 429 then success (counted as one Call); 5 failures (`failed`, never `parseFailed`); 401 (stops the Model)
- Worker killed mid-Call; worker killed after a batch is stored but before `resultIds` are saved
- Batch refused with a 400; Run already closed (409)
- Spend limit reached mid-Experiment, then resumed
- Dataset Version changes between two Runs of one Experiment
- Second worker started while one is running
- Withdraw refused with a 403

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
npm run lint && npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run tests/lib
```

### Level 3: Integration Tests

```bash
npx vitest run tests/worker
```

### Level 4: Manual Validation

1. `npm run dev`, then open `http://127.0.0.1:3000`.
2. Add a Connection and run its test.
3. Preview a starter Harness on a real Question.
4. Create an Experiment, run a Trial, and confirm nothing new appears on Marking Lab.
5. Start the Experiment, close the tab, and reopen to see it still running.
6. Stop the worker mid-Experiment, restart, and confirm it continues without repeating finished Calls.
7. Check that Scores match `GET /runs/{id}/score`, then compare two Runs and export.

### Level 5: Additional Validation

```bash
npm run build
```

```bash
git status --porcelain --ignored | grep -E 'data/|\.env\.local'
```

```bash
grep -rEi 'msk_[a-z0-9]|sk-or-' src tests docs .env.example
```

---

## ACCEPTANCE CRITERIA

- [ ] 1. `npm run dev` starts web and worker together, bound to 127.0.0.1 only
- [ ] 2. Questions, Marking Schemes and Answers load at a pinned Dataset Version
- [ ] 3. Editing a used Harness creates a new Harness Version, and older Experiments keep theirs
- [ ] 4. Each Run sends its commit, `dirty`, template, settings and `extra`; uncommitted code shows a warning without blocking
- [ ] 5. All Runs in an Experiment share one Dataset Version and one Answer filter
- [ ] 6. Only checked marks reach Marking Lab; Line totals follow the `min` rule
- [ ] 7. Provider errors never become `parseFailed`; Unreadable Replies are never retried
- [ ] 8. Experiments survive a closed tab and a worker crash, with no finished Call repeated and no batch sent twice
- [ ] 9. Keys appear in neither SQLite nor exports; `data/` and `.env.local` are not tracked
- [ ] 10. Compare shows Marking Lab's figures unmodified, with local cost and latency, and warns on non-comparable Runs
- [ ] 11. Each disagreement links to its Call where the data allows, and CSV and JSON export work
- [ ] 12. Unit and integration suites pass against the fakes with no real keys
- [ ] 13. One small real Experiment completes against Marking Lab and shows Scores

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Full test suite passes
- [ ] No linting or type errors
- [ ] Manual testing confirms the app works
- [ ] All acceptance criteria met

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumed**: blank marked Lines are left out of `lines`. A refused batch would reveal if this is wrong, and stores nothing.
- **Assumed**: `run.results` counts stored Results promptly and accurately, since crash recovery relies on it. Verify in Phase 5.
- **Assumed**: Marking Lab stores `repeat` values without needing them in any particular order.
- **Assumed**: the whole Experiment uses synthetic Answers if any Connection is cloud. This wasn't explicitly decided: the design only said cloud Experiments are synthetic-only. Applying it per Model instead would give local and cloud Models different Answer sets, which breaks comparison.
- **Assumed**: Results that succeeded are submitted even if other Calls for that Model failed, and the Run stays open for Resume.
- **Assumed**: non-OpenRouter cloud Connections need prices entered by hand. Without prices, cost shows as unknown and a spend limit can't apply, and the form says so.
- **Needs your approval at build time**: the first git commit, and the real test Runs in the last task, because those are permanent.
- **Unknown**: whether your key is a maintainer key. Withdraw handles either case.

## NOTES

**Why a separate worker:** `next dev` reloads can kill long jobs in route handlers, and the Trial, resume and crash requirements all need something that outlives a request.

**Why the crash recovery exists:** "held until the Model finishes" reduces the risk of double submission but doesn't remove it. There's still a moment between the server storing a batch and us recording that. Results are permanent and the API has no idempotency key, so `run.results` is the only available check. If the worker dies between the POST and recording, the `resultIds` for that batch stay unknown, which only affects traceability.

**Sharing a spec copy:** the full OpenAPI document exists only in the chat. The contract section covers what this build uses. Saving the full JSON to `docs/` during the build would be worthwhile if the server publishes it at a fetchable URL.

**Risks in order:** (1) the real Marking Lab differs from our fake, especially on blank Lines and `repeat`; (2) inconsistent JSON support across Models and endpoints; (3) SQLite contention between web and worker, which WAL and short writes should cover; (4) brand-new major versions (TypeScript 7, Next 16) with tooling gaps.

**Confidence:** 7/10 for one-pass success up to the fakes. The real-service step may need small corrections.

## AMENDMENTS

- 2026-11-03 — Built with TypeScript 5, which is what `create-next-app` installed, and `@types/node` 22 for Vitest. Turned off Cache Components, since every page reads live SQLite state.
- 2026-11-03 — Live progress polls with `router.refresh()` every 2 seconds rather than a progress route: simpler, and it re-renders the same server page.
- 2026-11-03 — Refused structured output is remembered per Experiment Model, not per Connection, because one Connection (OpenRouter) serves Models with different support.
- 2026-11-03 — Added `/experiments/[id]/calls`, so every Call can be reached and not only those with disagreements. Added `scripts/run-with-fakes.sh` to try the app with no keys. An Experiment or Trial with no eligible Answers now stops with a plain reason.
