import { activity, createWorkflowEngine, workflow } from "../src/index.js";

const fetchUser = activity({
  name: "fetchUser",
  run: async ({ userId }) => ({ id: userId, name: "Stephanie" }),
});

const writeWelcomeMessage = activity({
  name: "writeWelcomeMessage",
  run: async ({ user }) => `Welcome, ${user.name}!`,
});

const welcomeWorkflow = workflow({
  name: "WelcomeWorkflow",
  run: async ({ input, step }) => {
    const user = await step(fetchUser, { userId: input.userId });
    return step(writeWelcomeMessage, { user });
  },
});

const engine = createWorkflowEngine({
  activities: [fetchUser, writeWelcomeMessage],
});

const run = await engine.start(welcomeWorkflow, { userId: "user_123" });

console.log(run.output);
console.table(run.timeline());
