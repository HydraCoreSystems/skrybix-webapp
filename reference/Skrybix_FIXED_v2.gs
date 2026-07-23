// ============================================================
// SKRYBIX — Apps Script v2
// Builds on Skrybix_FIXED.gs (all v1 bug fixes are included below)
// and adds three things from the wishlist:
//
//   1. Structured Hoya naming entry (Genus/Species/Qualifier/
//      Collection_Code/Cultivar/Trade_Name/Hybrid) that auto-composes
//      correctly formatted, correctly italicized botanical labels
//      per your "Hoya Naming Convention Quick Reference Guide" —
//      instead of hand-typing Botanical_Line1/Line2 every time.
//   2. Auto-updating your existing Hoya_Species tab: In_Collection
//      and Date_Added get set automatically the first time a species
//      shows up in Mother_Plants — no more manually finding and
//      marking the row.
//   3. Robust, persistent ID counters for both Mother_ID (species-code
//      based, e.g. ALAG-001) and Cutting_ID, plus an Archive_Cuttings
//      tab that sold cuttings move to automatically, so Label_Data_
//      Cuttings only ever reflects what you actually still have.
//
// ASSUMPTIONS — please check these against your real sheet and tell
// me if any are wrong, they're one-line constant changes:
//   - Your Hoya species reference tab is named "Hoya_Species"
//   - Its headers are exactly: Genus, Species, In_Collection,
//     Date_Added, Preferred_ID_Code, Native_Range, Region_Group,
//     Growth_Habit, Leaf_Notes, Bloom_Notes, Authority, Notes,
//     Source, Unique_ID
//
// ONE-TIME SETUP REQUIRED after installing this file:
//   Run "Actions -> One-time Setup (v2 columns/tabs)" once. It adds
//   the new Mother_Plants columns (Genus, Species, Qualifier,
//   Collection_Code, Cultivar, Trade_Name, Hybrid), sets up their
//   dropdowns/checkboxes, and creates the ID_Counters and
//   Archive_Cuttings tabs if they don't already exist.
//
// MIGRATION: existing Mother_Plants rows are left completely alone —
// the new auto-composition only kicks in once you fill in Genus +
// Species for a row (new or existing). Until then, whatever is
// already in Botanical_Line1/Line2 stays exactly as typed.
// ============================================================

// ------------ CORE CONFIG ------------

const CONFIG_SHEET_NAME  = 'Config';
const MOTHER_SHEET_NAME  = 'Label_Data_Mothers';
const CUTTING_SHEET_NAME = 'Label_Data_Cuttings';
const EXPORT_FOLDER_NAME = 'GM_Label_Exports';
const EXPORT_FOLDER_KEY  = 'EXPORT_FOLDER_ID';
const EXPORT_PARENT_FOLDER_KEY = 'EXPORT_PARENT_FOLDER_ID'; // optional; if blank, folder is created at Drive root

// Mother_Plants source + required headers
const SOURCE_MOTHER_TAB  = 'Mother_Plants';
const COL_MOTHER_ID      = 'Mother_ID';
const COL_DISPLAY_NAME   = 'Display_Name';
const COL_LOCATION       = 'Location';
const COL_LABEL_L1       = 'Botanical_Line1';
const COL_LABEL_L2       = 'Botanical_Line2';

// NEW: structured naming columns on Mother_Plants
const COL_GENUS           = 'Genus';
const COL_SPECIES         = 'Species';
const COL_QUALIFIER       = 'Qualifier';        // '', 'aff.', 'cf.', 'sp.'
const COL_COLLECTION_CODE = 'Collection_Code';  // used with Qualifier = 'sp.'
const COL_CULTIVAR        = 'Cultivar';
const COL_TRADE_NAME      = 'Trade_Name';
const COL_HYBRID          = 'Hybrid';           // checkbox

// NEW: Hoya species reference/tracker tab (already exists in your sheet)
const HOYA_SPECIES_SHEET_NAME = 'Hoya_Species';
const HOYA_COL_GENUS      = 'Genus';
const HOYA_COL_SPECIES    = 'Species';
const HOYA_COL_IN_COLLECTION = 'In_Collection';
const HOYA_COL_DATE_ADDED    = 'Date_Added';
const HOYA_COL_ID_CODE       = 'Preferred_ID_Code';

// NEW: persistent, never-reused ID counters
const ID_COUNTER_SHEET_NAME = 'ID_Counters';

// NEW: archive tab for sold/removed cuttings
const ARCHIVE_CUTTING_SHEET_NAME = 'Archive_Cuttings';

// Outgoing_Log
const OUTGOING_SHEET_NAME = 'Outgoing_Log';

// Error log (makes silent failures visible)
const ERROR_LOG_SHEET_NAME = 'Error_Log';

// Backup retention
const MAX_BACKUPS_TO_KEEP = 10;

// Script properties (for dedupe) — namespaced per source sheet, see onFormSubmit
const PROP_LAST_FORM_ROW_PREFIX = 'SKRYBIX_LAST_FORM_ROW__';

// ----------------------------------------------------------
// Small helpers
// ----------------------------------------------------------
function normHeader_(h) {
  return String(h || '').trim();
}

function findHeaderIndex_(headerRow, names) {
  const hdr = headerRow.map(normHeader_);
  for (const name of names) {
    const idx = hdr.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function checkboxRule_() {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

function csvField_(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(value);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow_(arr) {
  return arr.map(csvField_).join(',');
}

function logError_(context, err) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(ERROR_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ERROR_LOG_SHEET_NAME);
      sheet.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Context', 'Error']]);
    }
    sheet.appendRow([new Date(), context, String(err && err.stack ? err.stack : err)]);
  } catch (e2) {
    Logger.log('logError_ failed: ' + e2 + ' (original: ' + context + ' / ' + err + ')');
  }
}

function capitalizeWords_(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ----------------------------------------------------------
// onOpen – menus
// ----------------------------------------------------------
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Labels')
    .addItem('Build Mother Labels CSV',   'buildMotherLabelsCSV')
    .addItem('Build Cutting Labels CSV',  'buildCuttingLabelsCSV')
    .addSeparator()
    .addItem('Rebuild Label_Data_Mothers (from Mother_Plants)', 'rebuildLabelDataMothersValues')
    .addSeparator()
    .addItem('Create Backup Copy', 'createBackupCopy')
    .addToUi();

  ui.createMenu('Actions')
    .addItem('Push Sold → Outgoing_Log', 'pushSoldToOutgoingLog')
    .addItem('Push Selected Cuttings → Outgoing_Log', 'pushSelectedCuttingsToOutgoingLog')
    .addSeparator()
    .addItem('Repair Checkboxes (Print/Sold columns)', 'repairCheckboxValidation')
    .addItem('One-time Setup (v2 columns/tabs)', 'setupSkrybixV2')
    .addToUi();
}

// ----------------------------------------------------------
// Config helpers
// ----------------------------------------------------------
function getConfigSheet() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) throw new Error('Config sheet not found: "' + CONFIG_SHEET_NAME + '"');
  return sheet;
}

