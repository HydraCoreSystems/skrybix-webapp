"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/mothers", label: "Mother Plants" },
  { href: "/cuttings", label: "Cuttings" },
  { href: "/outgoing", label: "Outgoing Log" },
  { href: "/settings/password", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="topnav no-print">
      <span className="brand">Skrybix</span>
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : undefined}>
            {label}
          </Link>
        );
      })}
      <form action={logout} style={{ marginLeft: "auto" }}>
        <button type="submit" className="logout-btn">
          Log out
        </button>
      </form>
    </header>
  );
}
