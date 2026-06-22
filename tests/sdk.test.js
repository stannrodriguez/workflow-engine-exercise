import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activity, createWorkflowEngine, workflow } from "../src/index.js";

describe("developer SDK", () => {
  it("lets a developer define activities and run a workflow through the package entrypoint", async () => {
    const fetchNumber = activity({
      name: "fetchNumber",
      run: () => 2,
    });
    const doubleNumber = activity({
      name: "doubleNumber",
      run: ({ value }) => value * 2,
    });
    const exampleWorkflow = workflow({
      name: "ExampleWorkflow",
      run: async ({ step }) => {
        const value = await step(fetchNumber, {});
        return step(doubleNumber, { value });
      },
    });
    const engine = createWorkflowEngine({
      activities: [fetchNumber, doubleNumber],
    });

    const run = await engine.start(exampleWorkflow, {}, { runId: "sdk-success" });

    assert.equal(run.status, "completed");
    assert.equal(run.failed, false);
    assert.equal(run.output, 4);
    assert.deepEqual(
      run.timeline().map((event) => [event.activityName, event.status]),
      [
        ["fetchNumber", "succeeded"],
        ["doubleNumber", "succeeded"],
      ],
    );
  });

  it("returns developer-friendly failure helpers", async () => {
    const unstableActivity = activity({
      name: "unstableActivity",
      run: () => {
        throw new Error("Temporary outage.");
      },
    });
    const failingWorkflow = workflow({
      name: "FailingWorkflow",
      run: async ({ step }) => step(unstableActivity, { value: 1 }),
    });
    const engine = createWorkflowEngine({
      activities: [unstableActivity],
    });

    const run = await engine.start(failingWorkflow, {}, { runId: "sdk-failure" });

    assert.equal(run.status, "failed");
    assert.equal(run.failed, true);
    assert.equal(run.failedActivity.activityName, "unstableActivity");
    assert.equal(run.failedActivity.activityId, "unstableActivity");
    assert.match(run.recoveryHint, /Retry run sdk-failure/);
    assert.match(run.failureMessage(), /Workflow FailingWorkflow failed/);
    assert.match(run.failureMessage(), /Temporary outage/);
  });

  it("requires stable keys when an activity is called repeatedly in one workflow invocation", async () => {
    const sendMessage = activity({
      name: "sendMessage",
      run: ({ value }) => value,
    });
    const repeatedWorkflow = workflow({
      name: "RepeatedWorkflow",
      run: async ({ step }) => {
        await step(sendMessage, { value: "first" });
        await step(sendMessage, { value: "second" });
      },
    });
    const engine = createWorkflowEngine({
      activities: [sendMessage],
    });

    const run = await engine.start(repeatedWorkflow, {}, { runId: "sdk-repeated" });

    assert.equal(run.status, "failed");
    assert.match(
      run.error.message,
      /sendMessage was called more than once without a stable key/,
    );
  });

  it("supports retry through the run result wrapper", async () => {
    let shouldFail = true;
    const getInput = activity({
      name: "getInput",
      run: () => "stable",
    });
    const maybeFail = activity({
      name: "maybeFail",
      run: ({ value }) => {
        if (shouldFail) {
          throw new Error("Not ready.");
        }

        return `${value}:ready`;
      },
    });
    const retryWorkflow = workflow({
      name: "RetryWorkflow",
      run: async ({ step }) => {
        const value = await step(getInput, {});
        return step(maybeFail, { value });
      },
    });
    const engine = createWorkflowEngine({
      activities: [getInput, maybeFail],
    });

    const failed = await engine.start(retryWorkflow, {}, { runId: "sdk-retry" });
    shouldFail = false;
    const retried = await failed.retry();

    assert.equal(retried.status, "completed");
    assert.equal(retried.output, "stable:ready");
    assert.equal(
      retried.timeline().filter((event) => event.status === "skipped").length,
      1,
    );
  });
});
