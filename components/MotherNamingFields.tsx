"use client";

import { useEffect, useState } from "react";
import { composeBotanicalLine1, composeBotanicalLine2 } from "@/lib/hoya-naming";

type Props = {
  defaultValues?: {
    genus?: string | null;
    species?: string | null;
    form_code?: string | null;
    cultivar?: string | null;
    name_type?: string | null;
    natural_cultivar?: boolean | null;
    botanical_line1?: string | null;
    botanical_line2?: string | null;
  };
  speciesOptions: string[];
};

export default function MotherNamingFields({ defaultValues, speciesOptions }: Props) {
  const [genus, setGenus] = useState(defaultValues?.genus || "Hoya");
  const [species, setSpecies] = useState(defaultValues?.species || "");
  const [formCode, setFormCode] = useState(defaultValues?.form_code || "");
  const [cultivar, setCultivar] = useState(defaultValues?.cultivar || "");
  const [nameType, setNameType] = useState(defaultValues?.name_type || "");
  const [naturalCultivar, setNaturalCultivar] = useState(!!defaultValues?.natural_cultivar);

  const [line1, setLine1] = useState(defaultValues?.botanical_line1 || "");
  const [line2, setLine2] = useState(defaultValues?.botanical_line2 || "");

  // On the edit page, a stored line that doesn't match what the composer
  // would produce from the current structured fields means someone
  // deliberately overrode it (e.g. a hybrid-cross breeding note) — don't
  // silently recompute over that the moment the page loads. Only start in
  // "auto" mode when there's nothing stored yet (new mother) or the
  // stored value already matches what auto-compose would give anyway.
  const [autoLine1, setAutoLine1] = useState(
    () =>
      !defaultValues?.botanical_line1 ||
      defaultValues.botanical_line1 ===
        composeBotanicalLine1({ genus: defaultValues?.genus, species: defaultValues?.species, form_code: defaultValues?.form_code })
  );
  const [autoLine2, setAutoLine2] = useState(
    () =>
      !defaultValues?.botanical_line2 ||
      defaultValues.botanical_line2 ===
        composeBotanicalLine2({ cultivar: defaultValues?.cultivar, name_type: defaultValues?.name_type })
  );

  useEffect(() => {
    if (!autoLine1) return;
    setLine1(composeBotanicalLine1({ genus, species, form_code: formCode }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genus, species, formCode, autoLine1]);

  useEffect(() => {
    if (!autoLine2) return;
    setLine2(composeBotanicalLine2({ cultivar, name_type: nameType }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cultivar, nameType, autoLine2]);

  return (
    <>
      <label>Genus</label>
      <input name="genus" value={genus} onChange={(e) => setGenus(e.target.value)} />

      <label>Species (leave blank if unidentified)</label>
      <input
        name="species"
        list="species-options"
        value={species}
        onChange={(e) => setSpecies(e.target.value)}
        placeholder="e.g. carnosa"
      />
      <datalist id="species-options">
        {speciesOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <label>Qualifier</label>
      <select name="form_code" value={formCode} onChange={(e) => setFormCode(e.target.value)}>
        <option value="">(none)</option>
        <option value="sp">sp. — unidentified</option>
        <option value="aff">aff. — probable match</option>
        <option value="cf">cf. — uncertain match</option>
      </select>

      <label>Cultivar / Collection Code / Descriptor</label>
      <input name="cultivar" value={cultivar} onChange={(e) => setCultivar(e.target.value)} />

      <label>How to read the field above</label>
      <select name="name_type" value={nameType} onChange={(e) => setNameType(e.target.value)}>
        <option value="">(none)</option>
        <option value="Cultivar">Cultivar name — shown in ‘quotes’</option>
        <option value="Form">Collection code — shown plain, after "sp."</option>
        <option value="Descriptor">Descriptor — shown plain</option>
      </select>

      <label>
        <input
          type="checkbox"
          name="natural_cultivar"
          value="true"
          checked={naturalCultivar}
          onChange={(e) => setNaturalCultivar(e.target.checked)}
        />{" "}
        Naturally occurring cultivar (found in the wild, not bred)
      </label>

      <label>
        Botanical Line 1 (auto-composed — only edit for a special case, e.g. a hybrid cross note)
        {!autoLine1 && (
          <>
            {" — "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setAutoLine1(true);
              }}
            >
              reset to auto-composed
            </a>
          </>
        )}
      </label>
      <input
        name="botanical_line1"
        value={line1}
        onChange={(e) => {
          setLine1(e.target.value);
          setAutoLine1(false);
        }}
        style={{ fontStyle: "italic" }}
      />

      <label>
        Botanical Line 2 (auto-composed — only edit for a special case)
        {!autoLine2 && (
          <>
            {" — "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setAutoLine2(true);
              }}
            >
              reset to auto-composed
            </a>
          </>
        )}
      </label>
      <input
        name="botanical_line2"
        value={line2}
        onChange={(e) => {
          setLine2(e.target.value);
          setAutoLine2(false);
        }}
      />
    </>
  );
}
