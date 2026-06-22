import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorkflowEngine } from "../src/engine.js";
import {
  createFleetUpgradeWorkflow,
  registerFleetActivities,
} from "../src/fleetUpgradeWorkflow.js";

describe("workflow engine", () => {
  it("runs a workflow and tracks successful activity execution state", async () => {
    const engine = new WorkflowEngine();
    registerFleetActivities(engine, {
      healthByDeviceId: {
        "device-3": "NEEDS_ATTENTION",
      },
    });

    const run = await engine.start(
      createFleetUpgradeWorkflow(),
      { fleetId: "fleet-1" },
      { runId: "run-success" },
    );

    assert.equal(run.state, "completed");
    assert.deepEqual(run.output, {
      successCount: 2,
      failureCount: 0,
      skippedCount: 1,
      successfulUpgrades: [
        { deviceId: "device-1", model: "alpha", version: "2026.6.0" },
        { deviceId: "device-2", model: "alpha", version: "2026.6.0" },
      ],
      failedValidations: [],
      skippedDevices: [
        {
          deviceId: "device-3",
          model: "beta",
          healthStatus: "NEEDS_ATTENTION",
        },
      ],
    });
    assert.equal(run.error, undefined);
    assert.ok(run.activityExecutions.every((activity) => activity.status === "succeeded"));
  });

  it("captures activity failure details and marks the workflow as failed", async () => {
    const engine = new WorkflowEngine();
    registerFleetActivities(engine, {
      failDownloadForModel: "alpha",
    });

    const run = await engine.start(
      createFleetUpgradeWorkflow(),
      { fleetId: "fleet-2" },
      { runId: "run-failure" },
    );

    const failedActivity = run.activityExecutions.find(
      (activity) => activity.status === "failed",
    );

    assert.equal(run.state, "failed");
    assert.equal(failedActivity.activityId, "download-firmware-package:alpha");
    assert.equal(
      failedActivity.error.message,
      "Firmware package for alpha is temporarily unavailable.",
    );
    assert.match(run.error.message, /downloadFirmwarePackage failed/);
  });

  it("retries a failed workflow without rerunning successful activities", async () => {
    const engine = new WorkflowEngine();
    const controls = registerFleetActivities(engine, {
      failDownloadForModel: "alpha",
    });
    const workflow = createFleetUpgradeWorkflow();

    const failedRun = await engine.start(
      workflow,
      { fleetId: "fleet-3" },
      { runId: "run-retry" },
    );

    assert.equal(failedRun.state, "failed");
    assert.equal(controls.calls.get("getFleetDeviceList"), 1);
    assert.equal(controls.calls.get("groupDevicesByModel"), 1);
    assert.equal(controls.calls.get("getFirmwareRequirements"), 1);
    assert.equal(controls.calls.get("downloadFirmwarePackage"), 1);

    controls.setScenario({ failDownloadForModel: undefined });
    const retriedRun = await engine.retry(workflow, "run-retry");

    assert.equal(retriedRun.state, "completed");
    assert.equal(controls.calls.get("getFleetDeviceList"), 1);
    assert.equal(controls.calls.get("groupDevicesByModel"), 1);
    assert.equal(controls.calls.get("getFirmwareRequirements"), 2);
    assert.equal(controls.calls.get("downloadFirmwarePackage"), 3);
    assert.ok(
      retriedRun.activityExecutions.some((activity) => activity.status === "skipped"),
    );
  });

  it("replays from an arbitrary activity without rerunning earlier successful activities", async () => {
    const engine = new WorkflowEngine();
    const controls = registerFleetActivities(engine);
    const workflow = createFleetUpgradeWorkflow();

    const firstRun = await engine.start(
      workflow,
      { fleetId: "fleet-4" },
      { runId: "run-replay" },
    );

    assert.equal(firstRun.state, "completed");
    assert.equal(firstRun.output.successCount, 3);
    assert.equal(controls.calls.get("getFleetDeviceList"), 1);
    assert.equal(controls.calls.get("checkDeviceHealth"), 3);

    controls.setScenario({
      healthByDeviceId: {
        "device-2": "NEEDS_ATTENTION",
      },
    });

    const replayedRun = await engine.replayFrom(
      workflow,
      "run-replay",
      "check-device-health:device-2",
    );

    assert.equal(replayedRun.state, "completed");
    assert.equal(replayedRun.output.successCount, 2);
    assert.equal(replayedRun.output.skippedCount, 1);
    assert.equal(controls.calls.get("getFleetDeviceList"), 1);
    assert.equal(controls.calls.get("checkDeviceHealth"), 5);
    assert.equal(controls.calls.get("installFirmware"), 4);
  });
});
