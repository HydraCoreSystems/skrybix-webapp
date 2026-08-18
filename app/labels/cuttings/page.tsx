import { getSupabaseServerClient } from "@/lib/supabase";
import { CUTTING_INSTAGRAM_URL, qrDataUri } from "@/lib/qr";
import { clearCuttingPrintQueue, clearPrintedCuttings } from "../actions";
import PrintButton from "@/components/PrintButton";
import LabelStartPicker from "@/components/LabelStartPicker";
import LabelSheets from "@/components/LabelSheets";
import { parseStartPosition, sizeClassForLine } from "@/lib/labels";
import type { Cutting } from "@/lib/types";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function CuttingLabelsPage({
  searchParams,
}: {
  searchParams: { start?: string };
}) {
  const start = parseStartPosition(searchParams.start);
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("cuttings").select("*").eq("print_label", true);
  const rows = (rowsRaw ?? []) as Cutting[];

  // Every cutting label's QR encodes the same Instagram profile URL
  // directly (see lib/qr.ts) -- generate it once rather than per row.
  const instagramQr = await qrDataUri(CUTTING_INSTAGRAM_URL);
  const items = rows.map((r) => ({
    id: r.cutting_id,
    line1: r.label_line1,
    line2: r.label_line2,
    qr: instagramQr,
  }));

  return (
    <div className="card">
      <h3 className="no-print" style={{ marginTop: 0 }}>
        Cutting Labels ({items.length} queued)
      </h3>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton ids={items.map((i) => i.id)} onConfirmPrinted={clearPrintedCuttings} />{" "}
        <form className="inline" action={clearCuttingPrintQueue}>
          <button className="btn secondary" type="submit">
            Clear entire queue (manual override)
          </button>
        </form>
      </div>
      {items.length === 0 ? (
        <p className="no-print">Nothing queued. Go to Cuttings and click &quot;Queue for print.&quot;</p>
      ) : (
        <>
          <LabelStartPicker basePath="/labels/cuttings" start={start} count={items.length} />
          <LabelSheets
            items={items}
            start={start}
            cellClassName="cutting"
            renderCell={(item) => (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="logo" src="/gm-logo.png" alt="" />
                <div className="text">
                  <div className="id">{item.id}</div>
                  <div className={`line size-${sizeClassForLine(item.line1)}`}>{item.line1}</div>
                  <div className={`line size-${sizeClassForLine(item.line2)}`}>{item.line2}</div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={item.qr} alt="" />
              </>
            )}
          />
        </>
      )}
    </div>
  );
}
