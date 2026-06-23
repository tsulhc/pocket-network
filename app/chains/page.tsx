import ChainsExplorerView from "@/app/chains/chains-explorer-view";
import { serializePublicDashboardData } from "@/lib/dashboard-serialization";
import { getDashboardDataSafe } from "@/lib/pocket";

export const metadata = {
  title: "Service Demand | Pocket Network Analytics",
  description: "Explore Pocket service demand, top revenue chains, relays, domain density, supplier count, and public signals."
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChainsPage() {
  const result = getDashboardDataSafe("30d");
  const data = result.data ? serializePublicDashboardData(result.data) : null;

  return <ChainsExplorerView data={data} />;
}
