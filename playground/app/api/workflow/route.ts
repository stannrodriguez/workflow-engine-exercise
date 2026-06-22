import { NextResponse } from "next/server";

import { getWorkflowGraph } from "@/lib/fleet-demo";

export async function GET() {
  return NextResponse.json({ workflow: getWorkflowGraph() });
}
