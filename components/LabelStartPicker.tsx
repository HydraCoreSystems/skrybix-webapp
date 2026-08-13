import Link from "next/link";
import { LABELS_PER_SHEET } from "@/lib/labels";

export default function LabelStartPicker({
  basePath,
  start,
  count,
}: {
  basePath: string;
  start: number;
  count: number;
}) {
  const cells = [];
  for (let n = 1; n <= LABELS_PER_SHEET; n++) {
    const state = n < start ? "used" : n < start + count ? "will-print" : "empty";
    cells.push(
      <Link key={n} href={`${basePath}?start=${n}`} className={`picker-cell ${state}`}>
        {n}
      </Link>
    );
  }

  const overflow = start + count - 1 > LABELS_PER_SHEET;

  return (
    <div className="no-print" style={{ marginBottom: 20 }}>
      <label style={{ marginBottom: 8 }}>
        Start printing at position {start} — click the first blank label on your leftover sheet
      </label>
      <div className="start-picker-panel">
        <div className="start-picker">{cells}</div>
        <div className="picker-legend-row">
          <span className="picker-legend-item">
            <span className="picker-legend used" /> already used
          </span>
          <span className="picker-legend-item">
            <span className="picker-legend will-print" /> will print this run
          </span>
          <span className="picker-legend-item">
            <span className="picker-legend empty" /> still blank
          </span>
        </div>
      </div>
      {overflow && (
        <div className="flash error" style={{ marginTop: 10 }}>
          This run needs {count} labels starting at position {start}, which runs past position{" "}
          {LABELS_PER_SHEET} — it will continue onto a second sheet.
        </div>
      )}
    </div>
  );
}
