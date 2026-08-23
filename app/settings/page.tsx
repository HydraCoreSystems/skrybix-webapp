import Link from "next/link";
import ThemePicker from "@/components/ThemePicker";

export default function SettingsPage() {
  return <div className="settings-hub visual-reference-page">
    <section className="card settings-hero"><p className="eyebrow">Skrybix configuration</p><h1>Settings</h1><p>Appearance, access, and live operational visibility are organized here. Inventory work remains in the main workbenches.</p></section>
    <ThemePicker />
    <div className="profile-columns">
      <section className="card"><h3>System Health</h3><p>Check database reachability, work queues, GM Commerce acknowledgements, and inventory-history consistency.</p><Link className="btn" href="/system-health">Open System Health</Link></section>
      <section className="card"><h3>Site access</h3><p>Change the shared owner password used to enter Skrybix.</p><Link className="btn secondary" href="/settings/password">Update site password</Link></section>
    </div>
  </div>;
}
