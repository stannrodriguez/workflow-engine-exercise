export function createFleetUpgradeWorkflow() {
  return {
    name: "FleetUpgradeWorkflow",
    execute: async (ctx, input) => {
      const devices = await ctx.runActivity("getFleetDeviceList", input, {
        activityId: "get-fleet-device-list",
      });
      const deviceGroups = await ctx.runActivity("groupDevicesByModel", { devices }, {
        activityId: "group-devices-by-model",
      });

      const successfulUpgrades = [];
      const failedValidations = [];
      const skippedDevices = [];

      for (const deviceGroup of deviceGroups) {
        const groupId = normalizeId(deviceGroup.model);
        const firmwareSpec = await ctx.runActivity(
          "getFirmwareRequirements",
          { model: deviceGroup.model },
          { activityId: `get-firmware-requirements:${groupId}` },
        );
        const firmware = await ctx.runActivity(
          "downloadFirmwarePackage",
          { model: deviceGroup.model, firmwareSpec },
          { activityId: `download-firmware-package:${groupId}` },
        );

        for (const device of deviceGroup.devices) {
          const deviceId = normalizeId(device.id);
          const healthStatus = await ctx.runActivity(
            "checkDeviceHealth",
            { device },
            { activityId: `check-device-health:${deviceId}` },
          );

          if (healthStatus !== "READY") {
            const skipped = await ctx.runActivity(
              "recordSkippedDevice",
              { device, healthStatus },
              { activityId: `record-skipped-device:${deviceId}` },
            );
            skippedDevices.push(skipped);
            continue;
          }

          const installResult = await ctx.runActivity(
            "installFirmware",
            { device, firmware },
            { activityId: `install-firmware:${deviceId}` },
          );
          const validationResult = await ctx.runActivity(
            "validateInstallation",
            { device, installResult },
            { activityId: `validate-installation:${deviceId}` },
          );

          if (validationResult.status === "SUCCESS") {
            const success = await ctx.runActivity(
              "recordSuccessfulUpgrade",
              { device, installResult, validationResult },
              { activityId: `record-successful-upgrade:${deviceId}` },
            );
            successfulUpgrades.push(success);
          } else {
            const failedValidation = await ctx.runActivity(
              "recordFailedValidation",
              { device, validationResult },
              { activityId: `record-failed-validation:${deviceId}` },
            );
            failedValidations.push(failedValidation);
          }
        }
      }

      const summary = await ctx.runActivity(
        "generateUpgradeSummary",
        { successfulUpgrades, failedValidations, skippedDevices },
        { activityId: "generate-upgrade-summary" },
      );

      if (summary.failureCount > 0) {
        await ctx.runActivity(
          "sendAlertToITTeam",
          { summary },
          { activityId: "send-alert-to-it-team" },
        );
      }

      await ctx.runActivity(
        "archiveUpgradeLogs",
        { summary },
        { activityId: "archive-upgrade-logs" },
      );

      return summary;
    },
  };
}

export function registerFleetActivities(engine, scenario = {}) {
  const calls = new Map();

  function track(name, handler) {
    calls.set(name, 0);
    engine.registerActivity(name, async (input, meta) => {
      calls.set(name, calls.get(name) + 1);
      return handler(input, meta);
    });
  }

  track("getFleetDeviceList", () => scenario.devices ?? defaultDevices());
  track("groupDevicesByModel", ({ devices }) => {
    const groups = new Map();
    for (const device of devices) {
      const existing = groups.get(device.model) ?? [];
      existing.push(device);
      groups.set(device.model, existing);
    }

    return Array.from(groups.entries()).map(([model, groupedDevices]) => ({
      model,
      devices: groupedDevices,
    }));
  });
  track("getFirmwareRequirements", ({ model }) => ({
    model,
    version: scenario.firmwareVersions?.[model] ?? "2026.6.0",
  }));
  track("downloadFirmwarePackage", ({ model, firmwareSpec }) => {
    if (scenario.failDownloadForModel === model) {
      throw new Error(`Firmware package for ${model} is temporarily unavailable.`);
    }

    return {
      model,
      version: firmwareSpec.version,
      checksum: `${model}:${firmwareSpec.version}:checksum`,
    };
  });
  track("checkDeviceHealth", ({ device }) => {
    return scenario.healthByDeviceId?.[device.id] ?? "READY";
  });
  track("installFirmware", ({ device, firmware }) => ({
    deviceId: device.id,
    model: device.model,
    version: firmware.version,
    installedAt: "2026-06-22T10:00:00.000Z",
  }));
  track("validateInstallation", ({ device, installResult }) => ({
    deviceId: device.id,
    version: installResult.version,
    status: scenario.validationByDeviceId?.[device.id] ?? "SUCCESS",
  }));
  track("recordSuccessfulUpgrade", ({ device, installResult }) => ({
    deviceId: device.id,
    model: device.model,
    version: installResult.version,
  }));
  track("recordFailedValidation", ({ device, validationResult }) => ({
    deviceId: device.id,
    model: device.model,
    status: validationResult.status,
  }));
  track("recordSkippedDevice", ({ device, healthStatus }) => ({
    deviceId: device.id,
    model: device.model,
    healthStatus,
  }));
  track("generateUpgradeSummary", ({ successfulUpgrades, failedValidations, skippedDevices }) => ({
    successCount: successfulUpgrades.length,
    failureCount: failedValidations.length,
    skippedCount: skippedDevices.length,
    successfulUpgrades,
    failedValidations,
    skippedDevices,
  }));
  track("sendAlertToITTeam", ({ summary }) => ({
    sent: true,
    failureCount: summary.failureCount,
  }));
  track("archiveUpgradeLogs", ({ summary }) => ({
    archived: true,
    totalDevices: summary.successCount + summary.failureCount + summary.skippedCount,
  }));

  return {
    calls,
    setScenario(patch) {
      Object.assign(scenario, patch);
    },
  };
}

export function defaultDevices() {
  return [
    { id: "device-1", model: "alpha" },
    { id: "device-2", model: "alpha" },
    { id: "device-3", model: "beta" },
  ];
}

function normalizeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
