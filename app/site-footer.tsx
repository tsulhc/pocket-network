import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>Pocket Network Analytics</strong>
        <p>Public service demand, relay, reward, and indexer coverage metrics.</p>
      </div>
      <nav aria-label="Secondary navigation">
        <Link href="/network">Network status</Link>
      </nav>
    </footer>
  );
}
