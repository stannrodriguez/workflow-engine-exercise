# Natural Language Workflow Builder Contract

## Vertical Slice

- Actor: developer or operator authoring a workflow in natural language.
- Trigger: author clicks compile, then starts a workflow run.
- Core action: natural language is compiled into a structured `WorkflowSpec`, validated against registered activities, interpreted through SDK `step()`, and executed by the existing deterministic engine.
- Final visible state: UI shows source text, generated spec, graph, timeline, failure details, retry/replay controls, and final workflow output.

## Entities

| Entity | Owns | Relationships | Notes |
| --- | --- | --- | --- |
| `WorkflowSpec` | name, description, input schema, ordered steps | interpreted into `WorkflowDefinition` | configuration, never runtime state |
| `WorkflowStep` | activity, loop, or branch instruction | belongs to `WorkflowSpec` | constrained DSL, not free-form prose |
| `ActivityDefinition` | registered tool handler | referenced by activity steps | validation boundary |
| `WorkflowRun` | run state, input, output, error, activity history | produced by existing engine | runtime source of truth |
| `ActivityExecution` | stable activity id, status, input/output/error | belongs to `WorkflowRun` | retry/replay unit |

## Lifecycle

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `draft_text` | user has natural language text | `compiled`, `compile_failed` |
| `compiled` | text produced a valid `WorkflowSpec` | `running`, `draft_text` |
| `compile_failed` | text was unsupported or invalid | `draft_text` |
| `running` | existing engine is executing interpreted spec | `completed`, `failed` |
| `failed` | existing engine captured failed activity | `running` through retry/replay |
| `completed` | existing engine returned output | `running` through replay |

## Events

| Event | Emitted when | Payload |
| --- | --- | --- |
| `workflow.compiled` | text maps to valid spec | spec name, step count |
| `workflow.compile_failed` | text unsupported | error message |
| `workflow.run_started` | run begins | scenario, run id |
| `activity.succeeded` | existing engine records success | activity id/output |
| `activity.failed` | existing engine records failure | activity id/error |
| `activity.skipped` | existing engine reuses history | cached sequence |

## State Machine: `WorkflowRun`

| State | Meaning | Terminal? |
| --- | --- | --- |
| `created` | run exists, not executing | no |
| `running` | interpreted spec is executing | no |
| `completed` | spec interpreter returned output | yes |
| `failed` | activity or interpreter threw | yes |

## Recovery

| Failure | Retry? | Fallback | Human handoff? |
| --- | --- | --- | --- |
| unsupported natural language | no | edit source text | no |
| unknown activity in spec | no | register activity or fix spec | no |
| missing stable loop key | no | add key expression | no |
| retryable activity failure | yes | existing engine retry | no |
| changed downstream condition/input | yes | existing engine replay from selected activity | no |

## Invariants

- Natural language is never executed directly.
- Every runtime side effect goes through a registered activity.
- Every activity step has an explicit `id`.
- Activity steps inside loops require a stable `key`.
- Retry/replay uses existing `ActivityExecution.activityId` history.
- The spec interpreter may add safe conveniences, such as `output: "items[]"`, but it must not invent unregistered activities.

## API Surface

| Method | Path/action | Input | Output | Errors |
| --- | --- | --- | --- | --- |
| `compileWorkflowFromNaturalLanguage` | SDK function | source text | `WorkflowSpec` | unsupported workflow text |
| `validateWorkflowSpec` | SDK function | spec + activities | validation result or throw | invalid spec |
| `createWorkflowFromSpec` | SDK function | spec + activities | SDK workflow definition | invalid spec |
| `POST /api/workflow/compile` | playground | `{ text }` | `{ spec, workflow }` | unsupported/invalid spec |
| `POST /api/runs` | playground | `{ scenario, spec }` | `{ run }` | invalid spec or runtime failure state |

## Acceptance Criteria

- [ ] Fleet upgrade natural language compiles into nested loops and branches.
- [ ] Unsupported natural language returns a clear compile error.
- [ ] Unknown activity references are rejected before execution.
- [ ] Looped activity steps require stable keys.
- [ ] Interpreter executes activity, loop, branch, and output bindings.
- [ ] Existing retry skips successful prior activities.
- [ ] Existing replay changes downstream output after input/scenario changes.
- [ ] Playground displays source text, generated spec, graph, run timeline, failure, retry, and replay.
