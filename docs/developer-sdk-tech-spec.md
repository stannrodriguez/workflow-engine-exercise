# Developer SDK Tech Spec

## Summary

Add a thin developer-facing SDK on top of the existing workflow engine so workflow authors can define activities and workflows without reaching into engine internals.

The current engine already supports activity execution, history, failure capture, retry, and replay. The SDK should preserve that runtime model while making authoring pleasant, typed, and hard to misuse.

## Goals

- Make workflow authoring read like business logic.
- Make activities first-class objects instead of string names scattered through workflow code.
- Keep replay safety explicit through stable step keys.
- Provide clear run results, failure details, and timeline helpers.
- Keep the engine core small and reusable.
- Preserve existing Level 1 and Level 2 behavior.
- Make the repository installable as a developer SDK package.

## Non-Goals

- No durable database adapter in this checkpoint.
- No distributed worker queue.
- No automatic parallel execution.
- No cron/scheduling layer.
- No visual workflow builder.
- No full TypeScript migration required before the SDK shape is proven.

## Current State

Current workflow code calls the engine directly:

```js
const devices = await ctx.runActivity("getFleetDeviceList", input, {
  activityId: "get-fleet-device-list",
});
```

This works, but it exposes too much runtime machinery to the workflow author:

- activity names are stringly typed
- stable replay keys are manual everywhere
- workflow/result helpers are minimal
- failure reporting requires inspecting raw run objects

## Proposed Developer Experience

### Activity Definition

Activities should be defined once and then passed around as values.

```ts
const getFleetDeviceList = activity({
  name: "getFleetDeviceList",
  run: async ({ fleetId }: { fleetId: string }) => {
    return [
      { id: "device-1", model: "alpha" },
      { id: "device-2", model: "alpha" },
    ];
  },
});
```

### Workflow Definition

Workflow code should read like the logical workflow.

```ts
const fleetUpgradeWorkflow = workflow({
  name: "FleetUpgradeWorkflow",
  run: async ({ input, step }) => {
    const devices = await step(getFleetDeviceList, input);
    const groups = await step(groupDevicesByModel, { devices });

    for (const group of groups) {
      const firmwareSpec = await step(
        getFirmwareRequirements,
        { model: group.model },
        { key: group.model },
      );

      const firmware = await step(
        downloadFirmwarePackage,
        { model: group.model, firmwareSpec },
        { key: group.model },
      );

      for (const device of group.devices) {
        const health = await step(
          checkDeviceHealth,
          { device },
          { key: device.id },
        );

        if (health.status !== "READY") {
          await step(recordSkippedDevice, { device, health }, { key: device.id });
          continue;
        }

        const install = await step(
          installFirmware,
          { device, firmware },
          { key: device.id },
        );

        await step(validateInstallation, { device, install }, { key: device.id });
      }
    }

    return step(generateUpgradeSummary, {});
  },
});
```

### Engine Creation

The engine should register activities through SDK objects.

```ts
const engine = createWorkflowEngine({
  activities: [
    getFleetDeviceList,
    groupDevicesByModel,
    getFirmwareRequirements,
    downloadFirmwarePackage,
    checkDeviceHealth,
    installFirmware,
    validateInstallation,
    generateUpgradeSummary,
  ],
});
```

### Run API

The SDK should expose a friendly run handle or result wrapper.

```ts
const run = await engine.start(fleetUpgradeWorkflow, { fleetId: "fleet-1" });

if (run.failed) {
  console.log(run.failedActivity.name);
  console.log(run.error.message);
  console.log(run.recoveryHint);
}

console.table(run.timeline());
```

Expected helpers:

```ts
run.id
run.status
run.output
run.error
run.activities
run.failed
run.failedActivity
run.timeline()
run.retry()
run.replayFrom(activityId)
```

## SDK API Surface

### `activity(definition)`

Creates an activity definition.

```ts
type ActivityDefinition<Input, Output> = {
  kind: "activity";
  name: string;
  run(input: Input, context: ActivityContext): Promise<Output> | Output;
};
```

Validation:

- `name` must be non-empty.
- `run` must be a function.
- duplicate names should fail during engine creation.

### `workflow(definition)`

Creates a workflow definition.

```ts
type WorkflowDefinition<Input, Output> = {
  kind: "workflow";
  name: string;
  run(context: WorkflowSdkContext<Input>): Promise<Output> | Output;
};
```

Validation:

- `name` must be non-empty.
- `run` must be a function.

### `createWorkflowEngine(options)`

Creates an SDK engine facade over the existing runtime engine.

```ts
type CreateWorkflowEngineOptions = {
  activities: ActivityDefinition<any, any>[];
  store?: WorkflowRunStore;
};
```

The facade owns:

- registering activity handlers with the core engine
- translating SDK workflow definitions to core workflow definitions
- wrapping raw run objects in `WorkflowRunResult`

### `step(activity, input, options?)`

Executes or reuses one activity.

```ts
type StepOptions = {
  key?: string;
  activityId?: string;
};
```

ID generation:

- If `activityId` exists, use it exactly.
- Else if `key` exists, use `${activity.name}:${normalize(key)}`.
- Else use `activity.name`.

