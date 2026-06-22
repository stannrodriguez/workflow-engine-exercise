import { ActivityRegistry, InMemoryWorkflowRunStore, WorkflowEngine } from "./engine.js";

export function activity(definition) {
  validateDefinition(definition, "activity");

  return Object.freeze({
    kind: "activity",
    name: definition.name,
    run: definition.run,
  });
}

export function workflow(definition) {
  validateDefinition(definition, "workflow");

  return Object.freeze({
    kind: "workflow",
    name: definition.name,
    run: definition.run,
  });
}

export function createWorkflowEngine(options = {}) {
  const registry = options.registry ?? new ActivityRegistry();
  const store = options.store ?? new InMemoryWorkflowRunStore();
  const core = new WorkflowEngine({ registry, store });
  const registeredActivities = new Map();

  const facade = {
    registerActivity(activityDefinition) {
      validateActivity(activityDefinition);
      if (registeredActivities.has(activityDefinition.name)) {
        throw new Error(`Activity ${activityDefinition.name} is already registered.`);
      }

      registeredActivities.set(activityDefinition.name, activityDefinition);
      core.registerActivity(activityDefinition.name, activityDefinition.run);
      return facade;
    },

    async start(workflowDefinition, input, runOptions = {}) {
      validateWorkflow(workflowDefinition);
      const run = await core.start(
        toCoreWorkflow(workflowDefinition, registeredActivities),
        input,
        runOptions,
      );
      return wrapRunResult(run, facade, workflowDefinition);
    },

    async retry(workflowDefinition, runId) {
      validateWorkflow(workflowDefinition);
      const run = await core.retry(
        toCoreWorkflow(workflowDefinition, registeredActivities),
        runId,
      );
      return wrapRunResult(run, facade, workflowDefinition);
    },

    async replayFrom(workflowDefinition, runId, activityId) {
      validateWorkflow(workflowDefinition);
      const run = await core.replayFrom(
        toCoreWorkflow(workflowDefinition, registeredActivities),
        runId,
        activityId,
      );
      return wrapRunResult(run, facade, workflowDefinition);
    },

    get rawEngine() {
      return core;
    },

    get store() {
      return store;
    },
  };

  for (const activityDefinition of options.activities ?? []) {
    facade.registerActivity(activityDefinition);
  }

  return facade;
}

function toCoreWorkflow(workflowDefinition, registeredActivities) {
  return {
    name: workflowDefinition.name,
    execute: async (coreContext, input) => {
      const unkeyedStepCalls = new Map();
      const sdkContext = {
        input,
        step: async (activityDefinition, stepInput, stepOptions = {}) => {
          validateActivity(activityDefinition);
          if (!registeredActivities.has(activityDefinition.name)) {
            throw new Error(
              `Activity ${activityDefinition.name} is not registered with this engine.`,
            );
          }

          const activityId = getActivityId(
            activityDefinition,
            stepOptions,
            unkeyedStepCalls,
          );

          return coreContext.runActivity(activityDefinition.name, stepInput, {
            activityId,
          });
        },
      };

      return workflowDefinition.run(sdkContext);
    },
  };
}

function wrapRunResult(run, facade, workflowDefinition) {
  const failedActivity = run.activityExecutions.find(
    (execution) => execution.status === "failed",
  );

  return Object.freeze({
    id: run.id,
    status: run.state,
    state: run.state,
    workflowName: run.workflowName,
    input: run.input,
    output: run.output,
    error: run.error,
    activities: run.activityExecutions,
    failed: run.state === "failed",
    failedActivity,
    recoveryHint: failedActivity
      ? `Retry run ${run.id} to resume from ${failedActivity.activityId}, or replay from a specific activity ID.`
      : undefined,
    failureMessage: () => formatFailureMessage(run, failedActivity),
    timeline: () => run.activityExecutions.map(toTimelineEvent),
    retry: () => facade.retry(workflowDefinition, run.id),
    replayFrom: (activityId) => facade.replayFrom(workflowDefinition, run.id, activityId),
    raw: () => structuredClone(run),
  });
}

function getActivityId(activityDefinition, options, unkeyedStepCalls) {
  if (options.activityId) {
    return options.activityId;
  }

  if (options.key !== undefined) {
    return `${activityDefinition.name}:${normalizeKey(options.key)}`;
  }

  const count = unkeyedStepCalls.get(activityDefinition.name) ?? 0;
  if (count > 0) {
    throw new Error(
      `Activity ${activityDefinition.name} was called more than once without a stable key. ` +
        "Pass { key } for repeated or looped steps so retry/replay can identify the activity.",
    );
  }

  unkeyedStepCalls.set(activityDefinition.name, count + 1);
  return activityDefinition.name;
}

function toTimelineEvent(execution) {
  return {
    sequence: execution.sequence,
    activityId: execution.activityId,
    activityName: execution.activityName,
    status: execution.status,
    attempt: execution.attempt,
    inputSummary: summarize(execution.input),
    outputSummary: execution.output === undefined ? undefined : summarize(execution.output),
    errorMessage: execution.error?.message,
    cachedFromSequence: execution.cachedFromSequence,
  };
}

function formatFailureMessage(run, failedActivity) {
  if (!failedActivity) {
    return undefined;
  }

  return [
    `Workflow ${run.workflowName} failed at activity ${failedActivity.activityName}.`,
    `Activity ID: ${failedActivity.activityId}`,
    `Cause: ${failedActivity.error.message}`,
    `Recovery: retry("${run.id}") will resume from this activity.`,
  ].join("\n");
}

function validateDefinition(definition, kind) {
  if (!definition || typeof definition !== "object") {
    throw new Error(`${kind} definition must be an object.`);
  }

  if (!definition.name || typeof definition.name !== "string") {
    throw new Error(`${kind} definition requires a non-empty name.`);
  }

  if (typeof definition.run !== "function") {
    throw new Error(`${kind} ${definition.name} requires a run function.`);
  }
}

function validateActivity(activityDefinition) {
  if (activityDefinition?.kind !== "activity") {
    throw new Error("step() expects an activity created with activity().");
  }

  validateDefinition(activityDefinition, "activity");
}

function validateWorkflow(workflowDefinition) {
  if (workflowDefinition?.kind !== "workflow") {
    throw new Error("Engine methods expect a workflow created with workflow().");
  }

  validateDefinition(workflowDefinition, "workflow");
}

function normalizeKey(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-");
}

function summarize(value) {
  const json = JSON.stringify(value);
  if (!json) {
    return String(value);
  }

  return json.length <= 160 ? json : `${json.slice(0, 157)}...`;
}
