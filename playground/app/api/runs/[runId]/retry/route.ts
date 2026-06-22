import { NextResponse } from "next/server";

import { retryDemoRun } from "@/lib/fleet-demo";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { runId } = await context.params;

  try {
    return NextResponse.json({ run: await retryDemoRun(runId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retry failed." },
      { status: 400 },
    );
  }
}
