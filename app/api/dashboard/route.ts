import { NextRequest, NextResponse } from "next/server";

import { serializePublicDashboardData } from "@/lib/dashboard-serialization";
import { getDashboardDataSafe } from "@/lib/pocket";
import type { TimeWindow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isWindow(value: string | null): value is TimeWindow {
  return value === "24h" || value === "7d" || value === "30d";
}

export async function GET(request: NextRequest) {
  const window = request.nextUrl.searchParams.get("window");
  if (!isWindow(window)) {
    return NextResponse.json({ error: "Invalid window" }, { status: 400 });
  }

  const result = getDashboardDataSafe(window);
  if (!result.data) {
    return NextResponse.json({ status: result.status }, { status: 202 });
  }

  return NextResponse.json(serializePublicDashboardData(result.data));
}
