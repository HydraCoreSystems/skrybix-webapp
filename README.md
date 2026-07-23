# Skrybix Web — prototype

A minimal, single-machine proof-of-concept that shows Skrybix's core workflow
(mother plants → cuttings → sold → outgoing log, plus printable QR labels)
running as a real web app with a real database instead of a Sheet + Apps Script.

This is a **prototype to evaluate the idea**, not a production deployment.
See the review document for what a production rollout would still need
(hosting, auth, backups, a real printer pipeline, etc).

## Run it

```
cd skrybix_web
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5000 in a browser. A `skrybix.db` SQLite file is
created automatically on first run — delete it to start fresh.

## What to try

1. **Mother Plants** → Add Mother Plant. Fill in an ID, name, location, and
   the two botanical label lines.
2. **Cuttings** → Take Cuttings. Pick the mother, say how many cuttings,
   and it generates Cutting IDs the same way the Sheet did
   (`M014-C01`, `M014-C02`, ...) but without the truncation bug past 99
   or the "copy row 2's QR code onto everything" bug.
3. Mark a cutting **Sold**, then **Push Sold → Outgoing Log** — mirrors the
   `pushSoldToOutgoingLog` menu action from the spreadsheet.
4. Queue a few mothers/cuttings for print, then **Export queued → PDF labels**.
   Each label gets its own real QR code (generated on the fly, no manual
   Google Form link-building) pointing at a live info page for that plant
   or cutting — open the PDF and scan one, or just visit
   `/plant/<mother_id>` directly.
5. **Export queued → CSV** — same idea as the Sheets CSV export, but built
   with Python's `csv` module so a comma in a plant name can never corrupt
   the file (this was a real bug in the original Apps Script).

## What's deliberately not here yet

- Login / multi-user accounts
- Deployment config (this runs on localhost only)
- Talking directly to a physical label printer (right now you print the
  generated PDF like any other document)
- Data import from the existing Google Sheet (a one-time CSV import script
  would be a fast follow — export each Sheet tab to CSV and load it in)

These are covered in the roadmap section of the review document.
