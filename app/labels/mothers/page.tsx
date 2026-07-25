import { getSupabaseServerClient } from "@/lib/supabase";
import { publicPlantUrl, qrDataUri } from "@/lib/qr";
import { clearMotherPrintQueue } from "../actions";
import PrintButton from "@/components/PrintButton";
import type { MotherPlant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MotherLabelsPage() {
  const supabase = getSupabaseServerClient();
  const { data: rowsRaw } = await supabase.from("mother_plants").select("*").eq("print_label", true);
  const rows = (rowsRaw ?? []) as MotherPlant[];

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.mother_id,
      line1: r.botanical_line1,
      line2: r.botanical_line2,
      qr: await qrDataUri(publicPlantUrl(r.mother_id)),
    }))
  );

  return (
    <div className="card">
      <h3 className="no-print" style={{ marginTop: 0 }}>
        Mother Labels ({items.length} queued)
      </h3>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />{" "}
        <form className="inline" action={clearMotherPrintQueue}>
          <button className="btn secondary" type="submit">
            Clear print queue
          </button>
        </form>
      </div>
      {items.length === 0 ? (
        <p className="no-print">Nothing queued. Go to Mother Plants and click &quot;Queue for print.&quot;</p>
      ) : (
        <div className="label-sheet">
          {items.map((item) => (
            <div className="label-cell" key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="qr" src={item.qr} alt="" />
              <div className="text">
                <div className="id">{item.id}</div>
                <div className="line">{item.line1}</div>
                <div className="line">{item.line2}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
