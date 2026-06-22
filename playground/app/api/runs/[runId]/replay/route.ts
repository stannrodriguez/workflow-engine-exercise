import { NextResponse } from "next/server";

import { replayDemoRun } from "@/lib/fleet-demo";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const body = await request.json().catch(() => ({}));

  if (!body.activityId) {
    return NextResponse.json(
      { error: "activityId is required for replay." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      run: await replayDemoRun(runId, body.activityId, {
        applyReplayPatch: body.applyReplayPatch ?? false,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Replay failed." },
      { status: 400 },
    );
  }
}
