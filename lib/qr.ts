import QRCode from "qrcode";

// SITE_URL must point at the real deployed domain before any label is
// actually printed — QR codes generated against the localhost default
// are only useful for testing on this machine.
function siteUrl(): string {
  return process.env.SITE_URL || "http://localhost:3000";
}

export function publicPlantUrl(motherId: string): string {
  return `${siteUrl()}/plant/${encodeURIComponent(motherId)}`;
}

export function publicCuttingUrl(cuttingId: string): string {
  return `${siteUrl()}/plant/cutting/${encodeURIComponent(cuttingId)}`;
}

export async function qrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 2, scale: 6 });
}
