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

// Cutting labels ship out with the plant to a real customer. Their QR
// code must encode the business's Instagram profile *directly* -- not
// a Skrybix URL that then redirects there. A phone's own camera/QR
// scanner shows the raw encoded URL as a preview before the customer
// even taps it, so routing through our own domain still flashes
// "vercel.app" in that preview regardless of how fast a server-side
// redirect is. This matches what the original physical Brother labels
// encoded before Skrybix existed. `/plant/cutting/[cuttingId]` is kept
// as a safety-net redirect for any already-printed label still
// carrying the old Skrybix-URL QR -- not used for newly generated ones.
export const CUTTING_INSTAGRAM_HANDLE = "gathering_moss_ftw";
export const CUTTING_INSTAGRAM_URL = `https://www.instagram.com/${CUTTING_INSTAGRAM_HANDLE}`;

export async function qrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 2, scale: 6 });
}
