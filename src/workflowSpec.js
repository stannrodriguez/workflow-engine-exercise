import { workflow } from "./sdk.js";

const FLEET_PROMPT_KEYWORDS = [
  "upgrade",
  "fleet",
  "device",
  "firmware",
  "health",
  "validate",
  "summary",
  "archive",
];

export function compileWorkflowFromNaturalLanguage(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    throw new Error("Workflow text is required.");
  }

  const normalized = source.toLowerCase();
  const hasFleetShape = FLEET_PROMPT_KEYWORDS.every((keyword) =>
    normalized.includes(keyword),
  );

  if (!hasFleetShape) {
    throw new Error(
      "Unsupported workflow request. This deterministic compiler currently supports the fleet firmware upgrade workflow.",
    );
  }

  return createFleetUpgradeWorkflowSpec(source);
}

export function createWorkflowFromSpec(spec, activityDefinitions) {
  const activitiesByName = toActivityMap(activityDefinitions);
  validateWorkflowSpec(spec, activitiesByName);

  return workflow({
    name: spec.name,
    run: async ({ input, step }) => {
      const scope = createScope(input);
      const interpreter = { activitiesByName, scope, step };

      await executeSteps(spec.steps, interpreter, { insideLoop: false });
      return scope.summary ?? scope.lastOutput;
    },
  });
}

