import CalculatorView from "@/app/calculator/calculator-view";
import { serializePublicDashboardData } from "@/lib/dashboard-serialization";
import { getDashboardDataSafe } from "@/lib/pocket";

export const metadata = {
  title: "Growth Simulator | Pocket Network Analytics",
  description: "Simulate revenue projections for new providers with different supplier allocations."
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CalculatorPage() {
  const result = getDashboardDataSafe("30d");
  const data = result.data ? serializePublicDashboardData(result.data) : null;

  if (!data) {
    return (
      <main className="page">
        <section className="panel section explorer-empty">
          <span className="eyebrow">Calculator</span>
          <h1 className="section-title">Growth Simulator is warming up.</h1>
          <p className="section-subtitle">The 30d dashboard snapshot is still being prepared. Refresh shortly to use the simulator.</p>
        </section>
      </main>
    );
  }

  return <CalculatorView data={data} />;
}
