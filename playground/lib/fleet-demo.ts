import {
  activity as sdkActivity,
  createWorkflowEngine as sdkCreateWorkflowEngine,
  workflow as sdkWorkflow,
} from "../../src/index.js";

type ActivityContext = {
  activityId: string;
  attempt: number;
  runId: string;
};

type ActivityDefinition<Input = unknown, Output = unknown> = {
  kind: "activity";
  name: string;
  run(input: Input, context: ActivityContext): Promise<Output> | Output;
};

type WorkflowSdkContext<Input> = {
  input: Input;
  step: <StepInput, StepOutput>(
    activity: ActivityDefinition<StepInput, StepOutput>,
    input: StepInput,
    options?: { activityId?: string; key?: number | string },
  ) => Promise<StepOutput>;
};

type WorkflowDefinition<Input = unknown, Output = unknown> = {
  kind: "workflow";
  name: string;
  run(context: WorkflowSdkContext<Input>): Promise<Output> | Output;
};

type SerializedError = {
  message: string;
  name: string;
  stack?: string;
};

type ActivityExecution = {
  activityId: string;
  activityName: string;
  attempt: number;
  cachedFromSequence?: number;
  completedAt?: string;
  error?: SerializedError;
  input: unknown;
  output?: unknown;
  sequence: number;
  startedAt: string;
  status: "failed" | "running" | "skipped" | "succeeded";
};

type WorkflowRunResult<Output = unknown> = {
  activities: ActivityExecution[];
  error?: SerializedError;
  failed: boolean;
  failedActivity?: ActivityExecution;
  id: string;
  input: unknown;
  output?: Output;
  recoveryHint?: string;
  status: "completed" | "created" | "failed" | "running";
  workflowName: string;
};

type WorkflowEngineFacade = {
  replayFrom<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    runId: string,
    activityId: string,
  ): Promise<WorkflowRunResult<Output>>;
  retry<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    runId: string,
  ): Promise<WorkflowRunResult<Output>>;
  start<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    input: Input,
    options?: { runId?: string },
  ): Promise<WorkflowRunResult<Output>>;
};

const activity = sdkActivity as <Input, Output>(definition: {
  name: string;
  run(input: Input, context: ActivityContext): Promise<Output> | Output;
}) => ActivityDefinition<Input, Output>;

const workflow = sdkWorkflow as <Input, Output>(definition: {
  name: string;
  run(context: WorkflowSdkContext<Input>): Promise<Output> | Output;
}) => WorkflowDefinition<Input, Output>;

const createWorkflowEngine = sdkCreateWorkflowEngine as (options?: {
  activities?: ActivityDefinition[];
}) => WorkflowEngineFacade;

type Device = {
  id: string;
  model: string;
};

type DeviceGroup = {
  model: string;
  devices: Device[];
};

type FirmwareSpec = {
  model: string;
  version: string;
};

type FirmwarePackage = FirmwareSpec & {
  checksum: string;
};

type InstallResult = {
  deviceId: string;
  model: string;
  version: string;
  installedAt: string;
};

type ValidationResult = {
  deviceId: string;
  status: "SUCCESS" | "FAILED";
  version: string;
};

type UpgradeRecord = {
  deviceId: string;
  model: string;
  version?: string;
  status?: string;
  healthStatus?: string;
};

export type UpgradeSummary = {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successfulUpgrades: UpgradeRecord[];
  failedValidations: UpgradeRecord[];
  skippedDevices: UpgradeRecord[];
};

type FleetInput = {
  fleetId: string;
};

type ScenarioPatch = {
  devices?: Device[];
  failDownloadForModel?: string;
  firmwareVersions?: Record<string, string>;
  healthByDeviceId?: Record<string, string>;
  validationByDeviceId?: Record<string, "SUCCESS" | "FAILED">;
};

type ScenarioDefinition = {
  label: string;
  patch: ScenarioPatch;
  retryPatch?: ScenarioPatch;
};