export function validateWorkflowSpec(spec, activityDefinitions) {
  const activitiesByName = toActivityMap(activityDefinitions);
  const errors = [];
  const stepIds = new Set();

  if (!spec || typeof spec !== "object") {
    errors.push("Workflow spec must be an object.");
  } else {
    if (!spec.name || typeof spec.name !== "string") {
      errors.push("Workflow spec requires a non-empty name.");
    }

    if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
      errors.push("Workflow spec requires at least one step.");
    } else {
      validateSteps(spec.steps, {
        activitiesByName,
        errors,
        insideLoop: false,
        path: "steps",
        stepIds,
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid workflow spec:\n- ${errors.join("\n- ")}`);
  }

  return { ok: true };
}

export function workflowSpecToGraph(spec) {
  const nodes = [];

  function visitSteps(steps, depth, parentId) {
    for (const step of steps ?? []) {
      if (step.type === "activity") {
        nodes.push({
          activityName: step.activity,
          depth,
          description: step.output
            ? `Runs ${step.activity} and binds output to ${step.output}.`
            : `Runs ${step.activity}.`,
          id: step.id,
          kind: "activity",
          label: humanizeId(step.id),
          parentId,
        });
      } else if (step.type === "for_each") {
        nodes.push({
          depth,
          description: `For each ${step.itemName} in ${step.items}.`,
          id: step.id,
          kind: "for_each",
          label: humanizeId(step.id),
          parentId,
        });
        visitSteps(step.steps, depth + 1, step.id);
      } else if (step.type === "if") {
        nodes.push({
          depth,
          description: `Branch when ${step.condition}.`,
          id: step.id,
          kind: "if",
          label: humanizeId(step.id),
          parentId,
        });
        visitSteps(step.then, depth + 1, step.id);
        visitSteps(step.else ?? [], depth + 1, step.id);
      }
    }
  }

  visitSteps(spec.steps, 0, undefined);

  return {
    nodes,
    title: spec.name,
  };
}

async function executeSteps(steps, interpreter, context) {
  for (const currentStep of steps) {
    await executeStep(currentStep, interpreter, context);
  }
}

async function executeStep(currentStep, interpreter, context) {
  if (currentStep.type === "activity") {
    const activityDefinition = interpreter.activitiesByName.get(currentStep.activity);
    const activityInput = resolveTemplate(currentStep.input ?? {}, interpreter.scope);
    const key = currentStep.key
      ? resolveExpression(currentStep.key, interpreter.scope)
      : undefined;
    const output = await interpreter.step(activityDefinition, activityInput, {
      activityId:
        key === undefined
          ? currentStep.id
          : `${currentStep.id}:${normalizeActivityKey(key)}`,
    });

    bindOutput(currentStep.output, output, interpreter.scope);
    interpreter.scope.lastOutput = output;
    return;
  }

  if (currentStep.type === "for_each") {
    const items = resolveExpression(currentStep.items, interpreter.scope);
    if (!Array.isArray(items)) {
      throw new Error(
        `Step ${currentStep.id} expected ${currentStep.items} to resolve to an array.`,
      );
    }

    for (const item of items) {
      interpreter.scope[currentStep.itemName] = item;
      await executeSteps(currentStep.steps, interpreter, { insideLoop: true });
    }

    delete interpreter.scope[currentStep.itemName];
    return;
  }

  if (currentStep.type === "if") {
    const branch = evaluateCondition(currentStep.condition, interpreter.scope)
      ? currentStep.then
      : currentStep.else ?? [];
    await executeSteps(branch, interpreter, context);
    return;
  }

  throw new Error(`Unsupported workflow step type ${currentStep.type}.`);
}

function validateSteps(steps, context) {
  if (!Array.isArray(steps) || steps.length === 0) {
    context.errors.push(`${context.path} must contain at least one step.`);
    return;
  }

  for (const [index, currentStep] of steps.entries()) {
    const path = `${context.path}[${index}]`;
    if (!currentStep || typeof currentStep !== "object") {
      context.errors.push(`${path} must be an object.`);
      continue;
    }

    if (!currentStep.id || typeof currentStep.id !== "string") {
      context.errors.push(`${path} requires a non-empty id.`);
    } else if (context.stepIds.has(currentStep.id)) {
      context.errors.push(`Step id ${currentStep.id} must be unique.`);
    } else {
      context.stepIds.add(currentStep.id);
    }

    if (currentStep.type === "activity") {
      if (!currentStep.activity || typeof currentStep.activity !== "string") {
        context.errors.push(`${path} requires an activity name.`);
      } else if (!context.activitiesByName.has(currentStep.activity)) {
        context.errors.push(
          `Step ${currentStep.id} references unknown activity ${currentStep.activity}.`,
        );
      }

      if (!currentStep.input || typeof currentStep.input !== "object") {
        context.errors.push(`Step ${currentStep.id} requires an input object.`);
      }

      if (context.insideLoop && !currentStep.key) {
        context.errors.push(
          `Step ${currentStep.id} runs inside a loop and requires a stable key expression.`,
        );
      }
      continue;
    }

    if (currentStep.type === "for_each") {
      if (!currentStep.items || typeof currentStep.items !== "string") {
        context.errors.push(`Step ${currentStep.id} requires an items path.`);
      }

      if (!currentStep.itemName || typeof currentStep.itemName !== "string") {
        context.errors.push(`Step ${currentStep.id} requires an itemName.`);
      }

      validateSteps(currentStep.steps, {
        ...context,
        insideLoop: true,
        path: `${path}.steps`,
      });
      continue;
    }

    if (currentStep.type === "if") {
      if (!currentStep.condition || typeof currentStep.condition !== "string") {
        context.errors.push(`Step ${currentStep.id} requires a condition.`);
      }

      validateSteps(currentStep.then, {
        ...context,
        path: `${path}.then`,
      });

      if (currentStep.else !== undefined) {
        validateSteps(currentStep.else, {
          ...context,
          path: `${path}.else`,
        });
      }
      continue;
    }

    context.errors.push(`${path} has unsupported step type ${currentStep.type}.`);
  }
}

function createScope(input) {
  return {
    failedValidations: [],
    input,
    skippedDevices: [],
    successfulUpgrades: [],
  };
}

function resolveTemplate(value, scope) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, scope));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        resolveTemplate(nestedValue, scope),
      ]),
    );
  }

  if (typeof value === "string" && isPathExpression(value)) {
    return resolveExpression(value, scope);
  }

  return value;
}

function resolveExpression(expression, scope) {
  const trimmed = String(expression).trim();

  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(".");
  let current = scope;

  for (const part of parts) {
    if (!part) {
      throw new Error(`Invalid expression ${expression}.`);
    }

    if (current == null || !(part in Object(current))) {
      throw new Error(`Expression ${expression} could not resolve ${part}.`);
    }

    current = current[part];
  }

  return current;
}

function evaluateCondition(condition, scope) {
  const match = condition
    .trim()
    .match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);

  if (!match) {
    const value = resolveExpression(condition, scope);
    return Boolean(value);
  }

  const [, leftExpression, operator, rightExpression] = match;
  const left = resolveExpression(leftExpression, scope);
  const right = parseConditionValue(rightExpression, scope);

  if (operator === "==") {
    return left === right;
  }

  if (operator === "!=") {
    return left !== right;
  }

  if (operator === ">") {
    return left > right;
  }

  if (operator === "<") {
    return left < right;
  }

  if (operator === ">=") {
    return left >= right;
  }

  if (operator === "<=") {
    return left <= right;
  }

  throw new Error(`Unsupported condition operator ${operator}.`);
}

function parseConditionValue(value, scope) {
  const trimmed = value.trim();
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return resolveExpression(trimmed, scope);
}

function bindOutput(binding, output, scope) {
  if (!binding) {
    return;
  }

  if (binding.endsWith("[]")) {
    const name = binding.slice(0, -2);
    if (!Array.isArray(scope[name])) {
      scope[name] = [];
    }

    scope[name].push(output);
    return;
  }

  scope[binding] = output;
}

function toActivityMap(activityDefinitions) {
  if (activityDefinitions instanceof Map) {
    return activityDefinitions;
  }

  if (Array.isArray(activityDefinitions)) {
    return new Map(
      activityDefinitions.map((activityDefinition) => [
        activityDefinition.name,
        activityDefinition,
      ]),
    );
  }

  if (activityDefinitions && typeof activityDefinitions === "object") {
    return new Map(
      Object.values(activityDefinitions).map((activityDefinition) => [
        activityDefinition.name,
        activityDefinition,
      ]),
    );
  }

  return new Map();
}

function isPathExpression(value) {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(value);
}

function normalizeActivityKey(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-");
}

function humanizeId(value) {
  return String(value)
    .replace(/[:-]+/g, "-")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function createFleetUpgradeWorkflowSpec(description) {
  return {
    description,
    inputSchema: {
      fleetId: { type: "string" },
    },
    name: "FleetUpgradeWorkflow",
    steps: [
      {
        activity: "getFleetDeviceList",
        id: "get-fleet-device-list",
        input: { fleetId: "input.fleetId" },
        output: "devices",
        type: "activity",
      },
      {
        activity: "groupDevicesByModel",
        id: "group-devices-by-model",
        input: { devices: "devices" },
        output: "deviceGroups",
        type: "activity",
      },
      {
        id: "for-each-device-group",
        itemName: "deviceGroup",
        items: "deviceGroups",
        steps: [
          {
            activity: "getFirmwareRequirements",
            id: "get-firmware-requirements",
            input: { model: "deviceGroup.model" },
            key: "deviceGroup.model",
            output: "firmwareSpec",
            type: "activity",
          },
          {
            activity: "downloadFirmwarePackage",
            id: "download-firmware-package",
            input: {
              firmwareSpec: "firmwareSpec",
              model: "deviceGroup.model",
            },
            key: "deviceGroup.model",
            output: "firmware",
            type: "activity",
          },
          {
            id: "for-each-device",
            itemName: "device",
            items: "deviceGroup.devices",
            steps: [
              {
                activity: "checkDeviceHealth",
                id: "check-device-health",
                input: { device: "device" },
                key: "device.id",
                output: "healthStatus",
                type: "activity",
              },
              {
                condition: 'healthStatus == "READY"',
                id: "if-device-ready",
                then: [
                  {
                    activity: "installFirmware",
                    id: "install-firmware",
                    input: { device: "device", firmware: "firmware" },
                    key: "device.id",
                    output: "installResult",
                    type: "activity",
                  },
                  {
                    activity: "validateInstallation",
                    id: "validate-installation",
                    input: {
                      device: "device",
                      installResult: "installResult",
                    },
                    key: "device.id",
                    output: "validationResult",
                    type: "activity",
                  },
                  {
                    condition: 'validationResult.status == "SUCCESS"',
                    else: [
                      {
                        activity: "recordFailedValidation",
                        id: "record-failed-validation",
                        input: {
                          device: "device",
                          validationResult: "validationResult",
                        },
                        key: "device.id",
                        output: "failedValidations[]",
                        type: "activity",
                      },
                    ],
                    id: "if-validation-success",
                    then: [
                      {
                        activity: "recordSuccessfulUpgrade",
                        id: "record-successful-upgrade",
                        input: {
                          device: "device",
                          installResult: "installResult",
                          validationResult: "validationResult",
                        },
                        key: "device.id",
                        output: "successfulUpgrades[]",
                        type: "activity",
                      },
                    ],
                    type: "if",
                  },
                ],
                else: [
                  {
                    activity: "recordSkippedDevice",
                    id: "record-skipped-device",
                    input: { device: "device", healthStatus: "healthStatus" },
                    key: "device.id",
                    output: "skippedDevices[]",
                    type: "activity",
                  },
                ],
                type: "if",
              },
            ],
            type: "for_each",
          },
        ],
        type: "for_each",
      },
      {
        activity: "generateUpgradeSummary",
        id: "generate-upgrade-summary",
        input: {
          failedValidations: "failedValidations",
          skippedDevices: "skippedDevices",
          successfulUpgrades: "successfulUpgrades",
        },
        output: "summary",
        type: "activity",
      },
      {
        condition: "summary.failureCount > 0",
        id: "if-summary-has-failures",
        then: [
          {
            activity: "sendAlertToITTeam",
            id: "send-alert-to-it-team",
            input: { summary: "summary" },
            type: "activity",
          },
        ],
        type: "if",
      },
      {
        activity: "archiveUpgradeLogs",
        id: "archive-upgrade-logs",
        input: { summary: "summary" },
        output: "archiveResult",
        type: "activity",
      },
    ],
  };
}
