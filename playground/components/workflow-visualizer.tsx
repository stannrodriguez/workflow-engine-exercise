"use client";

import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  RefreshCcw,
  RotateCcw,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type WorkflowSpec = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  steps: WorkflowStep[];
};

type WorkflowStep =
  | {
      activity: string;
      id: string;
      input: Record<string, unknown>;
      key?: string;
      output?: string;
      type: "activity";
    }
  | {
      id: string;
      itemName: string;
      items: string;
      steps: WorkflowStep[];
      type: "for_each";
    }
  | {
      condition: string;
      else?: WorkflowStep[];
      id: string;
      then: WorkflowStep[];
      type: "if";
    };

type WorkflowNode = {
  activityName?: string;
  depth: number;
  description: string;
  id: string;
  kind: "activity" | "for_each" | "if";
  label: string;
  parentId?: string;
};

type WorkflowGraph = {
  nodes: WorkflowNode[];
  title: string;
};

type CompilePayload = {
  sourceText: string;
  spec: WorkflowSpec;
  workflow: WorkflowGraph;
};

type ActivityExecution = {
  activityId: string;
  activityName: string;
  attempt: number;
  cachedFromSequence?: number;
  error?: { message: string; name: string };
  evidence: string;
  input: unknown;
  output?: unknown;
  sequence: number;
  status: "running" | "succeeded" | "failed" | "skipped";
};

type DemoRun = {
  error?: { message: string; name: string };
  failed: boolean;
  failedActivity?: ActivityExecution;
  id: string;
  output?: unknown;
  recoveryHint?: string;
  scenario: {
    label: string;
    name: string;
  };
  stats: {
    activityCount: number;
    failedCount: number;
    skippedCount: number;
    succeededCount: number;
  };
  status: "created" | "running" | "completed" | "failed";
  timeline: ActivityExecution[];
  workflowName: string;
};

const scenarios = [
  {
    description: "All activities complete successfully.",
    icon: CheckCircle2,
    label: "Healthy fleet",
    value: "healthy",
  },
  {
    description: "Firmware download fails, then retry resumes from the failure.",
    icon: RefreshCcw,
    label: "Retryable failure",
    value: "download-failure",
  },
  {
    description: "Workflow completes, records validation failure, and alerts IT.",
    icon: AlertTriangle,
    label: "Validation failure",
    value: "validation-failure",
  },
  {
    description: "One device is not ready and is skipped.",
    icon: GitBranch,
    label: "Skipped device",
    value: "skipped-device",
  },
] as const;

