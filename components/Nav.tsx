import Link from "next/link";

export default function Nav() {
  return (
    <header className="topnav no-print">
      <span className="brand">Skrybix</span>
      <Link href="/">Dashboard</Link>
      <Link href="/mothers">Mother Plants</Link>
      <Link href="/cuttings">Cuttings</Link>
      <Link href="/outgoing">Outgoing Log</Link>
    </header>
  );
}
