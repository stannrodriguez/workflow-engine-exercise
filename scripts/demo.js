import { WorkflowEngine } from "../src/engine.js";
import {
  createFleetUpgradeWorkflow,
  registerFleetActivities,
} from "../src/fleetUpgradeWorkflow.js";

const engine = new WorkflowEngine();
registerFleetActivities(engine, {
  healthByDeviceId: {
    "device-3": "NEEDS_ATTENTION",
  },
});

const workflow = createFleetUpgradeWorkflow();
const run = await engine.start(workflow, { fleetId: "fleet-demo" }, { runId: "demo-run" });

console.log(JSON.stringify({
  runId: run.id,
  state: run.state,
  summary: run.output,
  executedActivities: run.activityExecutions.length,
}, null, 2));
