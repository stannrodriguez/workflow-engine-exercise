import { NextResponse } from "next/server";

import { startDemoRun } from "@/lib/fleet-demo";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const run = await startDemoRun(body.scenario ?? "healthy");
  return NextResponse.json({ run }, { status: 201 });
}