function getConfigValue(configSheet, key) {
  const lastRow = configSheet.getLastRow();
  if (lastRow < 1) return '';
  const values = configSheet.getRange(1, 1, lastRow, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === key) return values[i][1];
  }
  return '';
}

function setConfigValue(configSheet, key, value) {
  const lastRow = configSheet.getLastRow();
  if (lastRow > 0) {
    const values = configSheet.getRange(1, 1, lastRow, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === key) {
        configSheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
  }
  configSheet.appendRow([key, value]);
}

function buildQrLink_(configSheet, motherId, location) {
  const templateUrl = configSheet.getRange('B9').getValue();
  if (!templateUrl || templateUrl.indexOf('MOTHERIDTOKEN') === -1 || templateUrl.indexOf('LOCATIONTOKEN') === -1) {
    return '';
  }
  let qrLink = templateUrl;
  qrLink = qrLink.replace('MOTHERIDTOKEN', encodeURIComponent(motherId));
  qrLink = qrLink.replace('LOCATIONTOKEN', encodeURIComponent(location));
  return qrLink;
}

// ----------------------------------------------------------
// NEW: Persistent ID counters (ID_Counters tab: Key | Next_Number)
//
// WHY: the old approach (scan existing rows, take the max, add one) goes
// wrong the moment a row is ever deleted or archived — a deleted C05 can
// get issued again as a brand-new C05, and now that sold cuttings move to
// Archive_Cuttings automatically, that scan would no longer even see the
// old rows to know they existed. A persistent counter that only ever
// increments removes the problem entirely, for both Cutting_ID and the
// new species-code Mother_ID.
// ----------------------------------------------------------
function getOrCreateIdCounterSheet_(ss) {
  let sheet = ss.getSheetByName(ID_COUNTER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ID_COUNTER_SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Next_Number']]);
  }
  return sheet;
}

// Reserves `count` sequential numbers for `key` and returns the first one.
// e.g. nextCounterBlock_('CUTSEQ::M014', 3) issuing 5,6,7 returns 5.
function nextCounterBlock_(key, count) {
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateIdCounterSheet_(ss);
    const lastRow = sheet.getLastRow();
    const data = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        const start = Number(data[i][1]) || 1;
        sheet.getRange(i + 2, 2).setValue(start + count);
        return start;
      }
    }
    sheet.appendRow([key, 1 + count]);
    return 1;
  } finally {
    lock.releaseLock();
  }
}

function nextCounterValue_(key) {
  return nextCounterBlock_(key, 1);
}

// ----------------------------------------------------------
// NEW: Hoya species lookup + botanical name composer
// ----------------------------------------------------------
function findHoyaSpeciesRow_(ss, speciesValue) {
  const sheet = ss.getSheetByName(HOYA_SPECIES_SHEET_NAME);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normHeader_);
  const idxSpecies = header.indexOf(HOYA_COL_SPECIES);
  const idxInCollection = header.indexOf(HOYA_COL_IN_COLLECTION);
  const idxDateAdded = header.indexOf(HOYA_COL_DATE_ADDED);
  const idxCode = header.indexOf(HOYA_COL_ID_CODE);
  if (idxSpecies === -1) return null;

  const target = String(speciesValue || '').trim().toLowerCase();
  if (!target) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idxSpecies] || '').trim().toLowerCase() === target) {
      return { sheet, rowIndex: i + 2, values: data[i], idxInCollection, idxDateAdded, idxCode };
    }
  }
  return null;
}

// Marks a species "owned" the first time it's seen. Deliberately never
// un-marks it later (per your call: In_Collection = "have I ever owned
// this," not a live inventory count) and never overwrites an existing
// Date_Added, so the date always reflects when it was *first* acquired.
function markHoyaSpeciesOwned_(match) {
  if (!match) return;
  const { sheet, rowIndex, idxInCollection, idxDateAdded, values } = match;
  if (idxInCollection !== -1 && String(values[idxInCollection]).trim().toUpperCase() !== 'Y') {
    sheet.getRange(rowIndex, idxInCollection + 1).setValue('Y');
  }
  if (idxDateAdded !== -1 && !values[idxDateAdded]) {
    sheet.getRange(rowIndex, idxDateAdded + 1).setValue(new Date());
  }
}

function normalizeQualifier_(q) {
  const v = String(q || '').trim().toLowerCase().replace(/\.+$/, '');
  if (v === 'aff') return 'aff.';
  if (v === 'cf') return 'cf.';
  if (v === 'sp') return 'sp.';
  return '';
}

// Composes Botanical_Line1 as {plain, italicRanges} per the Hoya Naming
// Convention guide: Genus + Species are italic; Qualifier (aff./cf./sp.),
// the × hybrid marker, and any Collection_Code are roman (not italic).
function composeHoyaBotanicalLine1_(fields) {
  const genus = capitalizeWords_(fields.genus || 'Hoya');
  const species = String(fields.species || '').trim().toLowerCase();
  const qualifier = normalizeQualifier_(fields.qualifier);
  const collectionCode = String(fields.collectionCode || '').trim();
  const isHybrid = !!fields.hybrid;

  const parts = [{ text: genus, italic: true }];
  parts.push({ text: isHybrid ? ' × ' : ' ', italic: false });

  if (qualifier === 'sp.') {
    parts.push({ text: 'sp.', italic: false });
    if (collectionCode) parts.push({ text: ' ' + collectionCode, italic: false });
  } else if (qualifier === 'aff.' || qualifier === 'cf.') {
    parts.push({ text: qualifier + ' ', italic: false });
    if (species) parts.push({ text: species, italic: true });
  } else if (species) {
    parts.push({ text: species, italic: true });
  }

  let plain = '';
  const italicRanges = [];
  parts.forEach(p => {
    const start = plain.length;
    plain += p.text;
    if (p.italic && p.text.length) italicRanges.push([start, plain.length]);
  });

  return { plain: plain.trim(), italicRanges: italicRanges.map(r => {
    // trim() above may shift a trailing space off the end; ranges are only
    // ever interior to the trimmed string in practice for our part layout,
    // but clamp defensively so setTextStyle never gets an out-of-bounds end.
    return [Math.min(r[0], plain.trim().length), Math.min(r[1], plain.trim().length)];
  })};
}

// Composes Botanical_Line2 = 'Cultivar' and/or "Trade Name", per the guide.
function composeHoyaLine2_(fields) {
  const cultivar = fields.cultivar ? capitalizeWords_(fields.cultivar) : '';
  const tradeName = fields.tradeName ? capitalizeWords_(fields.tradeName) : '';
  const bits = [];
  if (cultivar) bits.push("'" + cultivar + "'");
  if (tradeName) bits.push('“' + tradeName + '”');
  return bits.join(' ');
}

