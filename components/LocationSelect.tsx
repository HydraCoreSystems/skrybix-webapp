import { LOCATIONS } from "@/lib/locations";

// A plain <select> (not "use client" -- no interactivity needed beyond
// native form behavior) so it works directly inside a Server Component
// form. If the current stored value isn't one of the standard choices
// (an old GR/UP/FA/MI/UP-CLOSET code, or anything else already saved),
// it's kept as an extra option so editing a legacy row never silently
// overwrites its location on save.
export default function LocationSelect({ defaultValue }: { defaultValue?: string | null }) {
  const current = defaultValue?.trim() || "";
  const options = current && !(LOCATIONS as readonly string[]).includes(current) ? [current, ...LOCATIONS] : LOCATIONS;

  return (
    <select name="location" defaultValue={current}>
      <option value="">(none)</option>
      {options.map((loc) => (
        <option key={loc} value={loc}>
          {loc}
        </option>
      ))}
    </select>
  );
}