This keeps simple workflows terse while making loops replay-safe.

## Stable Step ID Contract

Replay depends on stable activity IDs. The SDK should make this easy and explicit.

Rules:

- Linear one-off steps can omit `key`.
- Steps inside loops should pass a stable `key`.
- Keys should derive from durable business identifiers such as model, device ID, user ID, ticket ID, or workflow step ID.
- Keys should not derive from array index unless the order is guaranteed stable.

Bad:

```ts
await step(installFirmware, { device }, { key: index });
```

Good:

```ts
await step(installFirmware, { device }, { key: device.id });
```

## Error Model

The SDK should convert raw activity failures into a developer-readable error shape.

```ts
type WorkflowFailure = {
  workflowName: string;
  runId: string;
  failedActivity: {
    id: string;
    name: string;
    input: unknown;
    attempt: number;
  };
  cause: {
    name: string;
    message: string;
    stack?: string;
  };
  recoveryHint: string;
};
```

Example message:

```text
Workflow FleetUpgradeWorkflow failed at activity downloadFirmwarePackage.
Activity ID: downloadFirmwarePackage:alpha
Cause: Firmware package for alpha is temporarily unavailable.
Recovery: retry(runId) will resume from this activity.
```

## Timeline Model

`run.timeline()` should produce a compact, display-friendly list.

```ts
type TimelineEvent = {
  sequence: number;
  activityId: string;
  activityName: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  attempt: number;
  inputSummary: string;
  outputSummary?: string;
  errorMessage?: string;
  cachedFromSequence?: number;
};
```

This is intentionally derived from raw execution history, not a separate source of truth.

## Data Boundary

Current implementation:

- `InMemoryWorkflowRunStore`
- process-local activity history
- deterministic tests through explicit run IDs and activity keys

SDK should not change persistence yet. It should depend on the existing store interface so a future durable adapter can be added later.

Future durable adapter:

- persist `WorkflowRun`
- persist `ActivityExecution`
- index by `runId`
- support clearing history from activity ID for replay
- preserve successful outputs for cached replay

## Migration Plan

### Checkpoint 1: SDK Wrappers

Add:

- `src/sdk.js`
- `activity()`
- `workflow()`
- `createWorkflowEngine()`
- result wrapper helpers

Keep existing `src/engine.js` unchanged.

Acceptance:

- Existing tests still pass.
- One new test defines a tiny workflow through the SDK and completes successfully.

### Checkpoint 2: Fleet Workflow Uses SDK

Update the FleetUpgrade example to use SDK primitives.

Acceptance:

- Workflow code no longer calls `ctx.runActivity()` directly.
- Loop steps use stable keys.
- Existing retry/replay tests still pass.

### Checkpoint 3: Developer-Friendly Errors

Add failure helpers:

- `run.failed`
- `run.failedActivity`
- `run.recoveryHint`
- formatted failure message

Acceptance:

- Failure test asserts the failed activity name, activity ID, input, and recovery hint.

### Checkpoint 4: Timeline Helpers

Add:

- `run.timeline()`
- compact activity summaries

Acceptance:

- Retry/replay tests assert skipped cached steps are visible in the timeline.

### Checkpoint 5: Package Readiness

Add:

- package entrypoint at `src/index.js`
- TypeScript declarations at `src/index.d.ts`
- `exports` and `types` fields in `package.json`
- README quickstart that imports from the package name
- install smoke test using `npm pack`

Acceptance:

- A separate temp project can install the generated tarball and import `activity`, `workflow`, and `createWorkflowEngine`.
- `npm pack --dry-run` includes only the intended package files.

## Test Plan

| Scenario | Layer | Setup | Expected Result |
| --- | --- | --- | --- |
| SDK activity registration | unit | duplicate names | clear duplicate error |
| SDK happy path | unit | tiny two-step workflow | completed run with output |
| SDK Fleet workflow | integration | default fleet | completed summary |
| Activity failure | unit | failing activity | failed run with friendly failedActivity |
| Retry failed run | integration | fail then fix activity | earlier steps skipped, failed step reruns |
| Replay from loop step | integration | replay from device health check | earlier model/device steps not rerun |
| Missing loop key warning | unit or lint-style helper | repeated activity without key | documented limitation or warning |

## Open Questions

- Should missing `key` inside loops be detected at runtime, or documented as author responsibility?
- Should the SDK be TypeScript-first now, or remain JavaScript with JSDoc until the engine shape stabilizes?
- Should `run.retry()` and `run.replayFrom()` be methods on the result wrapper, or only methods on the engine facade?
- Should the SDK expose raw history by default, or require `run.raw()` for escape hatches?

## Recommended Interview Framing

Lead with the split:

> The engine owns deterministic execution history, replay, and failure semantics. The SDK is a small authoring layer that makes workflow code readable and harder to misuse.

Then call out the replay contract:

> Replay only works if activity IDs are stable. The SDK makes simple steps terse and looped steps explicit through durable keys.

Finally, explain why this stays small:

> I would prove the API with wrappers and tests before introducing persistence, queues, parallelism, or a TypeScript migration.
