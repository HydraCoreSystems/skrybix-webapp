"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

const PRIMARY_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/mothers", label: "Mother Plants" },
  { href: "/cuttings", label: "Cuttings" },
  { href: "/hoya-library", label: "Hoya Library" },
  { href: "/outgoing", label: "Outgoing Log" },
];

const UTILITY_LINKS = [
  { href: "/system-health", label: "System Health" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="topnav no-print">
      <Link className="brand" href="/" aria-label="Skrybix dashboard">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span><strong>Skrybix</strong><small>Living collection</small></span>
      </Link>
      <nav className="primary-nav" aria-label="Collection">
        {PRIMARY_LINKS.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
          return <Link key={href} href={href} className={active ? "active" : undefined}>{label}</Link>;
        })}
      </nav>
      <nav className="utility-nav" aria-label="System">
        {UTILITY_LINKS.map(({ href, label }) => {
          const active = pathname?.startsWith(href);
          return <Link key={href} href={href} className={active ? "active" : undefined}>{label}</Link>;
        })}
      </nav>
      <form action={logout} className="logout-form">
        <button type="submit" className="logout-btn">
          Log out
        </button>
      </form>
    </header>
  );
}