function writeRichBotanicalLine1_(cell, composed) {
  if (!composed.plain) { cell.setValue(''); return; }
  const builder = SpreadsheetApp.newRichTextValue().setText(composed.plain);
  composed.italicRanges.forEach(r => {
    if (r[1] > r[0]) {
      builder.setTextStyle(r[0], r[1], SpreadsheetApp.newTextStyle().setItalic(true).build());
    }
  });
  cell.setRichTextValue(builder.build());
}

// ----------------------------------------------------------
// Export folder helpers
// ----------------------------------------------------------
function getOrCreateExportFolder() {
  const configSheet = getConfigSheet();
  let folderId = getConfigValue(configSheet, EXPORT_FOLDER_KEY);

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {}
  }

  let parent = null;
  const parentId = getConfigValue(configSheet, EXPORT_PARENT_FOLDER_KEY);
  if (parentId) {
    try { parent = DriveApp.getFolderById(parentId); } catch (e) {}
  }
  if (!parent) parent = DriveApp.getRootFolder();

  let folder = null;
  const iter = parent.getFoldersByName(EXPORT_FOLDER_NAME);
  if (iter.hasNext()) {
    folder = iter.next();
  } else {
    folder = parent.createFolder(EXPORT_FOLDER_NAME);
  }

  setConfigValue(configSheet, EXPORT_FOLDER_KEY, folder.getId());
  return folder;
}

function writeCsvToFile(folder, filename, csvContent) {
  const files = folder.getFilesByName(filename);
  if (files.hasNext()) {
    files.next().setContent(csvContent);
  } else {
    folder.createFile(filename, csvContent, MimeType.PLAIN_TEXT);
  }
}

// ----------------------------------------------------------
// Mother labels CSV
// ----------------------------------------------------------
function buildMotherLabelsCSV() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(MOTHER_SHEET_NAME);
  if (!sheet) { ss.toast('Sheet "' + MOTHER_SHEET_NAME + '" not found.', 'Labels', 5); return; }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) { ss.toast('No data in "' + MOTHER_SHEET_NAME + '" to export.', 'Labels', 5); return; }

  const data   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0].map(normHeader_);

  const idxMotherID = header.indexOf('Mother_ID');
  const idxName     = header.indexOf('Display_Name');
  const idxL1       = header.indexOf('Label_Line1');
  const idxL2       = header.indexOf('Label_Line2');
  const idxQR       = header.indexOf('QR_Link');
  const idxPrint    = findHeaderIndex_(header, ['Print_Label', 'Print']);

  if ([idxMotherID, idxName, idxL1, idxL2, idxQR, idxPrint].includes(-1)) {
    ss.toast('Required columns missing in "' + MOTHER_SHEET_NAME + '".', 'Labels', 8);
    return;
  }

  const folder = getOrCreateExportFolder();
  const out = [];
  const rowsToClear = [];

  out.push(['Mother_ID', 'Display_Name', 'Label_Line1', 'Label_Line2', 'QR_Link']);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[idxPrint] === true) {
      out.push([row[idxMotherID], row[idxName], row[idxL1], row[idxL2], row[idxQR]]);
      rowsToClear.push(i + 1);
    }
  }

  if (out.length === 1) { ss.toast('No mother rows checked in Print – nothing to export.', 'Labels', 5); return; }

  const csvContent = out.map(csvRow_).join('\n');
  writeCsvToFile(folder, 'GM_Mother_Labels.csv', csvContent);

  if (rowsToClear.length) {
    const printCol = idxPrint + 1;
    const minRow = Math.min.apply(null, rowsToClear);
    const maxRow = Math.max.apply(null, rowsToClear);
    const numRows = maxRow - minRow + 1;

    const range = sheet.getRange(minRow, printCol, numRows, 1);
    const vals  = range.getValues();

    rowsToClear.forEach(r => { vals[r - minRow][0] = false; });
    range.setValues(vals);
  }

  SpreadsheetApp.flush();
  ss.toast('Mother labels exported → GM_Mother_Labels.csv', 'Labels', 5);
}

// ----------------------------------------------------------
// Cutting labels CSV
// ----------------------------------------------------------
function buildCuttingLabelsCSV() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CUTTING_SHEET_NAME);
  if (!sheet) { ss.toast('Sheet "' + CUTTING_SHEET_NAME + '" not found.', 'Labels', 5); return; }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) { ss.toast('No data in "' + CUTTING_SHEET_NAME + '" to export.', 'Labels', 5); return; }

  const data   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0].map(normHeader_);

  const idxID    = header.indexOf('Cutting_ID');
  const idxFull  = header.indexOf('Full_Display_Name');
  const idxL1    = header.indexOf('Label_Line1');
  const idxL2    = header.indexOf('Label_Line2');
  const idxDate  = header.indexOf('Date_Taken');
  const idxQR    = header.indexOf('QR_Link');
  const idxPrint = findHeaderIndex_(header, ['Print_Label', 'Print']);

  if ([idxID, idxFull, idxL1, idxL2, idxDate, idxQR, idxPrint].includes(-1)) {
    ss.toast('Required columns missing in "' + CUTTING_SHEET_NAME + '".', 'Labels', 8);
    return;
  }

  const folder = getOrCreateExportFolder();
  const out = [];
  const rowsToClear = [];

  out.push(['Cutting_ID','Full_Display_Name','Label_Line1','Label_Line2','Date_Taken','QR_Link']);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[idxPrint] === true) {
      out.push([row[idxID], row[idxFull], row[idxL1], row[idxL2], row[idxDate], row[idxQR]]);
      rowsToClear.push(i + 1);
    }
  }

  if (out.length === 1) { ss.toast('No cutting rows checked in Print – nothing to export.', 'Labels', 5); return; }

  const csvContent = out.map(csvRow_).join('\n');
  writeCsvToFile(folder, 'GM_Cutting_Labels.csv', csvContent);

  if (rowsToClear.length) {
    const printCol = idxPrint + 1;
    const minRow = Math.min.apply(null, rowsToClear);
    const maxRow = Math.max.apply(null, rowsToClear);
    const numRows = maxRow - minRow + 1;

    const range = sheet.getRange(minRow, printCol, numRows, 1);
    const vals  = range.getValues();

    rowsToClear.forEach(r => { vals[r - minRow][0] = false; });
    range.setValues(vals);
  }

  SpreadsheetApp.flush();
  ss.toast('Cutting labels exported → GM_Cutting_Labels.csv', 'Labels', 5);
}

