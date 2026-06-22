import { randomUUID } from "node:crypto";

export class ActivityRegistry {
  #handlers = new Map();

  register(name, handler) {
    if (this.#handlers.has(name)) {
      throw new Error(`Activity ${name} is already registered.`);
    }

    this.#handlers.set(name, handler);
  }

  get(name) {
    const handler = this.#handlers.get(name);
    if (!handler) {
      throw new Error(`Activity ${name} is not registered.`);
    }

    return handler;
  }
}

export class InMemoryWorkflowRunStore {
  #runs = new Map();

  createRun({ workflowName, input, runId = randomUUID() }) {
    if (this.#runs.has(runId)) {
      throw new Error(`Workflow run ${runId} already exists.`);
    }

    const run = {
      id: runId,
      workflowName,
      state: "created",
      input,
      output: undefined,
      error: undefined,
      activityExecutions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.#runs.set(runId, run);
    return run;
  }

  getRun(runId) {
    return this.#runs.get(runId);
  }

  requireRun(runId) {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run ${runId} was not found.`);
    }

    return run;
  }

  reset() {
    this.#runs.clear();
  }
}

export class WorkflowEngine {
  constructor({ registry = new ActivityRegistry(), store = new InMemoryWorkflowRunStore() } = {}) {
    this.registry = registry;
    this.store = store;
  }

  registerActivity(name, handler) {
    this.registry.register(name, handler);
  }

  async start(workflow, input, options = {}) {
    const run = this.store.createRun({
      workflowName: workflow.name,
      input,
      runId: options.runId,
    });

    return this.#executeRun(workflow, run);
  }

  async retry(workflow, runId) {
    const run = this.store.requireRun(runId);
    if (run.state !== "failed") {
      throw new Error(`Cannot retry workflow run in ${run.state} state.`);
    }

    const failed = run.activityExecutions.find((activity) => activity.status === "failed");
    if (!failed) {
      throw new Error(`Workflow run ${runId} failed without a failed activity.`);
    }

    this.#clearHistoryFrom(run, failed.activityId);
    return this.#executeRun(workflow, run);
  }

  async replayFrom(workflow, runId, activityId) {
    const run = this.store.requireRun(runId);
    this.#clearHistoryFrom(run, activityId);
    return this.#executeRun(workflow, run);
  }

  #clearHistoryFrom(run, activityId) {
    const target = run.activityExecutions.find(
      (activity) => activity.activityId === activityId,
    );

    if (!target) {
      throw new Error(`Activity ${activityId} was not found in run ${run.id}.`);
    }

    run.activityExecutions = run.activityExecutions.filter(
      (activity) => activity.sequence < target.sequence,
    );
    run.output = undefined;
    run.error = undefined;
    run.state = "created";
    run.updatedAt = new Date().toISOString();
  }

  async #executeRun(workflow, run) {
    run.state = "running";
    run.error = undefined;
    run.updatedAt = new Date().toISOString();

    const context = this.#createContext(run);

    try {
      run.output = await workflow.execute(context, run.input);
      run.state = "completed";
    } catch (error) {
      run.state = "failed";
      run.error = serializeError(error);
    }

    run.updatedAt = new Date().toISOString();
    return structuredClone(run);
  }

  #createContext(run) {
    return {
      runActivity: async (activityName, input, options = {}) => {
        const activityId = options.activityId ?? activityName;
        const existing = run.activityExecutions.find(
          (activity) => activity.activityId === activityId,
        );

        if (existing?.status === "succeeded") {
          run.activityExecutions.push({
            ...existing,
            sequence: nextSequence(run),
            status: "skipped",
            cachedFromSequence: existing.sequence,
            skippedAt: new Date().toISOString(),
          });
          return structuredClone(existing.output);
        }

        if (existing?.status === "failed") {
          throw activityError(existing.activityName, existing.error);
        }

        const execution = {
          sequence: nextSequence(run),
          activityId,
          activityName,
          status: "running",
          input: structuredClone(input),
          output: undefined,
          error: undefined,
          attempt: attemptsFor(run, activityId) + 1,
          startedAt: new Date().toISOString(),
          completedAt: undefined,
        };

        run.activityExecutions.push(execution);

        try {
          const handler = this.registry.get(activityName);
          execution.output = await handler(input, {
            runId: run.id,
            activityId,
            attempt: execution.attempt,
          });
          execution.status = "succeeded";
          execution.completedAt = new Date().toISOString();
          return structuredClone(execution.output);
        } catch (error) {
          execution.status = "failed";
          execution.error = serializeError(error);
          execution.completedAt = new Date().toISOString();
          throw activityError(activityName, execution.error);
        }
      },
    };
  }
}

function nextSequence(run) {
  return run.activityExecutions.reduce(
    (max, activity) => Math.max(max, activity.sequence),
    0,
  ) + 1;
}

function attemptsFor(run, activityId) {
  return run.activityExecutions.filter(
    (activity) => activity.activityId === activityId,
  ).length;
}

function serializeError(error) {
  if (error && typeof error === "object") {
    return {
      name: error.name ?? "Error",
      message: error.message ?? String(error),
      stack: error.stack,
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: undefined,
  };
}

function activityError(activityName, serializedError) {
  const error = new Error(`Activity ${activityName} failed: ${serializedError.message}`);
  error.name = "ActivityFailure";
  error.cause = serializedError;
  return error;
}
