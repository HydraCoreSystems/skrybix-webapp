import { getSupabaseServerClient } from "@/lib/supabase";
import { publicCuttingUrl, qrDataUri } from "@/lib/qr";
import { clearCuttingPrintQueue } from "../actions";
import PrintButton from "@/components/PrintButton";
import LabelStartPicker from "@/components/LabelStartPicker";
import { parseStartPosition } from "@/lib/labels";
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

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.cutting_id,
      line1: r.label_line1,
      line2: r.label_line2,
      qr: await qrDataUri(publicCuttingUrl(r.cutting_id)),
    }))
  );

  return (
    <div className="card">
      <h3 className="no-print" style={{ marginTop: 0 }}>
        Cutting Labels ({items.length} queued)
      </h3>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />{" "}
        <form className="inline" action={clearCuttingPrintQueue}>
          <button className="btn secondary" type="submit">
            Clear print queue
          </button>
        </form>
      </div>
      {items.length === 0 ? (
        <p className="no-print">Nothing queued. Go to Cuttings and click &quot;Queue for print.&quot;</p>
      ) : (
        <>
          <LabelStartPicker basePath="/labels/cuttings" start={start} count={items.length} />
          <div className="label-sheet">
            {Array.from({ length: start - 1 }).map((_, i) => (
              <div className="label-cell cutting" key={`blank-${i}`} />
            ))}
            {items.map((item) => (
              <div className="label-cell cutting" key={item.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="logo" src="/gm-logo.png" alt="" />
                <div className="text">
                  <div className="id">{item.id}</div>
                  <div className="line">{item.line1}</div>
                  <div className="line">{item.line2}</div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={item.qr} alt="" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