// ----------------------------------------------------------
// FORM SUBMIT: Form -> Label_Data_Cuttings
// ----------------------------------------------------------
function onFormSubmit(e) {
  if (!e) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const ss = SpreadsheetApp.getActive();
    const cutSheet    = ss.getSheetByName(CUTTING_SHEET_NAME);
    const motherSheet = ss.getSheetByName(SOURCE_MOTHER_TAB);
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    if (!cutSheet || !motherSheet || !configSheet) return;

    const responseRow = (e.range && e.range.getRow) ? e.range.getRow() : null;
    const responseSheetName = (e.range && e.range.getSheet) ? e.range.getSheet().getName() : 'unknown';
    if (responseRow) {
      const propKey = PROP_LAST_FORM_ROW_PREFIX + responseSheetName;
      const props = PropertiesService.getScriptProperties();
      const lastDone = Number(props.getProperty(propKey) || 0);
      if (responseRow <= lastDone) return;
      props.setProperty(propKey, String(responseRow));
    }

    // Original assumed response layout:
    // [Timestamp, Mother_ID, Location, Number of new cuttings]
    const responses = e.values || [];
    const timestamp = responses[0];
    const motherId  = (responses[1] || '').toString().trim();
    const numCuts   = Number(responses[3]) || 0;

    if (!motherId || !numCuts) return;

    const cutHeader = cutSheet.getRange(1, 1, 1, cutSheet.getLastColumn()).getValues()[0].map(normHeader_);

    const idxCutID = cutHeader.indexOf('Cutting_ID');
    const idxSold  = cutHeader.indexOf('Sold');
    const idxFull  = cutHeader.indexOf('Full_Display_Name');
    const idxL1    = cutHeader.indexOf('Label_Line1');
    const idxL2    = cutHeader.indexOf('Label_Line2');
    const idxDate  = cutHeader.indexOf('Date_Taken');
    const idxPrint = findHeaderIndex_(cutHeader, ['Print_Label', 'Print']);
    const idxQR    = cutHeader.indexOf('QR_Link');

    if ([idxCutID, idxFull, idxL1, idxL2, idxDate, idxPrint, idxQR].includes(-1)) {
      ss.toast('Label_Data_Cuttings headers missing/renamed. Check row 1.', 'Skrybix', 8);
      return;
    }

    const mData   = motherSheet.getDataRange().getValues();
    const mHeader = mData[0].map(normHeader_);

    const mIdxMID   = mHeader.indexOf(COL_MOTHER_ID);
    const mIdxName  = mHeader.indexOf(COL_DISPLAY_NAME);
    const mIdxLoc   = mHeader.indexOf(COL_LOCATION);
    const mIdxL1    = mHeader.indexOf(COL_LABEL_L1);
    const mIdxL2    = mHeader.indexOf(COL_LABEL_L2);

    if ([mIdxMID, mIdxName, mIdxLoc, mIdxL1, mIdxL2].includes(-1)) return;

    let motherRow = null;
    for (let i = 1; i < mData.length; i++) {
      if (String(mData[i][mIdxMID] || '').trim() === motherId) {
        motherRow = mData[i];
        break;
      }
    }
    if (!motherRow) {
      logError_('onFormSubmit', 'No Mother_Plants row found for Mother_ID "' + motherId + '" (form response row ' + responseRow + ')');
      return;
    }

    const fullDisplayName = motherRow[mIdxName];
    const location        = motherRow[mIdxLoc];
    const labelLine1       = motherRow[mIdxL1];
    const labelLine2       = motherRow[mIdxL2];

    const qrLink = buildQrLink_(configSheet, motherId, location);

    // FIX (v2): was a scan of existing rows for the max sequence — broken
    // by design once sold cuttings get archived away (see Archive_Cuttings
    // below), since archived rows would no longer be there to scan. Now
    // uses the persistent, never-reused counter instead.
    const width = cutSheet.getLastColumn();
    const seqStart = nextCounterBlock_('CUTSEQ::' + motherId, numCuts);
    const prefix = motherId + '-C';

    const rowsToAdd = [];
    for (let n = 0; n < numCuts; n++) {
      const seq = seqStart + n;
      const seqStr = String(seq).padStart(2, '0'); // never truncates past 99
      const cuttingId = prefix + seqStr;

      const row = new Array(width).fill('');
      row[idxCutID] = cuttingId;
      if (idxSold !== -1) row[idxSold] = false;
      row[idxFull]  = fullDisplayName;
      row[idxL1]    = labelLine1;
      row[idxL2]    = labelLine2;
      row[idxDate]  = new Date(timestamp);
      row[idxPrint] = false;
      row[idxQR]    = qrLink;

      rowsToAdd.push(row);
    }

    if (!rowsToAdd.length) return;

    const startRow = cutSheet.getLastRow() + 1;
    cutSheet.getRange(startRow, 1, rowsToAdd.length, width).setValues(rowsToAdd);

    const rule = checkboxRule_();
    if (idxSold !== -1) cutSheet.getRange(startRow, idxSold + 1, rowsToAdd.length, 1).setDataValidation(rule);
    cutSheet.getRange(startRow, idxPrint + 1, rowsToAdd.length, 1).setDataValidation(rule);

    SpreadsheetApp.flush();

  } catch (err) {
    logError_('onFormSubmit', err);
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------------------------------------
// onEdit: Mother sync (now Hoya-aware) + Outgoing_Log Date_Out
// ----------------------------------------------------------
function onEdit(e) {
  if (!e) return;

  try {
    const range = e.range;
    const sheet = range.getSheet();
    const sheetName = sheet.getName();
    const ss = sheet.getParent();

    if (sheetName === SOURCE_MOTHER_TAB && range.getRow() > 1) {
      const firstRow = range.getRow();
      const numRows = range.getNumRows();
      for (let r = firstRow; r < firstRow + numRows; r++) {
        if (r === 1) continue;
        try { syncMotherRow_(ss, r); } catch (err) { logError_('onEdit/syncMotherRow_ row ' + r, err); }
      }
    }

    const colCutID = 2;
    const colDateOut = 1;
    const headerRow = 1;

    if (sheetName === OUTGOING_SHEET_NAME &&
        range.getColumn() === colCutID &&
        range.getRow() > headerRow) {

      const firstRow = range.getRow();
      const numRows = range.getNumRows();
      const values = range.getValues();
      for (let i = 0; i < numRows; i++) {
        const rowNum = firstRow + i;
        const newValue = values[i][0];
        if (!newValue) continue;
        const dateCell = sheet.getRange(rowNum, colDateOut);
        if (!dateCell.getValue()) dateCell.setValue(new Date());
      }
    }
  } catch (err) {
    logError_('onEdit', err);
  }
}

// ----------------------------------------------------------
// ACTION: Push Sold -> Outgoing_Log (now archives the row instead of
// just clearing the Sold checkbox, so Label_Data_Cuttings only ever
// reflects cuttings you actually still have)
// ----------------------------------------------------------
function pushSoldToOutgoingLog() {
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { ss.toast('Skrybix is busy, try again in a moment.', 'Actions', 5); return; }

  try {
    const cutSheet = ss.getSheetByName(CUTTING_SHEET_NAME);
    const outSheet = ss.getSheetByName(OUTGOING_SHEET_NAME);

    if (!cutSheet) { ss.toast('Sheet "' + CUTTING_SHEET_NAME + '" not found.', 'Actions', 8); return; }
    if (!outSheet) { ss.toast('Sheet "' + OUTGOING_SHEET_NAME + '" not found.', 'Actions', 8); return; }

    const cutLastRow = cutSheet.getLastRow();
    const cutLastCol = cutSheet.getLastColumn();
    if (cutLastRow < 2) { ss.toast('No data in "' + CUTTING_SHEET_NAME + '" to process.', 'Actions', 6); return; }

    const cutData = cutSheet.getRange(1, 1, cutLastRow, cutLastCol).getValues();
    const cutHdr  = cutData[0].map(h => String(h).trim());

    const idxSold  = cutHdr.indexOf('Sold');
    const idxCutId = cutHdr.indexOf('Cutting_ID');
    const idxFullInCut = cutHdr.indexOf('Full_Display_Name');

    if (idxSold === -1)  { ss.toast('"' + CUTTING_SHEET_NAME + '" missing header: Sold', 'Actions', 10); return; }
    if (idxCutId === -1) { ss.toast('"' + CUTTING_SHEET_NAME + '" missing header: Cutting_ID', 'Actions', 10); return; }

    const outHdr = outSheet.getRange(1, 1, 1, outSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());

    const outIdx = {
      Date_Out: outHdr.indexOf('Date_Out'),
      Cutting_ID: outHdr.indexOf('Cutting_ID'),
      Full_Display_Name: outHdr.indexOf('Full_Display_Name'),
      Qty: outHdr.indexOf('Qty'),
      Reason: outHdr.indexOf('Reason'),
      Selling_Platform: outHdr.indexOf('Selling_Platform'),
      Notes: outHdr.indexOf('Notes')
    };

    for (const k of ['Date_Out','Cutting_ID','Qty','Reason']) {
      if (outIdx[k] === -1) { ss.toast('Outgoing_Log missing required header: ' + k, 'Actions', 10); return; }
    }

    const { firstEmptyRow, existingIds } = getOutgoingInsertPoint_(outSheet, outIdx.Cutting_ID + 1);

    const today = new Date(); today.setHours(0,0,0,0);

    const rowsToAppend = [];
    const rowsToArchive = [];

    for (let r = 1; r < cutData.length; r++) {
      if (cutData[r][idxSold] !== true) continue;

      const id = String(cutData[r][idxCutId] || '').trim();
      rowsToArchive.push(r + 1);

      if (!id) continue;
      if (existingIds.has(id)) continue;

      const newRow = new Array(outHdr.length).fill('');
      newRow[outIdx.Date_Out]   = today;
      newRow[outIdx.Cutting_ID] = id;
      newRow[outIdx.Qty]        = 1;
      newRow[outIdx.Reason]     = 'Sale';

      if (outIdx.Full_Display_Name !== -1 && idxFullInCut !== -1) {
        newRow[outIdx.Full_Display_Name] = cutData[r][idxFullInCut];
      }

      rowsToAppend.push(newRow);
      existingIds.add(id);
    }

    if (rowsToAppend.length) {
      outSheet.getRange(firstEmptyRow, 1, rowsToAppend.length, outHdr.length).setValues(rowsToAppend);
    }

    // FIX (v2): rows used to just have their Sold checkbox cleared and
    // stay in Label_Data_Cuttings forever, so any "how many cuttings do
    // I have" count kept including things you'd already sold. Now the
    // row is moved to Archive_Cuttings and removed from the active sheet.
    archiveAndRemoveCuttingRows_(ss, cutSheet, rowsToArchive);

    SpreadsheetApp.flush();
    if (!rowsToAppend.length && !rowsToArchive.length) {
      ss.toast('No sold cuttings to push.', 'Actions', 6);
    } else {
      ss.toast('Pushed ' + rowsToAppend.length + ' → Outgoing_Log, archived ' + rowsToArchive.length + ' row(s).', 'Actions', 8);
    }
  } catch (err) {
    logError_('pushSoldToOutgoingLog', err);
    ss.toast('Push Sold failed — see Error_Log tab.', 'Actions', 8);
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------------------------------------
// ACTION: Push SELECTED cuttings -> Outgoing_Log (also archives them)
// ----------------------------------------------------------
function pushSelectedCuttingsToOutgoingLog() {
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { ss.toast('Skrybix is busy, try again in a moment.', 'Actions', 5); return; }

  try {
    const cutSheet = ss.getSheetByName(CUTTING_SHEET_NAME);
    const outSheet = ss.getSheetByName(OUTGOING_SHEET_NAME);

    if (!cutSheet) { ss.toast('Sheet "' + CUTTING_SHEET_NAME + '" not found.', 'Actions', 8); return; }
    if (!outSheet) { ss.toast('Sheet "' + OUTGOING_SHEET_NAME + '" not found.', 'Actions', 8); return; }

    const activeSheet = ss.getActiveSheet();
    if (activeSheet.getName() !== CUTTING_SHEET_NAME) {
      ss.toast('Go to "' + CUTTING_SHEET_NAME + '" and select the rows you want pushed.', 'Actions', 8);
      return;
    }

    const selection = activeSheet.getActiveRange();
    if (!selection) { ss.toast('Select at least one row to push.', 'Actions', 6); return; }

    const selRow = selection.getRow();
    const selNumRows = selection.getNumRows();

    const cutLastCol = cutSheet.getLastColumn();
    const cutHdr = cutSheet.getRange(1, 1, 1, cutLastCol).getValues()[0].map(h => String(h).trim());
    const idxCutId = cutHdr.indexOf('Cutting_ID');
    const idxFull  = cutHdr.indexOf('Full_Display_Name');

    if (idxCutId === -1) { ss.toast('"' + CUTTING_SHEET_NAME + '" missing header: Cutting_ID', 'Actions', 10); return; }

    const rows = cutSheet.getRange(selRow, 1, selNumRows, cutLastCol).getValues();

    const idsToPush = [];
    const fullById = new Map();

    for (let i = 0; i < rows.length; i++) {
      const id = String(rows[i][idxCutId] || '').trim();
      if (!id) continue;
      idsToPush.push(id);
      if (idxFull !== -1) fullById.set(id, rows[i][idxFull]);
    }

    if (!idsToPush.length) { ss.toast('No Cutting_IDs found in the selected rows.', 'Actions', 8); return; }

    const outHdr = outSheet.getRange(1, 1, 1, outSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());

    const outIdx = {
      Date_Out: outHdr.indexOf('Date_Out'),
      Cutting_ID: outHdr.indexOf('Cutting_ID'),
      Full_Display_Name: outHdr.indexOf('Full_Display_Name'),
      Qty: outHdr.indexOf('Qty'),
      Reason: outHdr.indexOf('Reason'),
      Selling_Platform: outHdr.indexOf('Selling_Platform'),
      Notes: outHdr.indexOf('Notes')
    };

    for (const k of ['Date_Out','Cutting_ID','Qty','Reason']) {
      if (outIdx[k] === -1) { ss.toast('Outgoing_Log missing required header: ' + k, 'Actions', 10); return; }
    }

    const { firstEmptyRow, existingIds } = getOutgoingInsertPoint_(outSheet, outIdx.Cutting_ID + 1);

    const today = new Date(); today.setHours(0,0,0,0);

    const rowsToAppend = [];
    for (let i = 0; i < idsToPush.length; i++) {
      const id = idsToPush[i];
      if (existingIds.has(id)) continue;

      const newRow = new Array(outHdr.length).fill('');
      newRow[outIdx.Date_Out]   = today;
      newRow[outIdx.Cutting_ID] = id;
      newRow[outIdx.Qty]        = 1;
      newRow[outIdx.Reason]     = 'Sale';

      if (outIdx.Full_Display_Name !== -1 && fullById.has(id)) {
        newRow[outIdx.Full_Display_Name] = fullById.get(id);
      }

      rowsToAppend.push(newRow);
      existingIds.add(id);
    }

    if (rowsToAppend.length) {
      outSheet.getRange(firstEmptyRow, 1, rowsToAppend.length, outHdr.length).setValues(rowsToAppend);
    }

    // FIX (v2): archive + remove every selected row, same as pushSold.
    const rowNumbers = [];
    for (let i = 0; i < selNumRows; i++) rowNumbers.push(selRow + i);
    archiveAndRemoveCuttingRows_(ss, cutSheet, rowNumbers);

    SpreadsheetApp.flush();
    ss.toast('Pushed ' + rowsToAppend.length + ' → Outgoing_Log, archived ' + rowNumbers.length + ' row(s).', 'Actions', 8);
  } catch (err) {
    logError_('pushSelectedCuttingsToOutgoingLog', err);
    ss.toast('Push failed — see Error_Log tab.', 'Actions', 8);
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------------------------------------
// NEW: Archive_Cuttings — moves full rows out of Label_Data_Cuttings
// once they've been logged as sold, stamped with when they were archived.
// Nothing is lost (full row data is preserved), but active inventory
// (Label_Data_Cuttings) stops counting things you no longer have.
// ----------------------------------------------------------
function getOrCreateArchiveSheet_(ss, cutSheet) {
  let sheet = ss.getSheetByName(ARCHIVE_CUTTING_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ARCHIVE_CUTTING_SHEET_NAME);
    const header = cutSheet.getRange(1, 1, 1, cutSheet.getLastColumn()).getValues()[0];
    sheet.getRange(1, 1, 1, header.length + 1).setValues([header.concat(['Archived_Date'])]);
  }
  return sheet;
}

function archiveAndRemoveCuttingRows_(ss, cutSheet, rowNumbers) {
  if (!rowNumbers || !rowNumbers.length) return;
  const uniqueRows = Array.from(new Set(rowNumbers)).sort((a, b) => a - b);
  if (!uniqueRows.length) return;

  const archiveSheet = getOrCreateArchiveSheet_(ss, cutSheet);
  const width = cutSheet.getLastColumn();
  const today = new Date();

  const rowsData = uniqueRows.map(r => cutSheet.getRange(r, 1, 1, width).getValues()[0]);
  const archiveStartRow = archiveSheet.getLastRow() + 1;
  const archiveRows = rowsData.map(r => r.concat([today]));
  archiveSheet.getRange(archiveStartRow, 1, archiveRows.length, width + 1).setValues(archiveRows);

  // Delete bottom-up so earlier row numbers in the list stay valid.
  uniqueRows.slice().sort((a, b) => b - a).forEach(r => cutSheet.deleteRow(r));
}

// ----------------------------------------------------------
// Helper: Find first true empty row based on DISPLAY values in Cutting_ID column
// ----------------------------------------------------------
function getOutgoingInsertPoint_(outSheet, cuttingIdColNumber) {
  const lastUsedRow = Math.max(outSheet.getLastRow(), 2);

  const scanRows = Math.max(1, lastUsedRow - 1);
  const idDisplay = outSheet.getRange(2, cuttingIdColNumber, scanRows, 1).getDisplayValues();

  let firstEmptyRow = lastUsedRow + 1;
  const existingIds = new Set();

  for (let i = 0; i < idDisplay.length; i++) {
    const v = String(idDisplay[i][0] || '').trim();
    if (v) existingIds.add(v);
    if (!v && firstEmptyRow === lastUsedRow + 1) {
      firstEmptyRow = i + 2;
    }
  }

  return { firstEmptyRow, existingIds };
}

// ----------------------------------------------------------
// Sync a single Mother_Plants row into Label_Data_Mothers — now also:
//  - auto-composes Botanical_Line1 (rich-text italic) / Line2 from the
//    structured Genus/Species/Qualifier/Cultivar/Trade_Name/Hybrid fields
//    (only when Species is filled in — legacy rows are left untouched)
//  - auto-assigns Mother_ID from the species code when it's blank
//  - marks the species "owned" on Hoya_Species
// ----------------------------------------------------------
function syncMotherRow_(ss, rowIndex) {
  const motherSheet = ss.getSheetByName(SOURCE_MOTHER_TAB);
  const labelSheet  = ss.getSheetByName(MOTHER_SHEET_NAME);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!motherSheet || !labelSheet || !configSheet) return;

  const header = motherSheet.getRange(1, 1, 1, motherSheet.getLastColumn()).getValues()[0].map(normHeader_);
  const idxMID  = header.indexOf(COL_MOTHER_ID);
  const idxName = header.indexOf(COL_DISPLAY_NAME);
  const idxLoc  = header.indexOf(COL_LOCATION);
  const idxL1   = header.indexOf(COL_LABEL_L1);
  const idxL2   = header.indexOf(COL_LABEL_L2);
  if ([idxMID, idxName, idxLoc, idxL1, idxL2].includes(-1)) return;

  const idxGenus   = header.indexOf(COL_GENUS);
  const idxSpecies = header.indexOf(COL_SPECIES);
  const idxQual    = header.indexOf(COL_QUALIFIER);
  const idxCode    = header.indexOf(COL_COLLECTION_CODE);
  const idxCultivar = header.indexOf(COL_CULTIVAR);
  const idxTrade   = header.indexOf(COL_TRADE_NAME);
  const idxHybrid  = header.indexOf(COL_HYBRID);

  const rowVals = motherSheet.getRange(rowIndex, 1, 1, motherSheet.getLastColumn()).getValues()[0];
  const speciesValue = idxSpecies !== -1 ? String(rowVals[idxSpecies] || '').trim() : '';

  // --- Hoya naming automation (only runs once Species is filled in) ---
  if (speciesValue) {
    const genusValue = idxGenus !== -1 ? String(rowVals[idxGenus] || 'Hoya').trim() : 'Hoya';
    const fields = {
      genus: genusValue,
      species: speciesValue,
      qualifier: idxQual !== -1 ? rowVals[idxQual] : '',
      collectionCode: idxCode !== -1 ? rowVals[idxCode] : '',
      cultivar: idxCultivar !== -1 ? rowVals[idxCultivar] : '',
      tradeName: idxTrade !== -1 ? rowVals[idxTrade] : '',
      hybrid: idxHybrid !== -1 ? !!rowVals[idxHybrid] : false,
    };

    const composedL1 = composeHoyaBotanicalLine1_(fields);
    const composedL2 = composeHoyaLine2_(fields);
    writeRichBotanicalLine1_(motherSheet.getRange(rowIndex, idxL1 + 1), composedL1);
    motherSheet.getRange(rowIndex, idxL2 + 1).setValue(composedL2);

    const isHoya = genusValue.toLowerCase() === 'hoya';
    if (isHoya) {
      const speciesMatch = findHoyaSpeciesRow_(ss, speciesValue);
      if (!speciesMatch) {
        logError_('syncMotherRow_/HoyaSpecies', 'Species "' + speciesValue + '" (row ' + rowIndex + ' of Mother_Plants) not found in ' + HOYA_SPECIES_SHEET_NAME + ' — check spelling. Mother_ID auto-assignment and species tracking were skipped for this row.');
      } else {
        markHoyaSpeciesOwned_(speciesMatch);

        // Auto-assign Mother_ID from the species code, but ONLY if blank —
        // never touches an ID that's already there.
        const currentId = String(rowVals[idxMID] || '').trim();
        if (!currentId && speciesMatch.idxCode !== -1) {
          const code = String(speciesMatch.values[speciesMatch.idxCode] || '').trim();
          if (code) {
            const seq = nextCounterValue_('MOTHERID::' + code);
            const newId = code + '-' + String(seq).padStart(3, '0');
            motherSheet.getRange(rowIndex, idxMID + 1).setValue(newId);
          }
        }
      }
    }
  }

  // --- Re-read after any auto-assignment above, then propagate as before ---
  const finalVals = motherSheet.getRange(rowIndex, 1, 1, motherSheet.getLastColumn()).getValues()[0];
  const motherId = finalVals[idxMID];
  if (!motherId) return;

  const displayName = finalVals[idxName];
  const location    = finalVals[idxLoc];
  const labelL2      = finalVals[idxL2];

  const qrLink = buildQrLink_(configSheet, motherId, location);
  if (!qrLink) return;

  const lastRowLabel = labelSheet.getLastRow();
  let targetRow = -1;
  if (lastRowLabel >= 2) {
    const ids = labelSheet.getRange(2, 1, lastRowLabel - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === motherId) { targetRow = i + 2; break; }
    }
  }
  if (targetRow === -1) targetRow = lastRowLabel + 1;

  labelSheet.getRange(targetRow, 1, 1, 7).setValues([[motherId, displayName, location, '', labelL2, false, qrLink]]);
  // Copy Botanical_Line1 as rich text so the italics survive the copy —
  // setValues() above intentionally left column 4 blank first.
  const richL1 = motherSheet.getRange(rowIndex, idxL1 + 1).getRichTextValue();
  labelSheet.getRange(targetRow, 4).setRichTextValue(richL1);
  labelSheet.getRange(targetRow, 6).setDataValidation(checkboxRule_());
}

// ----------------------------------------------------------
// Backup copy (with retention pruning)
// ----------------------------------------------------------
function createBackupCopy() {
  const ss = SpreadsheetApp.getActive();
  const file = DriveApp.getFileById(ss.getId());
  const timestamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd-HHmmss');
  const newName = ss.getName() + ' - Backup ' + timestamp;

  const parentsIter = file.getParents();
  const parent = parentsIter.hasNext() ? parentsIter.next() : DriveApp.getRootFolder();
  file.makeCopy(newName, parent);

  try {
    const prefix = ss.getName() + ' - Backup ';
    const files = parent.getFiles();
    const backups = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().indexOf(prefix) === 0) {
        backups.push({ file: f, created: f.getDateCreated() });
      }
    }
    backups.sort((a, b) => b.created - a.created);
    for (let i = MAX_BACKUPS_TO_KEEP; i < backups.length; i++) {
      backups[i].file.setTrashed(true);
    }
  } catch (err) {
    logError_('createBackupCopy/prune', err);
  }

  SpreadsheetApp.getUi().alert('Backup created:\n' + newName);
}

