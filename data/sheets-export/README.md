Put CSV exports from the live Google Sheet here (this folder's `*.csv`
files are gitignored — never committed, real business data stays local).

Export each tab via **File → Download → Comma Separated Values (.csv)**
from the Sheet, and save with these exact filenames:

| Sheet tab             | Save as                    | Required? |
|------------------------|-----------------------------|-----------|
| `Mother_Plants`        | `mother_plants.csv`         | Yes |
| `Hoya_Species`         | `hoya_species.csv`          | No — skipped with a warning if missing |
| `Label_Data_Cuttings`  | `label_data_cuttings.csv`   | No — skipped with a warning if missing |
| `Archive_Cuttings`     | `archive_cuttings.csv`      | No — skipped with a warning if missing |
| `Outgoing_Log`         | `outgoing_log.csv`          | No — skipped with a warning if missing |
| `ID_Counters`          | `id_counters.csv`           | No — recommended, see script comments |

Then run: `node scripts/import-sheets-data.mjs`
