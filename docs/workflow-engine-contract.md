# Workflow Engine Contract

## Vertical Slice

- Actor: developer defining workflow activities and a workflow function.
- Trigger: caller starts a workflow run, retries a failed run, or replays from an activity.
- Core action: engine executes activities in workflow order, passes outputs forward, records execution history, and captures failures.
- Final visible state: workflow run is `completed` with output or `failed` with captured error and failed activity information.

## Entities

| Entity | Owns | Relationships | Notes |
| --- | --- | --- | --- |
| `WorkflowDefinition` | workflow name and function | calls activities through `WorkflowContext` | configuration |
| `ActivityDefinition` | activity name and handler | invoked by `WorkflowRun` | side-effect boundary |
| `WorkflowRun` | state, input, output, error, activity history | owns many `ActivityExecution` records | runtime |
| `ActivityExecution` | stable activity id, status, input, output, error, attempt count | belongs to one run | replay unit |
| `WorkflowRunStore` | run persistence boundary | backed by in-memory map in this exercise | can be replaced later |

## State Machine: WorkflowRun

| State | Meaning | Terminal? |
| --- | --- | --- |
| `created` | run exists but has not started | no |
| `running` | workflow function is executing | no |
| `completed` | workflow returned output | yes |
| `failed` | activity or workflow threw | yes |

## State Machine: ActivityExecution

| State | Meaning | Terminal? |
| --- | --- | --- |
| `running` | handler started | no |
| `succeeded` | handler returned output | yes |
| `failed` | handler threw | yes |
| `skipped` | cached successful output was reused | yes |

## Recovery

- Retry failed run: remove the failed activity and later history, then rerun workflow. Earlier successful activity outputs are cached.
- Replay from activity: remove the selected activity and later history, then rerun workflow. Earlier successful activity outputs are cached.

## Acceptance Criteria

- [x] Engine can register activities and execute a workflow.
- [x] Engine tracks workflow and activity state.
- [x] Activity outputs can feed later activity inputs.
- [x] Activity failure marks workflow as failed and captures error information.
- [x] Retry failed workflow does not rerun earlier successful activities.
- [x] Replay from arbitrary activity does not rerun earlier successful activities.