// ----------------------------------------------------------
// Rebuild Label_Data_Mothers from Mother_Plants (bulk refresh)
// ----------------------------------------------------------
function rebuildLabelDataMothersValues() {
  const ss = SpreadsheetApp.getActive();
  const motherSheet = ss.getSheetByName(SOURCE_MOTHER_TAB);
  const labelSheet  = ss.getSheetByName(MOTHER_SHEET_NAME);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);

  if (!motherSheet || !labelSheet || !configSheet) {
    ss.toast('Missing Mother_Plants, Label_Data_Mothers, or Config sheet.', 'Labels', 8);
    return;
  }

  const templateUrl = configSheet.getRange('B9').getValue();
  if (!templateUrl || templateUrl.indexOf('MOTHERIDTOKEN') === -1 || templateUrl.indexOf('LOCATIONTOKEN') === -1) {
    ss.toast('Config!B9 must contain FULL prefilled form URL with MOTHERIDTOKEN and LOCATIONTOKEN.', 'Labels', 10);
    return;
  }

  const mData = motherSheet.getDataRange().getValues();
  if (mData.length < 2) { ss.toast('No data in Mother_Plants to rebuild from.', 'Labels', 5); return; }

  const mHeader = mData[0].map(normHeader_);
  const idxMID   = mHeader.indexOf(COL_MOTHER_ID);
  const idxName  = mHeader.indexOf(COL_DISPLAY_NAME);
  const idxLoc   = mHeader.indexOf(COL_LOCATION);
  const idxL1    = mHeader.indexOf(COL_LABEL_L1);
  const idxL2    = mHeader.indexOf(COL_LABEL_L2);

  if ([idxMID, idxName, idxLoc, idxL1, idxL2].includes(-1)) {
    ss.toast('Mother_Plants is missing required columns.', 'Labels', 8);
    return;
  }

  const rowsOut = [];
  const sourceRowIndexes = []; // 1-based Mother_Plants row for each rowsOut entry, for rich-text copy
  for (let i = 1; i < mData.length; i++) {
    const row = mData[i];
    const motherId = row[idxMID];
    if (!motherId) continue;

    const displayName = row[idxName];
    const location    = row[idxLoc];
    const labelL2     = row[idxL2];

    const qrLink = buildQrLink_(configSheet, motherId, location);

    rowsOut.push([motherId, displayName, location, '', labelL2, false, qrLink]);
    sourceRowIndexes.push(i + 1);
  }

  const maxRows = labelSheet.getMaxRows();
  if (maxRows > 1) labelSheet.getRange(2, 1, maxRows - 1, 7).clearContent();

  if (rowsOut.length) {
    labelSheet.getRange(2, 1, rowsOut.length, 7).setValues(rowsOut);
    labelSheet.getRange(2, 6, rowsOut.length, 1).setDataValidation(checkboxRule_());

    // Copy Botanical_Line1 rich text (italics) cell-by-cell — bulk
    // setValues() can't carry per-character formatting.
    for (let i = 0; i < sourceRowIndexes.length; i++) {
      const richL1 = motherSheet.getRange(sourceRowIndexes[i], idxL1 + 1).getRichTextValue();
      labelSheet.getRange(2 + i, 4).setRichTextValue(richL1);
    }
  }

  SpreadsheetApp.flush();
  ss.toast('Label_Data_Mothers rebuilt from Mother_Plants.', 'Labels', 5);
}

