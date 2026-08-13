// Types and thin wrappers for the commerce SKU system (supabase/schema.sql:
// genus_codes, plant_codes, commerce_skus, select_mother_for_commerce(),
// select_cutting_for_commerce()). See docs/Skrybix_Commerce_SKU_Design_Report.md
// and CLAUDE.md's decision record for the full rationale.
//
// The atomicity, immutability, and concurrency guarantees this system
// depends on all live in the Postgres functions/constraints themselves
// (verified against a real local Postgres instance before this file was
// written -- see the design report) -- this file is just a thin,
// type-safe call surface over those RPCs, not where the guarantees come
// from.

export type PhotoSubject = "exact_plant" | "representative_plant";
export type ShippingPresentation = "ships_in_pot" | "prepared_other";

export type MotherCommerceFactsInput = {
  photoSubject: PhotoSubject;
  potSize: string;
  plantSize: string;
  rootedEstablished: boolean;
  shippingPresentation: ShippingPresentation;
  shippingPresentationDetail: string | null;
  conditionNotes: string | null;
};

export type GenusCode = { code: string; genus_name: string };
export type PlantCode = { genus_code: string; code: string; display_label: string };

export function validateGenusCode(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code)) {
    return "Genus code must be exactly 2 uppercase letters.";
  }
  return null;
}

export function validatePlantCode(code: string): string | null {
  if (!/^[A-Z0-9]{3}$/.test(code)) {
    return "Plant code must be exactly 3 uppercase letters/digits.";
  }
  return null;
}
