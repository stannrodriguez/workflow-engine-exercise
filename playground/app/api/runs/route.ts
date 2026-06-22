import { NextResponse } from "next/server";

import { startDemoRun } from "@/lib/fleet-demo";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  try {
    const run = await startDemoRun(body.scenario ?? "healthy", body.spec);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run failed." },
      { status: 400 },
    );
  }
}