// ----------------------------------------------------------
// Repair Checkboxes — reapplies checkbox validation across the full
// used range of the Print/Sold columns (catches manually-typed rows).
// ----------------------------------------------------------
function repairCheckboxValidation() {
  const ss = SpreadsheetApp.getActive();
  const rule = checkboxRule_();
  let fixedCount = 0;

  const motherSheet = ss.getSheetByName(MOTHER_SHEET_NAME);
  if (motherSheet && motherSheet.getLastRow() >= 2) {
    const header = motherSheet.getRange(1, 1, 1, motherSheet.getLastColumn()).getValues()[0].map(normHeader_);
    const idxPrint = findHeaderIndex_(header, ['Print_Label', 'Print']);
    if (idxPrint !== -1) {
      motherSheet.getRange(2, idxPrint + 1, motherSheet.getLastRow() - 1, 1).setDataValidation(rule);
      fixedCount++;
    }
  }

  const cutSheet = ss.getSheetByName(CUTTING_SHEET_NAME);
  if (cutSheet && cutSheet.getLastRow() >= 2) {
    const header = cutSheet.getRange(1, 1, 1, cutSheet.getLastColumn()).getValues()[0].map(normHeader_);
    const idxPrint = findHeaderIndex_(header, ['Print_Label', 'Print']);
    const idxSold  = header.indexOf('Sold');
    if (idxPrint !== -1) { cutSheet.getRange(2, idxPrint + 1, cutSheet.getLastRow() - 1, 1).setDataValidation(rule); fixedCount++; }
    if (idxSold  !== -1) { cutSheet.getRange(2, idxSold + 1, cutSheet.getLastRow() - 1, 1).setDataValidation(rule); fixedCount++; }
  }

  ss.toast('Checkbox validation reapplied to ' + fixedCount + ' column(s).', 'Actions', 6);
}

