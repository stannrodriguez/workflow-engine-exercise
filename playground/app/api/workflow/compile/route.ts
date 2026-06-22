import { NextResponse } from "next/server";

import { compileDemoWorkflow } from "@/lib/fleet-demo";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  try {
    return NextResponse.json(compileDemoWorkflow(body.text));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Compile failed." },
      { status: 400 },
    );
  }
}
