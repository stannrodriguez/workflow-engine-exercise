export type ActivityContext = {
  runId: string;
  activityId: string;
  attempt: number;
};

export type ActivityDefinition<Input = unknown, Output = unknown> = {
  kind: "activity";
  name: string;
  run(input: Input, context: ActivityContext): Promise<Output> | Output;
};

export type StepOptions = {
  key?: string | number;
  activityId?: string;
};

export type StepFunction = <Input, Output>(
  activity: ActivityDefinition<Input, Output>,
  input: Input,
  options?: StepOptions,
) => Promise<Output>;

export type WorkflowSdkContext<Input> = {
  input: Input;
  step: StepFunction;
};

export type WorkflowDefinition<Input = unknown, Output = unknown> = {
  kind: "workflow";
  name: string;
  run(context: WorkflowSdkContext<Input>): Promise<Output> | Output;
};

export type WorkflowSpec = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  steps: WorkflowStep[];
};

export type WorkflowStep =
  | {
      type: "activity";
      id: string;
      activity: string;
      input: Record<string, unknown>;
      output?: string;
      key?: string;
    }
  | {
      type: "for_each";
      id: string;
      items: string;
      itemName: string;
      steps: WorkflowStep[];
    }
  | {
      type: "if";
      id: string;
      condition: string;
      then: WorkflowStep[];
      else?: WorkflowStep[];
    };

export type WorkflowGraphNode = {
  id: string;
  label: string;
  kind: "activity" | "for_each" | "if";
  description: string;
  depth: number;
  parentId?: string;
  activityName?: string;
};

export type WorkflowGraph = {
  title: string;
  nodes: WorkflowGraphNode[];
};

export type ActivityExecutionStatus = "running" | "succeeded" | "failed" | "skipped";
export type WorkflowRunStatus = "created" | "running" | "completed" | "failed";

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

export type ActivityExecution = {
  sequence: number;
  activityId: string;
  activityName: string;
  status: ActivityExecutionStatus;
  input: unknown;
  output?: unknown;
  error?: SerializedError;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  cachedFromSequence?: number;
};

export type TimelineEvent = {
  sequence: number;
  activityId: string;
  activityName: string;
  status: ActivityExecutionStatus;
  attempt: number;
  inputSummary: string;
  outputSummary?: string;
  errorMessage?: string;
  cachedFromSequence?: number;
};

export type WorkflowRunResult<Output = unknown> = {
  id: string;
  status: WorkflowRunStatus;
  state: WorkflowRunStatus;
  workflowName: string;
  input: unknown;
  output?: Output;
  error?: SerializedError;
  activities: ActivityExecution[];
  failed: boolean;
  failedActivity?: ActivityExecution;
  recoveryHint?: string;
  failureMessage(): string | undefined;
  timeline(): TimelineEvent[];
  retry(): Promise<WorkflowRunResult<Output>>;
  replayFrom(activityId: string): Promise<WorkflowRunResult<Output>>;
  raw(): unknown;
};

export type WorkflowRunStore = {
  createRun(input: { workflowName: string; input: unknown; runId?: string }): unknown;
  getRun(runId: string): unknown;
  requireRun(runId: string): unknown;
  reset(): void;
};

export type WorkflowEngineFacade = {
  registerActivity(activity: ActivityDefinition<any, any>): WorkflowEngineFacade;
  start<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    input: Input,
    options?: { runId?: string },
  ): Promise<WorkflowRunResult<Output>>;
  retry<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    runId: string,
  ): Promise<WorkflowRunResult<Output>>;
  replayFrom<Input, Output>(
    workflow: WorkflowDefinition<Input, Output>,
    runId: string,
    activityId: string,
  ): Promise<WorkflowRunResult<Output>>;
  rawEngine: WorkflowEngine;
  store: WorkflowRunStore;
};

export declare function activity<Input, Output>(definition: {
  name: string;
  run(input: Input, context: ActivityContext): Promise<Output> | Output;
}): ActivityDefinition<Input, Output>;

export declare function workflow<Input, Output>(definition: {
  name: string;
  run(context: WorkflowSdkContext<Input>): Promise<Output> | Output;
}): WorkflowDefinition<Input, Output>;

export declare function createWorkflowEngine(options?: {
  activities?: ActivityDefinition<any, any>[];
  store?: WorkflowRunStore;
}): WorkflowEngineFacade;

export declare function compileWorkflowFromNaturalLanguage(
  text: string,
): WorkflowSpec;

export declare function validateWorkflowSpec(
  spec: WorkflowSpec,
  activities: ActivityDefinition<any, any>[] | Record<string, ActivityDefinition<any, any>>,
): { ok: true };

export declare function createWorkflowFromSpec<Input = unknown, Output = unknown>(
  spec: WorkflowSpec,
  activities: ActivityDefinition<any, any>[] | Record<string, ActivityDefinition<any, any>>,
): WorkflowDefinition<Input, Output>;

export declare function workflowSpecToGraph(spec: WorkflowSpec): WorkflowGraph;

export declare class ActivityRegistry {
  register(name: string, handler: (input: unknown, context: ActivityContext) => unknown): void;
  get(name: string): (input: unknown, context: ActivityContext) => unknown;
}

export declare class InMemoryWorkflowRunStore implements WorkflowRunStore {
  createRun(input: { workflowName: string; input: unknown; runId?: string }): unknown;
  getRun(runId: string): unknown;
  requireRun(runId: string): unknown;
  reset(): void;
}

export declare class WorkflowEngine {
  constructor(options?: { registry?: ActivityRegistry; store?: InMemoryWorkflowRunStore });
  registerActivity(name: string, handler: (input: unknown, context: ActivityContext) => unknown): void;
  start(workflow: unknown, input: unknown, options?: { runId?: string }): Promise<unknown>;
  retry(workflow: unknown, runId: string): Promise<unknown>;
  replayFrom(workflow: unknown, runId: string, activityId: string): Promise<unknown>;
}