export function WorkflowVisualizer() {
  const [sourceText, setSourceText] = useState("");
  const [spec, setSpec] = useState<WorkflowSpec | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowGraph | null>(null);
  const [run, setRun] = useState<DemoRun | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [applyReplayPatch, setApplyReplayPatch] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<CompilePayload>("/api/workflow")
      .then((payload) => {
        setSourceText(payload.sourceText);
        setSpec(payload.spec);
        setWorkflow(payload.workflow);
      })
      .catch((caughtError: unknown) =>
        setError(caughtError instanceof Error ? caughtError.message : "Load failed."),
      );
  }, []);

  const selectedActivity = useMemo(() => {
    return run?.timeline.find((activity) => activity.activityId === selectedActivityId);
  }, [run, selectedActivityId]);

  const specStats = useMemo(() => countSpecSteps(spec), [spec]);

  const nodeStatuses = useMemo(() => {
    const statuses = new Map<string, ActivityExecution["status"] | "pending">();
    if (!workflow || !run) {
      return statuses;
    }

    for (const node of workflow.nodes) {
      const events = node.activityName
        ? run.timeline.filter(
            (activity) => activity.activityName === node.activityName,
          )
        : [];

      if (events.some((activity) => activity.status === "failed")) {
        statuses.set(node.id, "failed");
      } else if (events.some((activity) => activity.status === "running")) {
        statuses.set(node.id, "running");
      } else if (events.some((activity) => activity.status === "skipped")) {
        statuses.set(node.id, "skipped");
      } else if (events.some((activity) => activity.status === "succeeded")) {
        statuses.set(node.id, "succeeded");
      } else {
        statuses.set(node.id, "pending");
      }
    }

    return statuses;
  }, [run, workflow]);

  async function compileWorkflow() {
    await mutate(async () => {
      const payload = await fetchJson<CompilePayload>("/api/workflow/compile", {
        method: "POST",
        body: JSON.stringify({ text: sourceText }),
      });
      setSourceText(payload.sourceText);
      setSpec(payload.spec);
      setWorkflow(payload.workflow);
      setRun(null);
      setSelectedActivityId(null);
    });
  }

  async function runScenario(scenario: string) {
    if (!spec) {
      setError("Compile a workflow before running it.");
      return;
    }

    await mutate(async () => {
      const payload = await fetchJson<{ run: DemoRun }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ scenario, spec }),
      });
      setRun(payload.run);
      setSelectedActivityId(
        payload.run.failedActivity?.activityId ??
          payload.run.timeline.at(-1)?.activityId ??
          null,
      );
    });
  }

  async function retryRun() {
    if (!run) {
      return;
    }

    await mutate(async () => {
      const payload = await fetchJson<{ run: DemoRun }>(`/api/runs/${run.id}/retry`, {
        method: "POST",
      });
      setRun(payload.run);
      setSelectedActivityId(
        payload.run.timeline.find((activity) => activity.status === "skipped")
          ?.activityId ?? payload.run.timeline.at(-1)?.activityId ?? null,
      );
    });
  }

  async function replayRun() {
    if (!run || !selectedActivityId) {
      return;
    }

    await mutate(async () => {
      const payload = await fetchJson<{ run: DemoRun }>(`/api/runs/${run.id}/replay`, {
        method: "POST",
        body: JSON.stringify({
          activityId: selectedActivityId,
          applyReplayPatch,
        }),
      });
      setRun(payload.run);
    });
  }

  async function mutate(work: () => Promise<void>) {
    setIsMutating(true);
    setError(null);

    try {
      await work();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Request failed.",
      );
    } finally {
      setIsMutating(false);
    }
  }

  function selectNode(node: WorkflowNode) {
    if (!run || !node.activityName) {
      return;
    }

    const events = run.timeline.filter(
      (activity) => activity.activityName === node.activityName,
    );
    const activity =
      events.find((item) => item.status === "failed") ?? events.at(-1) ?? null;
    setSelectedActivityId(activity?.activityId ?? null);
  }

  return (
    <main className="min-h-screen bg-muted/30 px-5 py-6 text-foreground md:px-8">
      <div className="mx-auto grid w-full max-w-[1540px] gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="grid gap-4 self-start">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Workflow className="size-5" />
                </span>
                <div>
                  <CardTitle>Workflow builder</CardTitle>
                  <CardDescription>Natural language to validated spec</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Natural language</CardTitle>
              <CardDescription>
                Compile prose into a structured spec before execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea
                className="min-h-48 resize-y text-sm leading-6"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
              />
              <Button disabled={isMutating || !sourceText.trim()} onClick={compileWorkflow}>
                Compile workflow
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Run scenario</CardTitle>
              <CardDescription>
                Execute the compiled spec with deterministic SDK activities.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {scenarios.map((scenario) => (
                <Button
                  className="h-auto justify-start gap-3 whitespace-normal px-3 py-3 text-left"
                  disabled={isMutating || !spec}
                  key={scenario.value}
                  onClick={() => void runScenario(scenario.value)}
                  variant={run?.scenario.name === scenario.value ? "default" : "outline"}
                >
                  <scenario.icon data-icon="inline-start" />
                  <span className="grid gap-1">
                    <span>{scenario.label}</span>
                    <span className="text-xs font-normal opacity-75">
                      {scenario.description}
                    </span>
                  </span>
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recovery</CardTitle>
              <CardDescription>
                Retry a failed run or replay from a selected activity row.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                disabled={isMutating || run?.status !== "failed"}
                onClick={() => void retryRun()}
              >
                <RefreshCcw data-icon="inline-start" />
                Retry failed run
              </Button>
              <Button
                disabled={isMutating || !selectedActivityId}
                onClick={() => void replayRun()}
                variant="secondary"
              >
                <RotateCcw data-icon="inline-start" />
                Replay selected activity
              </Button>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  checked={applyReplayPatch}
                  className="mt-1"
                  onChange={(event) => setApplyReplayPatch(event.target.checked)}
                  type="checkbox"
                />
                <span>Replay with device-2 becoming unhealthy.</span>
              </label>
            </CardContent>
          </Card>
        </aside>

        <section className="grid min-w-0 gap-5">
          <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit">
                Level 2 workflow engine
              </Badge>
              <div className="space-y-2">
                <h1 className="max-w-4xl text-3xl font-semibold tracking-tight md:text-5xl">
                  Compile natural language into a safe workflow spec.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  The playground proves the architecture: prose becomes JSON,
                  validation checks registered activities, and the existing SDK
                  executes deterministic activity steps with retry and replay history.
                </p>
              </div>
            </div>
            <MetricStrip run={run} specStats={specStats} />
          </header>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {run?.failedActivity ? (
            <div className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <strong>{run.failedActivity.activityName} failed</strong>
              <span>{run.failedActivity.error?.message}</span>
              <span className="text-destructive/80">{run.recoveryHint}</span>
            </div>
          ) : null}

          <Tabs defaultValue="builder">
            <TabsList>
              <TabsTrigger value="builder">Builder</TabsTrigger>
              <TabsTrigger value="spec">Spec</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
            </TabsList>

            <TabsContent
              value="builder"
              className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]"
            >
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{workflow?.title ?? "Workflow graph"}</CardTitle>
                      <CardDescription>
                        Control-flow nodes come from the spec; colored activity nodes
                        reflect the latest matching run history.
                      </CardDescription>
                    </div>
                    <StatusBadge status={run?.status ?? "created"} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {(workflow?.nodes ?? []).map((node) => (
                      <button
                        className={cn(
                          "grid min-h-36 gap-2 rounded-lg border bg-card p-4 text-left text-sm transition-colors hover:border-primary",
                          node.kind !== "activity" && "border-dashed bg-muted/40",
                          nodeClass(nodeStatuses.get(node.id)),
                        )}
                        key={node.id}
                        onClick={() => selectNode(node)}
                        style={{ marginLeft: `${Math.min(node.depth, 3) * 10}px` }}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={node.kind === "activity" ? "outline" : "secondary"}>
                            {node.kind}
                          </Badge>
                          <NodeStatusBadge
                            status={nodeStatuses.get(node.id) ?? "pending"}
                          />
                        </div>
                        <strong className="text-base leading-snug">{node.label}</strong>
                        <span className="leading-6 text-muted-foreground">
                          {node.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <ActivityInspector activity={selectedActivity} />
            </TabsContent>

            <TabsContent value="spec">
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Generated WorkflowSpec</CardTitle>
                      <CardDescription>
                        This JSON is validated before the runtime can execute it.
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">
                      {specStats.activities} activities, {specStats.loops} loops,{" "}
                      {specStats.branches} branches
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-[680px] overflow-auto rounded-lg bg-foreground p-4 text-xs leading-5 text-background">
                    {stringify(spec ?? "Compile a workflow to see the spec.")}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeline">
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Activity timeline</CardTitle>
                      <CardDescription>
                        Click rows such as check-device-health:device-2 before replaying.
                      </CardDescription>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {run?.id ?? "No run yet"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Seq</TableHead>
                        <TableHead>Activity ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempt</TableHead>
                        <TableHead>Evidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run?.timeline.length ? (
                        run.timeline.map((activity) => (
                          <TableRow
                            className="cursor-pointer"
                            data-state={
                              selectedActivityId === activity.activityId
                                ? "selected"
                                : undefined
                            }
                            key={`${activity.sequence}:${activity.activityId}`}
                            onClick={() => setSelectedActivityId(activity.activityId)}
                          >
                            <TableCell>{activity.sequence}</TableCell>
                            <TableCell className="max-w-[320px] whitespace-normal font-medium">
                              {activity.activityId}
                            </TableCell>
                            <TableCell>
                              <NodeStatusBadge status={activity.status} />
                            </TableCell>
                            <TableCell>{activity.attempt}</TableCell>
                            <TableCell className="max-w-[520px] whitespace-normal text-muted-foreground">
                              {activity.evidence}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            Run a scenario to see activity history.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="output">
              <Card>
                <CardHeader>
                  <CardTitle>Workflow output</CardTitle>
                  <CardDescription>
                    Terminal summary or captured failure information.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-[560px] overflow-auto rounded-lg bg-foreground p-4 text-sm leading-6 text-background">
                    {stringify(run?.output ?? run?.error ?? "No output yet.")}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </main>
  );
}

function MetricStrip({
  run,
  specStats,
}: {
  run: DemoRun | null;
  specStats: SpecStats;
}) {
  return (
    <div className="grid min-w-[420px] grid-cols-4 overflow-hidden rounded-lg border bg-card shadow-sm">
      <Metric label="Status" value={run ? labelForStatus(run.status) : "Idle"} />
      <Metric label="Steps" value={specStats.total} />
      <Metric label="Activities" value={run?.stats.activityCount ?? 0} />
      <Metric label="History hits" value={run?.stats.skippedCount ?? 0} />
    </div>
  );
}

function Metric({ label, value }: { label: number | string; value: number | string }) {
  return (
    <div className="grid gap-2 border-r px-4 py-3 last:border-r-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <strong className="text-base">{value}</strong>
    </div>
  );
}

function ActivityInspector({ activity }: { activity?: ActivityExecution }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{activity?.activityName ?? "No activity selected"}</CardTitle>
            <CardDescription>
              Select an activity node or timeline row to inspect inputs and outputs.
            </CardDescription>
          </div>
          <NodeStatusBadge status={activity?.status ?? "pending"} />
        </div>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[540px] overflow-auto rounded-lg bg-foreground p-4 text-xs leading-5 text-background">
          {stringify(activity ?? "Run a scenario, then select an activity.")}
        </pre>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: DemoRun["status"] }) {
  if (status === "completed") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        Completed
      </Badge>
    );
  }

  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }

  return <Badge variant="outline">{labelForStatus(status)}</Badge>;
}

function NodeStatusBadge({
  status,
}: {
  status: ActivityExecution["status"] | "pending";
}) {
  if (status === "succeeded") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        Succeeded
      </Badge>
    );
  }

  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }

  if (status === "skipped") {
    return (
      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
        Skipped
      </Badge>
    );
  }

  if (status === "running") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
        Running
      </Badge>
    );
  }

  return <Badge variant="outline">Pending</Badge>;
}

function nodeClass(status: ActivityExecution["status"] | "pending" = "pending") {
  return {
    "border-blue-200 bg-blue-50": status === "skipped",
    "border-destructive/30 bg-destructive/10": status === "failed",
    "border-emerald-200 bg-emerald-50": status === "succeeded",
    "border-amber-200 bg-amber-50": status === "running",
  };
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

type SpecStats = {
  activities: number;
  branches: number;
  loops: number;
  total: number;
};

function countSpecSteps(spec: WorkflowSpec | null): SpecStats {
  const stats: SpecStats = { activities: 0, branches: 0, loops: 0, total: 0 };

  function visit(steps: WorkflowStep[] = []) {
    for (const step of steps) {
      stats.total += 1;

      if (step.type === "activity") {
        stats.activities += 1;
      } else if (step.type === "for_each") {
        stats.loops += 1;
        visit(step.steps);
      } else {
        stats.branches += 1;
        visit(step.then);
        visit(step.else ?? []);
      }
    }
  }

  if (spec) {
    visit(spec.steps);
  }

  return stats;
}

function labelForStatus(status: string) {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