type DemoSession = {
  controls: {
    setScenario(patch: ScenarioPatch): void;
  };
  engine: WorkflowEngineFacade;
  scenario: ScenarioDefinition;
  scenarioName: string;
  workflow: WorkflowDefinition<FleetInput, UpgradeSummary>;
};

type FleetActivitySet = {
  archiveUpgradeLogs: ActivityDefinition<
    { summary: UpgradeSummary },
    { archived: boolean; totalDevices: number }
  >;
  checkDeviceHealth: ActivityDefinition<{ device: Device }, string>;
  downloadFirmwarePackage: ActivityDefinition<
    { model: string; firmwareSpec: FirmwareSpec },
    FirmwarePackage
  >;
  generateUpgradeSummary: ActivityDefinition<
    {
      failedValidations: UpgradeRecord[];
      skippedDevices: UpgradeRecord[];
      successfulUpgrades: UpgradeRecord[];
    },
    UpgradeSummary
  >;
  getFirmwareRequirements: ActivityDefinition<{ model: string }, FirmwareSpec>;
  getFleetDeviceList: ActivityDefinition<FleetInput, Device[]>;
  groupDevicesByModel: ActivityDefinition<{ devices: Device[] }, DeviceGroup[]>;
  installFirmware: ActivityDefinition<
    { device: Device; firmware: FirmwarePackage },
    InstallResult
  >;
  recordFailedValidation: ActivityDefinition<
    { device: Device; validationResult: ValidationResult },
    UpgradeRecord
  >;
  recordSkippedDevice: ActivityDefinition<
    { device: Device; healthStatus: string },
    UpgradeRecord
  >;
  recordSuccessfulUpgrade: ActivityDefinition<
    { device: Device; installResult: InstallResult; validationResult: ValidationResult },
    UpgradeRecord
  >;
  sendAlertToITTeam: ActivityDefinition<
    { summary: UpgradeSummary },
    { failureCount: number; sent: boolean }
  >;
  validateInstallation: ActivityDefinition<
    { device: Device; installResult: InstallResult },
    ValidationResult
  >;
};

declare global {
  var workflowVisualizerSessions: Map<string, DemoSession> | undefined;
}

const sessions =
  globalThis.workflowVisualizerSessions ??
  (globalThis.workflowVisualizerSessions = new Map<string, DemoSession>());

export function getWorkflowGraph() {
  return {
    title: "FleetUpgradeWorkflow",
    nodes: [
      {
        id: "intake",
        label: "Get fleet device list",
        activityName: "getFleetDeviceList",
        kind: "source",
        description: "Loads the fleet inventory for the requested fleet.",
      },
      {
        id: "group",
        label: "Group devices by model",
        activityName: "groupDevicesByModel",
        kind: "transform",
        description: "Creates model groups so firmware work can be batched.",
      },
      {
        id: "requirements",
        label: "Get firmware requirements",
        activityName: "getFirmwareRequirements",
        kind: "lookup",
        description: "Finds target firmware for each model.",
      },
      {
        id: "download",
        label: "Download firmware package",
        activityName: "downloadFirmwarePackage",
        kind: "tool",
        description: "External package fetch. This is the retry demo failure point.",
      },
      {
        id: "health",
        label: "Check device health",
        activityName: "checkDeviceHealth",
        kind: "gate",
        description: "Skips devices that are not ready for upgrade.",
      },
      {
        id: "install",
        label: "Install firmware",
        activityName: "installFirmware",
        kind: "tool",
        description: "Applies the firmware package to each ready device.",
      },
      {
        id: "validate",
        label: "Validate installation",
        activityName: "validateInstallation",
        kind: "gate",
        description: "Confirms the installed firmware is usable.",
      },
      {
        id: "record",
        label: "Record device outcome",
        activityNames: [
          "recordSuccessfulUpgrade",
          "recordFailedValidation",
          "recordSkippedDevice",
        ],
        kind: "write",
        description: "Writes success, validation failure, or skip evidence.",
      },
      {
        id: "summary",
        label: "Generate upgrade summary",
        activityName: "generateUpgradeSummary",
        kind: "summary",
        description: "Aggregates success, failure, and skipped counts.",
      },
      {
        id: "alert",
        label: "Send alert if failures",
        activityName: "sendAlertToITTeam",
        kind: "branch",
        description: "Notifies IT only if validation failures happened.",
      },
      {
        id: "archive",
        label: "Archive upgrade logs",
        activityName: "archiveUpgradeLogs",
        kind: "sink",
        description: "Stores final logs after the workflow completes.",
      },
    ],
  };
}

