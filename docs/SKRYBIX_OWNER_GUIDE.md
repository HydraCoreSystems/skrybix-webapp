# Skrybix Owner Guide

The in-app guide at `/guide` is the primary owner reference. This copy exists in the repository for recovery and maintenance.

## Daily workflow

1. Check the Dashboard for queued labels, GM Commerce handoffs, and recent outgoing activity.
2. Add new mother plants and create their cuttings.
3. Batch-queue cutting labels, print them, and confirm the print. Use Reprint when needed; history is retained.
4. Select sale-ready cuttings and send them to GM Commerce. Wait for the acknowledgement shown in Skrybix.
5. Complete commercial preparation and listing work in GM Commerce.
6. When an item leaves the physical collection, record the sale, disposal, loss, gift, or other removal through the outgoing workflow.
7. Use System Health whenever a queue or record looks wrong. Review integrity alerts; never repair them by directly deleting or rewriting database records.

## System boundary

- **Skrybix:** physical collection identity, mother plants, individual cuttings, labels, handoff, and outgoing history.
- **GM Commerce:** photos, listing preparation, destinations, prices, time on market, sale lifecycle, Commercial Ledger, and cross-listing closure.
- **Hoya Library:** Kew-based reference and collection checklist; it is not inventory.

## Access

Skrybix is hosted at `https://skrybix-webapp.vercel.app/`. Use the shared owner sign-in. The app does not depend on the Linux machine for ordinary use.
