import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activity,
  compileWorkflowFromNaturalLanguage,
  createWorkflowEngine,
  createWorkflowFromSpec,
  validateWorkflowSpec,
} from "../src/index.js";

const fleetPrompt = [
  "Upgrade every fleet device.",
  "Get the fleet device list, group devices by model, download firmware for each model,",
  "check each device health, install firmware only if health is READY,",
  "validate installation, record successful upgrades, record failed validations,",
  "skip unhealthy devices, generate a summary, alert IT if there are failures, and archive logs.",
].join(" ");

describe("natural language workflow specs", () => {
  it("compiles the fleet upgrade prompt into a nested workflow spec", () => {
    const spec = compileWorkflowFromNaturalLanguage(fleetPrompt);
    const groupLoop = spec.steps.find((step) => step.id === "for-each-device-group");
    const deviceLoop = groupLoop.steps.find((step) => step.id === "for-each-device");
    const healthBranch = deviceLoop.steps.find((step) => step.id === "if-device-ready");

    assert.equal(spec.name, "FleetUpgradeWorkflow");
    assert.equal(groupLoop.type, "for_each");
    assert.equal(groupLoop.items, "deviceGroups");
    assert.equal(deviceLoop.type, "for_each");
    assert.equal(deviceLoop.items, "deviceGroup.devices");
    assert.equal(healthBranch.type, "if");
    assert.equal(healthBranch.condition, 'healthStatus == "READY"');
  });

  it("rejects unsupported natural-language requests with a clear error", () => {
    assert.throws(
      () => compileWorkflowFromNaturalLanguage("Send a friendly welcome email."),
      /Unsupported workflow request/,
    );
  });

  it("validates that every activity step references a registered activity", () => {
    const spec = compileWorkflowFromNaturalLanguage(fleetPrompt);
    const brokenSpec = structuredClone(spec);
    brokenSpec.steps[0].activity = "missingActivity";

    assert.throws(
      () => validateWorkflowSpec(brokenSpec, Object.values(createFleetActivities())),
      /unknown activity missingActivity/,
    );
  });

  it("validates that looped activity steps have stable keys", () => {
    const spec = compileWorkflowFromNaturalLanguage(fleetPrompt);
    const brokenSpec = structuredClone(spec);
    const groupLoop = brokenSpec.steps.find(
      (step) => step.id === "for-each-device-group",
    );
    delete groupLoop.steps[0].key;

    assert.throws(
      () => validateWorkflowSpec(brokenSpec, Object.values(createFleetActivities())),
      /requires a stable key expression/,
    );
  });

  it("interprets loops and branches, routing unhealthy devices to skipped output", async () => {
    const harness = createHarness({
      healthByDeviceId: {
        "device-3": "NEEDS_ATTENTION",
      },
    });

    const run = await harness.engine.start(
      harness.workflow,
      { fleetId: "fleet-skipped" },
      { runId: "spec-skipped" },
    );

    assert.equal(run.status, "completed");
    assert.equal(run.output.successCount, 2);
    assert.equal(run.output.skippedCount, 1);
    assert.deepEqual(run.output.skippedDevices, [
      {
        deviceId: "device-3",
        healthStatus: "NEEDS_ATTENTION",
        model: "beta",
      },
    ]);
    assert.equal(
      run.activities.some(
        (execution) => execution.activityId === "install-firmware:device-3",
      ),
      false,
    );
  });

  it("records failed validations and sends an alert when summary has failures", async () => {
    const harness = createHarness({
      validationByDeviceId: {
        "device-2": "FAILED",
      },
    });

    const run = await harness.engine.start(
      harness.workflow,
      { fleetId: "fleet-validation-failure" },
      { runId: "spec-validation-failure" },
    );

    assert.equal(run.status, "completed");
    assert.equal(run.output.successCount, 2);
    assert.equal(run.output.failureCount, 1);
    assert.deepEqual(run.output.failedValidations, [
      {
        deviceId: "device-2",
        model: "alpha",
        status: "FAILED",
      },
    ]);
    assert.ok(
      run.activities.some(
        (execution) => execution.activityId === "send-alert-to-it-team",
      ),
    );
  });

  it("retries a failed interpreted spec without rerunning prior successful activities", async () => {
    const harness = createHarness({
      failDownloadForModel: "alpha",
    });

    const failed = await harness.engine.start(
      harness.workflow,
      { fleetId: "fleet-retry" },
      { runId: "spec-retry" },
    );

    assert.equal(failed.status, "failed");
    assert.equal(failed.failedActivity.activityId, "download-firmware-package:alpha");
    assert.equal(harness.calls.get("getFleetDeviceList"), 1);
    assert.equal(harness.calls.get("groupDevicesByModel"), 1);

    harness.controls.setScenario({ failDownloadForModel: undefined });
    const retried = await failed.retry();

    assert.equal(retried.status, "completed");
    assert.equal(retried.output.successCount, 3);
    assert.equal(harness.calls.get("getFleetDeviceList"), 1);
    assert.equal(harness.calls.get("groupDevicesByModel"), 1);
    assert.equal(
      retried.timeline().filter((event) => event.status === "skipped").length,
      3,
    );
  });

  it("replays from a selected activity and changes downstream output", async () => {
    const harness = createHarness();

    const firstRun = await harness.engine.start(
      harness.workflow,
      { fleetId: "fleet-replay" },
      { runId: "spec-replay" },
    );

    assert.equal(firstRun.status, "completed");
    assert.equal(firstRun.output.successCount, 3);
    assert.equal(harness.calls.get("getFleetDeviceList"), 1);

    harness.controls.setScenario({
      healthByDeviceId: {
        "device-2": "NEEDS_ATTENTION",
      },
    });

    const replayed = await firstRun.replayFrom("check-device-health:device-2");

    assert.equal(replayed.status, "completed");
    assert.equal(replayed.output.successCount, 2);
    assert.equal(replayed.output.skippedCount, 1);
    assert.equal(harness.calls.get("getFleetDeviceList"), 1);
    assert.ok(
      replayed.activities.some(
        (execution) => execution.activityId === "record-skipped-device:device-2",
      ),
    );
  });
});

