export type MotherPlant = {
  mother_id: string;
  display_name: string;
  location: string | null;
  genus: string;
  species: string | null;
  qualifier: string;
  collection_code: string | null;
  cultivar: string | null;
  trade_name: string | null;
  hybrid: boolean;
  botanical_line1: string | null;
  botanical_line2: string | null;
  print_label: boolean;
  created_at: string;
  form_code: string | null;
  name_type: string | null;
  natural_cultivar: boolean;
  spec3: string | null;
  mother_seq: string | null;
  notes: string | null;
  species_key: string | null;
  species_key_2: string | null;
  flower_photo_link: string | null;
  scan_count: number;
};

export type Cutting = {
  cutting_id: string;
  mother_id: string;
  full_display_name: string | null;
  label_line1: string | null;
  label_line2: string | null;
  date_taken: string | null;
  sold: boolean;
  print_label: boolean;
  archived_at: string | null;
  created_at: string;
  scan_count: number;
};

export type OutgoingLogEntry = {
  id: number;
  date_out: string;
  cutting_id: string;
  full_display_name: string | null;
  qty: number;
  reason: string | null;
  selling_platform: string | null;
  notes: string | null;
  created_at: string;
};
