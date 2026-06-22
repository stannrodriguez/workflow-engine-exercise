# Workflow Engine Exercise

A small installable workflow engine SDK for defining activities, running workflows, tracking execution history, and resuming work with retry/replay semantics.

The implementation is intentionally compact enough for an interview exercise, but the public API is shaped like a package another engineer could install and use.

## Install

From this repository:

```bash
npm install
```

From a GitHub repo after publishing the repository:

```bash
npm install github:<owner>/<repo>
```

From npm after publishing the package:

```bash
npm install workflow-engine-exercise
```

## Quickstart

```js
import { activity, createWorkflowEngine, workflow } from "workflow-engine-exercise";

const fetchUser = activity({
  name: "fetchUser",
  run: async ({ userId }) => ({ id: userId, name: "Stephanie" }),
});

const writeWelcomeMessage = activity({
  name: "writeWelcomeMessage",
  run: async ({ user }) => `Welcome, ${user.name}!`,
});

const welcomeWorkflow = workflow({
  name: "WelcomeWorkflow",
  run: async ({ input, step }) => {
    const user = await step(fetchUser, { userId: input.userId });
    return step(writeWelcomeMessage, { user });
  },
});

const engine = createWorkflowEngine({
  activities: [fetchUser, writeWelcomeMessage],
});

const run = await engine.start(welcomeWorkflow, { userId: "user_123" });

console.log(run.output);
console.table(run.timeline());
```

Run the included quickstart:

```bash
npm run quickstart
```

## Visual Playground

The repository includes a shadcn/Next.js playground that visualizes the Fleet
Upgrade workflow as a builder canvas. It imports the root SDK entrypoint for the
local demo, so retry and replay behavior is backed by real workflow history.

```bash
npm run ui:install
npm run ui
```

Then open the printed localhost URL and try the **Retryable failure** scenario:

1. Start a run where firmware download fails.
2. Inspect the failed activity and captured error.
3. Click **Retry failed run**.
4. Confirm earlier successful activities become history hits instead of reruns.
5. Select an activity and replay from that point.

## Core Concepts

- `activity()` defines a side-effecting or reusable unit of work.
- `workflow()` defines orchestration logic in normal JavaScript.
- `step()` runs an activity and records its input/output/error in workflow history.
- `createWorkflowEngine()` registers activities and starts/retries/replays workflows.
- `run.timeline()` gives a display-friendly view of activity execution history.

## Replay Safety

Retry and replay depend on stable activity IDs. The SDK generates a stable ID from the activity name for one-off steps. Repeated or looped steps should pass a durable key.

```js
await step(installFirmware, { device, firmware }, { key: device.id });
```

If an activity is called more than once without a key during one workflow invocation, the SDK fails fast with a clear error instead of accidentally reusing the wrong cached result.

## Commands

```bash
npm test
npm run demo
npm run quickstart
npm run ui:install
npm run ui
npm run ui:verify
npm run verify
```

## What It Demonstrates

- Developer-friendly SDK surface: `activity`, `workflow`, `createWorkflowEngine`, `step`.
- Workflow execution with activity outputs flowing into later activities.
- Workflow and activity execution state tracking.
- Failure capture with failed activity information and recovery hints.
- Retry from failure without rerunning earlier successful activities.
- Replay from an arbitrary activity ID.
- Package exports and TypeScript declaration file for installability.

## Project Structure

```text
src/
  index.js        package entrypoint
  index.d.ts     TypeScript declarations
  sdk.js         developer-facing SDK facade
  engine.js      core runtime engine
  fleetUpgradeWorkflow.js
examples/
  quickstart.js
scripts/
  demo.js
tests/
  sdk.test.js
  workflow-engine.test.js
playground/
  app/             Next.js route handlers and page
  components/      shadcn workflow visualizer
  lib/             demo workflow runtime using the public SDK
docs/
  workflow-engine-contract.md
  developer-sdk-tech-spec.md
```

## Design Choice

The core engine owns deterministic execution history, retry, and replay. The SDK is a thin authoring layer that makes workflows pleasant to write while preserving explicit replay keys for repeated or looped activities.

The shadcn playground is intentionally outside the package `files` list. It
makes the GitHub repo easy to demo, while keeping installed SDK consumers on the
small `src/` package surface.
