import { chunkIntoSheets } from "@/lib/labels";

// Renders one .label-sheet grid per physical sheet the queue actually
// needs (see chunkIntoSheets) instead of one endless grid -- a run that
// overflows past 30 labels gets a real second sheet with its own margin
// offset and a forced page break in print (.label-sheet + .label-sheet
// in globals.css), rather than silently misaligning on page 2.
export default function LabelSheets<T extends { id: string }>({
  items,
  start,
  cellClassName,
  renderCell,
}: {
  items: T[];
  start: number;
  cellClassName?: string;
  renderCell: (item: T) => React.ReactNode;
}) {
  const sheets = chunkIntoSheets(items, start);
  const cellClass = cellClassName ? `label-cell ${cellClassName}` : "label-cell";

  return (
    <>
      {sheets.map((sheet, sheetIndex) => (
        <div className="label-sheet" key={sheetIndex}>
          {Array.from({ length: sheet.blanks }).map((_, i) => (
            <div className={cellClass} key={`blank-${sheetIndex}-${i}`} />
          ))}
          {sheet.items.map((item) => (
            <div className={cellClass} key={item.id}>
              {renderCell(item)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
