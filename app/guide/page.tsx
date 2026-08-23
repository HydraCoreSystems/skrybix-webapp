import Link from "next/link";

export default function OwnerGuidePage() {
  return <main className="guide-page">
    <section className="guide-hero">
      <p className="eyebrow">Practical owner reference</p>
      <h1>Using Skrybix</h1>
      <p>Skrybix is the record of the physical collection: mother plants, every cutting, its label, and how it eventually leaves the collection. Use this page whenever you are unsure what comes next.</p>
    </section>

    <section className="guide-grid">
      <article className="card guide-step"><p className="eyebrow">Daily starting point</p><h2>1. Check the Dashboard</h2><ul><li>Review active mother plants and cuttings.</li><li>Look for labels waiting to print.</li><li>Check GM Commerce handoffs and recent outgoing activity.</li></ul><Link className="btn secondary" href="/">Open Dashboard</Link></article>
      <article className="card guide-step"><p className="eyebrow">New inventory</p><h2>2. Add plants and take cuttings</h2><ol><li>Add a mother plant from <strong>Mother Plants</strong>.</li><li>Use <strong>Take Cuttings</strong> to create one or many uniquely identified cuttings.</li><li>Confirm the resulting IDs before labeling or sending them onward.</li></ol></article>
      <article className="card guide-step"><p className="eyebrow">Physical labels</p><h2>3. Queue and print labels</h2><ol><li>On <strong>Cuttings</strong>, select the Queue boxes you need.</li><li>Choose <strong>Queue selected for print</strong>.</li><li>Open <strong>View queued labels</strong>, print them, then confirm the print.</li><li>A damaged or misprinted label can be selected again as a <strong>Reprint</strong>; its print history is retained.</li></ol></article>
      <article className="card guide-step"><p className="eyebrow">Commercial preparation</p><h2>4. Send cuttings to GM Commerce</h2><ol><li>Select <strong>Send</strong> beside each cutting.</li><li>Choose <strong>Send selected to GM Commerce</strong>.</li><li>Skrybix records the handoff and shows when GM Commerce acknowledges it.</li><li>Finish photos, research, review, and listing decisions in GM Commerce.</li></ol></article>
      <article className="card guide-step"><p className="eyebrow">Permanent history</p><h2>5. Record how an item leaves</h2><p>Use the outgoing workflow for a sale, disposal, loss, gift, or other removal. This archives the physical cutting and preserves its history. Do not delete the cutting or edit the database directly.</p><Link className="btn secondary" href="/outgoing">Open Outgoing Log</Link></article>
      <article className="card guide-step"><p className="eyebrow">Collection reference</p><h2>6. Use the Hoya Library</h2><p>The library is your Kew-based reference and collection checklist. Mark species as present as they enter your collection; inventory remains in Mother Plants and Cuttings.</p><Link className="btn secondary" href="/hoya-library">Open Hoya Library</Link></article>
      <article className="card guide-step"><p className="eyebrow">When something looks wrong</p><h2>7. Check System Health</h2><p>System Health explains database availability, work waiting in queues, GM Commerce acknowledgements, and inventory-history inconsistencies. An integrity alert is a request for review—not permission to erase or rewrite history.</p><Link className="btn secondary" href="/system-health">Open System Health</Link></article>
      <article className="card guide-step guide-boundary"><p className="eyebrow">System boundary</p><h2>Skrybix vs. GM Commerce</h2><p><strong>Skrybix</strong> knows what the physical item is and whether it is still in the collection. <strong>GM Commerce</strong> manages its commercial life: photos, listing destinations, prices, time on market, sale, and cross-listing closure.</p></article>
    </section>
  </main>;
}
