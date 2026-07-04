// ──────────────────────────────────────────────
// Multi-Tenant / White-Label Type Definitions
// Ready for Supabase migration — currently localStorage
// ──────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;                  // "HarteCash" or dealer group name
  slug: string;                  // URL slug: "hartecash"
  logo_url: string;
  primary_color: string;         // hex
  secondary_color: string;
  created_at: string;
  is_active: boolean;
}

export interface Store {
  id: string;
  tenant_id: string;
  name: string;                  // "Harte Honda"
  slug: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  logo_url: string;
  tagline: string;
  primary_color: string;
  created_at: string;
  is_active: boolean;
}

export interface AuditLogEntry {
  id: string;
  store_id: string;
  user_id: string;
  action: "addendum_created" | "addendum_signed" | "addendum_sent" | "addendum_printed" | "addendum_pdf"
    | "addendum_consent_given" | "addendum_viewed"
    | "product_added" | "product_updated" | "product_deleted" | "product_sale_mode_changed"
    | "rule_added" | "rule_updated" | "rule_deleted"
    | "settings_updated" | "buyers_guide_created"
    | "invoice_created" | "invoice_updated"
    | "lead_captured" | "lead_exported"
    | "inventory_imported"
    | "prep_sign_off_created" | "prep_sign_off_signed"
    | "prep_sign_off_rejected" | "prep_sign_off_overridden"
    | "work_event_submitted" | "prep_vehicle_approved"
    | "listing_published" | "listing_viewed" | "listing_archived"
    | "compliance_block" | "price_integrity_block";
  entity_type: string;           // "addendum", "product", "rule", etc.
  entity_id: string;
  details: Record<string, any>;  // JSON payload of what changed
  ip_address: string;
  created_at: string;
  // Optional server-side enrichment (present on rows read from Supabase)
  user_email?: string | null;
  user_agent?: string | null;
  content_hash?: string | null;
}

export interface InventoryVehicle {
  id: string;
  store_id: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  stock_number: string;
  mileage: number;
  condition: "new" | "used" | "cpo";
  color_exterior: string;
  color_interior: string;
  body_style: string;
  transmission: string;
  drive_type: string;
  fuel_type: string;
  engine: string;
  price: number;
  msrp: number;
  description: string;
  image_url: string;
  source_url: string;
  status: "in_stock" | "pending" | "sold" | "addendum_created";
  addendum_id: string | null;
  imported_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  store_id: string;
  vehicle_vin: string;
  vehicle_ymm: string;
  stock_number: string;
  technician_name: string;
  work_performed: string[];
  ro_number: string;
  po_number: string;
  notes: string;
  labor_hours: number;
  labor_rate: number;
  parts_cost: number;
  total: number;
  status: "draft" | "submitted" | "paid";
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  store_id: string;
  name: string;
  phone: string;
  email: string;
  vehicle_interest: string;
  vehicle_vin: string;
  source: "qr_scan" | "signing_link" | "manual" | "website";
  signing_url: string;
  status: "new" | "contacted" | "converted" | "lost";
  notes: string;
  captured_at: string;
  updated_at: string;
}

export interface WarrantyRecord {
  id: string;
  store_id: string;
  vehicle_vin: string;
  vehicle_ymm: string;
  customer_name: string;
  product_name: string;
  product_id: string;
  provider: string;
  warranty_start: string;
  warranty_end: string;
  coverage_type: string;
  registration_number: string;
  status: "active" | "expired" | "claimed" | "void";
  notes: string;
  created_at: string;
}

export interface PayrollEntry {
  id: string;
  store_id: string;
  technician_name: string;
  invoice_id: string;
  vehicle_vin: string;
  work_description: string;
  piece_rate: number;
  quantity: number;
  total_pay: number;
  pay_period: string;        // e.g. "2026-W15"
  status: "pending" | "approved" | "paid";
  created_at: string;
}

export interface BuyersGuideRecord {
  id: string;
  store_id: string;
  vehicle_vin: string;
  vehicle_ymm: string;
  guide_type: "as-is" | "implied" | "warranty";
  language: "en" | "es";
  warranty_duration: string;
  warranty_percentage: string;
  covered_systems: string[];
  created_by: string;
  created_at: string;
}

export interface AnalyticsSnapshot {
  store_id: string;
  period: string;                // "2026-04"
  addendums_created: number;
  addendums_signed: number;
  addendums_sent: number;
  total_installed_revenue: number;
  total_optional_revenue: number;
  product_acceptance_rates: Record<string, number>;  // product_id -> rate
  avg_addendum_value: number;
  top_products: { name: string; count: number; revenue: number }[];
  leads_captured: number;
  invoices_generated: number;
}
