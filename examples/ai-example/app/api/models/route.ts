import { gateway } from "@/lib/gateway";
import { NextResponse } from "next/server";

export async function GET() {
  const models = await gateway.getAvailableModels();
  return NextResponse.json(models);
}