function createHarness(initialScenario = {}) {
  const scenario = structuredClone(initialScenario);
  const calls = new Map();
  const activities = createFleetActivities(scenario, calls);
  const spec = compileWorkflowFromNaturalLanguage(fleetPrompt);
  const workflow = createWorkflowFromSpec(spec, Object.values(activities));
  const engine = createWorkflowEngine({ activities: Object.values(activities) });

  return {
    calls,
    controls: {
      setScenario(patch) {
        Object.assign(scenario, patch);
      },
    },
    engine,
    spec,
    workflow,
  };
}

function createFleetActivities(scenario = {}, calls = new Map()) {
  function tracked(name, run) {
    calls.set(name, 0);
    return activity({
      name,
      run: (input, context) => {
        calls.set(name, calls.get(name) + 1);
        return run(input, context);
      },
    });
  }

  return {
    archiveUpgradeLogs: tracked("archiveUpgradeLogs", ({ summary }) => ({
      archived: true,
      totalDevices:
        summary.successCount + summary.failureCount + summary.skippedCount,
    })),
    checkDeviceHealth: tracked(
      "checkDeviceHealth",
      ({ device }) => scenario.healthByDeviceId?.[device.id] ?? "READY",
    ),
    downloadFirmwarePackage: tracked(
      "downloadFirmwarePackage",
      ({ model, firmwareSpec }) => {
        if (scenario.failDownloadForModel === model) {
          throw new Error(`Firmware package for ${model} is temporarily unavailable.`);
        }

        return {
          checksum: `${model}:${firmwareSpec.version}:checksum`,
          model,
          version: firmwareSpec.version,
        };
      },
    ),
    generateUpgradeSummary: tracked(
      "generateUpgradeSummary",
      ({ failedValidations, skippedDevices, successfulUpgrades }) => ({
        failedValidations,
        failureCount: failedValidations.length,
        skippedCount: skippedDevices.length,
        skippedDevices,
        successCount: successfulUpgrades.length,
        successfulUpgrades,
      }),
    ),
    getFirmwareRequirements: tracked("getFirmwareRequirements", ({ model }) => ({
      model,
      version: scenario.firmwareVersions?.[model] ?? "2026.6.0",
    })),
    getFleetDeviceList: tracked(
      "getFleetDeviceList",
      () =>
        scenario.devices ?? [
          { id: "device-1", model: "alpha" },
          { id: "device-2", model: "alpha" },
          { id: "device-3", model: "beta" },
        ],
    ),
    groupDevicesByModel: tracked("groupDevicesByModel", ({ devices }) => {
      const groups = new Map();
      for (const device of devices) {
        const existing = groups.get(device.model) ?? [];
        existing.push(device);
        groups.set(device.model, existing);
      }

      return Array.from(groups.entries()).map(([model, groupedDevices]) => ({
        devices: groupedDevices,
        model,
      }));
    }),
    installFirmware: tracked("installFirmware", ({ device, firmware }) => ({
      deviceId: device.id,
      installedAt: "2026-06-22T10:00:00.000Z",
      model: device.model,
      version: firmware.version,
    })),
    recordFailedValidation: tracked(
      "recordFailedValidation",
      ({ device, validationResult }) => ({
        deviceId: device.id,
        model: device.model,
        status: validationResult.status,
      }),
    ),
    recordSkippedDevice: tracked("recordSkippedDevice", ({ device, healthStatus }) => ({
      deviceId: device.id,
      healthStatus,
      model: device.model,
    })),
    recordSuccessfulUpgrade: tracked(
      "recordSuccessfulUpgrade",
      ({ device, installResult }) => ({
        deviceId: device.id,
        model: device.model,
        version: installResult.version,
      }),
    ),
    sendAlertToITTeam: tracked("sendAlertToITTeam", ({ summary }) => ({
      failureCount: summary.failureCount,
      sent: true,
    })),
    validateInstallation: tracked("validateInstallation", ({ device, installResult }) => ({
      deviceId: device.id,
      status: scenario.validationByDeviceId?.[device.id] ?? "SUCCESS",
      version: installResult.version,
    })),
  };
}