// ----------------------------------------------------------
// NEW: One-time v2 setup — adds the new Mother_Plants columns and their
// dropdowns/checkboxes, and creates ID_Counters / Archive_Cuttings if
// they don't already exist. Safe to run more than once.
// ----------------------------------------------------------
function setupSkrybixV2() {
  const ss = SpreadsheetApp.getActive();
  const motherSheet = ss.getSheetByName(SOURCE_MOTHER_TAB);
  if (!motherSheet) { ss.toast('Mother_Plants tab not found.', 'Setup', 8); return; }

  const header = motherSheet.getRange(1, 1, 1, motherSheet.getLastColumn()).getValues()[0].map(normHeader_);
  const newCols = [COL_GENUS, COL_SPECIES, COL_QUALIFIER, COL_COLLECTION_CODE, COL_CULTIVAR, COL_TRADE_NAME, COL_HYBRID];
  const missing = newCols.filter(c => header.indexOf(c) === -1);
  if (missing.length) {
    const startCol = motherSheet.getLastColumn() + 1;
    motherSheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  }

  const header2 = motherSheet.getRange(1, 1, 1, motherSheet.getLastColumn()).getValues()[0].map(normHeader_);
  const idxGenus = header2.indexOf(COL_GENUS);
  const idxSpecies = header2.indexOf(COL_SPECIES);
  const idxQualifier = header2.indexOf(COL_QUALIFIER);
  const idxHybrid = header2.indexOf(COL_HYBRID);

  const validationRows = Math.max(motherSheet.getMaxRows() - 1, 200);

  if (idxHybrid !== -1) {
    motherSheet.getRange(2, idxHybrid + 1, validationRows, 1).setDataValidation(checkboxRule_());
  }
  if (idxQualifier !== -1) {
    const qualRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['', 'aff.', 'cf.', 'sp.'], true).setAllowInvalid(false).build();
    motherSheet.getRange(2, idxQualifier + 1, validationRows, 1).setDataValidation(qualRule);
  }
  if (idxGenus !== -1) {
    const genusRule = SpreadsheetApp.newDataValidation().requireValueInList(['Hoya'], true).build();
    motherSheet.getRange(2, idxGenus + 1, validationRows, 1).setDataValidation(genusRule);
  }

  const speciesSheet = ss.getSheetByName(HOYA_SPECIES_SHEET_NAME);
  if (idxSpecies !== -1 && speciesSheet) {
    const speciesHeader = speciesSheet.getRange(1, 1, 1, speciesSheet.getLastColumn()).getValues()[0].map(normHeader_);
    const speciesCol = speciesHeader.indexOf(HOYA_COL_SPECIES) + 1;
    const speciesLastRow = speciesSheet.getLastRow();
    if (speciesCol > 0 && speciesLastRow >= 2) {
      const speciesRange = speciesSheet.getRange(2, speciesCol, speciesLastRow - 1, 1);
      const speciesRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(speciesRange, true).setAllowInvalid(false).build();
      motherSheet.getRange(2, idxSpecies + 1, validationRows, 1).setDataValidation(speciesRule);
    }
  }

  getOrCreateIdCounterSheet_(ss);
  const cutSheet = ss.getSheetByName(CUTTING_SHEET_NAME);
  if (cutSheet) getOrCreateArchiveSheet_(ss, cutSheet);

  ss.toast('Skrybix v2 setup complete: new Mother_Plants columns, dropdowns, ID_Counters, and Archive_Cuttings are ready.', 'Setup', 10);
}
