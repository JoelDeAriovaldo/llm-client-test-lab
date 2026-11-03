# LLM Client Test Lab

A personal workbench for testing how well different LLM models mark exam answers. Marking Lab supplies the dataset and calculates the scores; this app drives the models and keeps a record of every call.

## Language

### This app

**Harness**:
A saved way of marking: a prompt template, a choice of whether the model sees the Marking Scheme, and an output parser.
_Avoid_: Test, config, prompt

**Harness Version**:
One fixed state of a Harness. Editing a Harness that has been used creates a new Harness Version, and each Experiment stays tied to the one it ran.
_Avoid_: Revision, snapshot

**Experiment**:
One Harness Version tested against several Models with a repeat count, producing one Run per Model.
_Avoid_: Test, batch, suite

**Model**:
A specific LLM reachable through a Connection, identified by its name there.
_Avoid_: LLM, engine

**Connection**:
An OpenAI-compatible endpoint the app can call Models through, such as OpenRouter or a local Ollama.
_Avoid_: Provider, backend

**Call**:
One request to a Model for one Answer, with its prompt, raw output, parsed marks, latency, tokens, cost and any error.
_Avoid_: Request, completion, attempt

**Trial**:
A small sample of Answers marked to check a Harness. It stays in this app, so it never becomes a Run and never gets a Score.
_Avoid_: Dry run, pilot, smoke test

**Unreadable Reply**:
A Model's reply that can't be parsed into valid marks, and which counts against that Model. A Call that fails for network or provider reasons is not one.
_Avoid_: Parse error, failed Call

### Marking Lab

**Marking Lab**:
The external server that holds the dataset, stores Results permanently and calculates Scores.
_Avoid_: The API, the backend, the server

**Run**:
Marking Lab's record of one Model marking with one prompt template and one Marking Scheme setting, against one Dataset Version.
_Avoid_: Test, job

**Question**:
An exam question made up of Lines.

**Line**:
One part of a Question (a, b, a(ii), or `main` when it has no parts). Only marked Lines receive marks.
_Avoid_: Part, sub-question

**Answer**:
A student's text for a Question, from the dataset.
_Avoid_: Response, submission

**Marking Scheme**:
The Marking Points for each marked Line of a Question, in a fixed order.
_Avoid_: Rubric, mark scheme

**Marking Point**:
One creditable item in a Marking Scheme. It has no id, so marks are matched to it by position.
_Avoid_: Criterion

**Result**:
The marks for one Answer as submitted to a Run. It can never be changed or deleted.
_Avoid_: Output, grade

**Repeat**:
A further marking of the same Answer within a Run, numbered from 1.
_Avoid_: Retry

**Score**:
Marking Lab's assessment of a Run against the Reference Marks. Only Marking Lab calculates it.
_Avoid_: Accuracy, grade

**Reference Marks**:
The correct marks for an Answer, which never leave Marking Lab.
_Avoid_: Ground truth, gold labels

**Dataset Version**:
A numbered snapshot of the dataset. Each Run is tied to one.

**Split**:
The partition an Answer belongs to, either open or hidden. This app uses only the open Split.