export async function startDemoRun(scenarioName = "healthy") {
  const session = createDemoSession(scenarioName);
  const result = await session.engine.start(
    session.workflow,
    { fleetId: "fleet-demo" },
    { runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  );

  sessions.set(result.id, session);
  return serializeRun(result, session);
}

export async function retryDemoRun(runId: string) {
  const session = requireSession(runId);
  if (session.scenario.retryPatch) {
    session.controls.setScenario(session.scenario.retryPatch);
  }

  const result = await session.engine.retry(session.workflow, runId);
  return serializeRun(result, session);
}

export async function replayDemoRun(
  runId: string,
  activityId: string,
  options: { applyReplayPatch?: boolean } = {},
) {
  const session = requireSession(runId);
  if (options.applyReplayPatch) {
    session.controls.setScenario({
      healthByDeviceId: { "device-2": "NEEDS_ATTENTION" },
    });
  }

  const result = await session.engine.replayFrom(
    session.workflow,
    runId,
    activityId,
  );

  return serializeRun(result, session);
}

function createDemoSession(scenarioName: string): DemoSession {
  const scenario = scenarioForName(scenarioName);
  const mutableScenario = structuredClone(scenario.patch);
  const activities = createFleetActivities(mutableScenario);
  const engine = createWorkflowEngine({ activities: Object.values(activities) });
  const workflowDefinition = createFleetWorkflow(activities);

  return {
    controls: {
      setScenario(patch) {
        Object.assign(mutableScenario, patch);
      },
    },
    engine,
    scenario,
    scenarioName,
    workflow: workflowDefinition,
  };
}

function createFleetWorkflow(activities: FleetActivitySet) {
  const {
    archiveUpgradeLogs,
    checkDeviceHealth,
    downloadFirmwarePackage,
    generateUpgradeSummary,
    getFirmwareRequirements,
    getFleetDeviceList,
    groupDevicesByModel,
    installFirmware,
    recordFailedValidation,
    recordSkippedDevice,
    recordSuccessfulUpgrade,
    sendAlertToITTeam,
    validateInstallation,
  } = activities;

  return workflow<FleetInput, UpgradeSummary>({
    name: "FleetUpgradeWorkflow",
    run: async ({ input, step }) => {
      const devices = await step(getFleetDeviceList, input);
      const deviceGroups = await step(groupDevicesByModel, { devices });
      const successfulUpgrades: UpgradeRecord[] = [];
      const failedValidations: UpgradeRecord[] = [];
      const skippedDevices: UpgradeRecord[] = [];

      for (const deviceGroup of deviceGroups) {
        const firmwareSpec = await step(
          getFirmwareRequirements,
          { model: deviceGroup.model },
          { key: deviceGroup.model },
        );
        const firmware = await step(
          downloadFirmwarePackage,
          { model: deviceGroup.model, firmwareSpec },
          { key: deviceGroup.model },
        );

        for (const device of deviceGroup.devices) {
          const healthStatus = await step(
            checkDeviceHealth,
            { device },
            { key: device.id },
          );

          if (healthStatus !== "READY") {
            const skipped = await step(
              recordSkippedDevice,
              { device, healthStatus },
              { key: device.id },
            );
            skippedDevices.push(skipped);
            continue;
          }

          const installResult = await step(
            installFirmware,
            { device, firmware },
            { key: device.id },
          );
          const validationResult = await step(
            validateInstallation,
            { device, installResult },
            { key: device.id },
          );

          if (validationResult.status === "SUCCESS") {
            const success = await step(
              recordSuccessfulUpgrade,
              { device, installResult, validationResult },
              { key: device.id },
            );
            successfulUpgrades.push(success);
          } else {
            const failedValidation = await step(
              recordFailedValidation,
              { device, validationResult },
              { key: device.id },
            );
            failedValidations.push(failedValidation);
          }
        }
      }

      const summary = await step(generateUpgradeSummary, {
        failedValidations,
        skippedDevices,
        successfulUpgrades,
      });

      if (summary.failureCount > 0) {
        await step(sendAlertToITTeam, { summary });
      }

      await step(archiveUpgradeLogs, { summary });
      return summary;
    },
  });
}

function createFleetActivities(
  scenario: ScenarioPatch,
): FleetActivitySet {
  return {
    getFleetDeviceList: activity<FleetInput, Device[]>({
      name: "getFleetDeviceList",
      run: () => scenario.devices ?? defaultDevices(),
    }),
    groupDevicesByModel: activity<{ devices: Device[] }, DeviceGroup[]>({
      name: "groupDevicesByModel",
      run: ({ devices }) => {
        const groups = new Map<string, Device[]>();
        for (const device of devices) {
          const existing = groups.get(device.model) ?? [];
          existing.push(device);
          groups.set(device.model, existing);
        }

        return Array.from(groups.entries()).map(([model, groupedDevices]) => ({
          devices: groupedDevices,
          model,
        }));
      },
    }),
    getFirmwareRequirements: activity<{ model: string }, FirmwareSpec>({
      name: "getFirmwareRequirements",
      run: ({ model }) => ({
        model,
        version: scenario.firmwareVersions?.[model] ?? "2026.6.0",
      }),
    }),
    downloadFirmwarePackage: activity<
      { model: string; firmwareSpec: FirmwareSpec },
      FirmwarePackage
    >({
      name: "downloadFirmwarePackage",
      run: ({ model, firmwareSpec }) => {
        if (scenario.failDownloadForModel === model) {
          throw new Error(`Firmware package for ${model} is temporarily unavailable.`);
        }

        return {
          checksum: `${model}:${firmwareSpec.version}:checksum`,
          model,
          version: firmwareSpec.version,
        };
      },
    }),
    checkDeviceHealth: activity<{ device: Device }, string>({
      name: "checkDeviceHealth",
      run: ({ device }) => scenario.healthByDeviceId?.[device.id] ?? "READY",
    }),
    installFirmware: activity<
      { device: Device; firmware: FirmwarePackage },
      InstallResult
    >({
      name: "installFirmware",
      run: ({ device, firmware }) => ({
        deviceId: device.id,
        installedAt: "2026-06-22T10:00:00.000Z",
        model: device.model,
        version: firmware.version,
      }),
    }),
    validateInstallation: activity<
      { device: Device; installResult: InstallResult },
      ValidationResult
    >({
      name: "validateInstallation",
      run: ({ device, installResult }) => ({
        deviceId: device.id,
        status: scenario.validationByDeviceId?.[device.id] ?? "SUCCESS",
        version: installResult.version,
      }),
    }),
    recordSuccessfulUpgrade: activity<
      { device: Device; installResult: InstallResult; validationResult: ValidationResult },
      UpgradeRecord
    >({
      name: "recordSuccessfulUpgrade",
      run: ({ device, installResult }) => ({
        deviceId: device.id,
        model: device.model,
        version: installResult.version,
      }),
    }),
    recordFailedValidation: activity<{ device: Device; validationResult: ValidationResult }, UpgradeRecord>({
      name: "recordFailedValidation",
      run: ({ device, validationResult }) => ({
        deviceId: device.id,
        model: device.model,
        status: validationResult.status,
      }),
    }),
    recordSkippedDevice: activity<{ device: Device; healthStatus: string }, UpgradeRecord>({
      name: "recordSkippedDevice",
      run: ({ device, healthStatus }) => ({
        deviceId: device.id,
        healthStatus,
        model: device.model,
      }),
    }),
    generateUpgradeSummary: activity<
      {
        failedValidations: UpgradeRecord[];
        skippedDevices: UpgradeRecord[];
        successfulUpgrades: UpgradeRecord[];
      },
      UpgradeSummary
    >({
      name: "generateUpgradeSummary",
      run: ({ failedValidations, skippedDevices, successfulUpgrades }) => ({
        failedValidations,
        failureCount: failedValidations.length,
        skippedCount: skippedDevices.length,
        skippedDevices,
        successCount: successfulUpgrades.length,
        successfulUpgrades,
      }),
    }),
    sendAlertToITTeam: activity<{ summary: UpgradeSummary }, { failureCount: number; sent: boolean }>({
      name: "sendAlertToITTeam",
      run: ({ summary }) => ({
        failureCount: summary.failureCount,
        sent: true,
      }),
    }),
    archiveUpgradeLogs: activity<{ summary: UpgradeSummary }, { archived: boolean; totalDevices: number }>({
      name: "archiveUpgradeLogs",
      run: ({ summary }) => ({
        archived: true,
        totalDevices:
          summary.successCount + summary.failureCount + summary.skippedCount,
      }),
    }),
  };
}

function serializeRun(result: WorkflowRunResult<UpgradeSummary>, session: DemoSession) {
  return {
    error: result.error,
    failed: result.failed,
    failedActivity: result.failedActivity,
    id: result.id,
    input: result.input,
    output: result.output,
    recoveryHint: result.recoveryHint,
    scenario: {
      label: session.scenario.label,
      name: session.scenarioName,
    },
    stats: summarizeActivities(result.activities),
    status: result.status,
    timeline: result.activities.map((activityExecution) => ({
      ...activityExecution,
      evidence: evidenceFor(activityExecution),
    })),
    workflowName: result.workflowName,
  };
}

function summarizeActivities(activities: ActivityExecution[]) {
  const counts = activities.reduce(
    (summary, activityExecution) => {
      summary[activityExecution.status] += 1;
      return summary;
    },
    { failed: 0, running: 0, skipped: 0, succeeded: 0 },
  );

  return {
    activityCount: activities.length,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    succeededCount: counts.succeeded,
  };
}

function evidenceFor(activityExecution: ActivityExecution) {
  if (activityExecution.status === "failed") {
    return activityExecution.error?.message ?? "Activity failed.";
  }

  if (activityExecution.status === "skipped") {
    return `Cached from sequence ${activityExecution.cachedFromSequence}.`;
  }

  if (activityExecution.output === undefined) {
    return "No output.";
  }

  if (Array.isArray(activityExecution.output)) {
    return `${activityExecution.output.length} items.`;
  }

  if (activityExecution.output && typeof activityExecution.output === "object") {
    return Object.entries(activityExecution.output)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} items` : value}`)
      .join(", ");
  }

  return String(activityExecution.output);
}

function requireSession(runId: string) {
  const session = sessions.get(runId);
  if (!session) {
    throw new Error(`Run ${runId} is not active in this visualizer session.`);
  }

  return session;
}

function scenarioForName(name: string): ScenarioDefinition {
  if (name === "download-failure") {
    return {
      label: "Retryable download failure",
      patch: { failDownloadForModel: "alpha" },
      retryPatch: { failDownloadForModel: undefined },
    };
  }

  if (name === "validation-failure") {
    return {
      label: "Validation failure with alert",
      patch: { validationByDeviceId: { "device-2": "FAILED" } },
    };
  }

  if (name === "skipped-device") {
    return {
      label: "Skipped device",
      patch: { healthByDeviceId: { "device-3": "NEEDS_ATTENTION" } },
    };
  }

  return {
    label: "Healthy fleet",
    patch: {},
  };
}

function defaultDevices(): Device[] {
  return [
    { id: "device-1", model: "alpha" },
    { id: "device-2", model: "alpha" },
    { id: "device-3", model: "beta" },
  ];
}
