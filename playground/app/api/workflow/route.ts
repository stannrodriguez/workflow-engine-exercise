import { NextResponse } from "next/server";

import { compileDemoWorkflow } from "@/lib/fleet-demo";

export async function GET() {
  return NextResponse.json(compileDemoWorkflow());
}
