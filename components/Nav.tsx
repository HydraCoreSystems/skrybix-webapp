"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="topnav no-print">
      <span className="brand">Skrybix</span>
      <Link href="/">Dashboard</Link>
      <Link href="/mothers">Mother Plants</Link>
      <Link href="/cuttings">Cuttings</Link>
      <Link href="/outgoing">Outgoing Log</Link>
      <Link href="/settings/password">Settings</Link>
      <form action={logout} style={{ display: "inline" }}>
        <button
          type="submit"
          style={{
            background: "none",
            border: "none",
            color: "white",
            opacity: 0.9,
            cursor: "pointer",
            font: "inherit",
            padding: 0,
          }}
        >
          Log out
        </button>
      </form>
    </header>
  );
}
