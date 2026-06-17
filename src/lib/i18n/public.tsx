import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// ──────────────────────────────────────────────────────────────
// Public-page localization (English / Spanish).
//
// Drives the customer-facing window-sticker / QR-scan pages
// (/v/:slug PublicListing, /vehicle/:vin VehiclePortal). When a
// buyer scans the sticker they can read every UI string in English
// or Spanish — the FTC Used Car Rule (16 CFR Part 455) requires a
// bilingual Buyers Guide when the sale is conducted in Spanish, and
// CA Civil Code §1632 / SB 766 require disclosures in the buyer's
// language.
//
// IMPORTANT: only STATIC UI chrome is translated here. Dealer-
// authored content (product names, disclosures, benefit
// justifications, marketing copy) is rendered verbatim — the dealer
// is legally liable for its accuracy, so we never machine-translate
// it. Those fields stay in whatever language the dealer entered.
// ──────────────────────────────────────────────────────────────

export type PublicLocale = "en" | "es";

export interface PublicMessages {
  // chrome / toggle
  language_name: string;
  switch_to: string;
  // shared states
  loading_vehicle: string;
  vehicle_unavailable: string;
  vehicle_unavailable_body: string;
  slow_down: string;
  rate_limited_body: string;
  vehicle_not_found: string;
  not_stickered_yet: string;
  vehicle_details_fallback: string; // hero headline fallback, contains {n} (VIN tail)
  // header / share
  open_on_another_device: string;
  share: string;
  link_copied: string;
  // condition + price
  new_vehicle: string;
  preowned_vehicle: string;
  suggested_retail_price: string;
  asking_price: string;
  drive_out_price: string;
  drive_out_disclaimer: string;
  whats_in_price: string;
  addon_included_note: string;
  base_price: string;
  base: string;
  accessories: string;
  dealer_installed_addons: string;
  doc_fee: string;
  miles: string;
  mi_short: string;
  stock: string;
  // sections
  about_this_vehicle: string;
  video_walkaround: string;
  watch_video: string;
  whats_on_vehicle: string;
  whats_on_intro: string;
  preinstalled_included: string;
  optional_you_choose: string;
  no_additional_products: string;
  included_with_purchase: string;
  notable_features: string;
  program_details: string;
  program_documents: string;
  vehicle_documents: string;
  factory_monroney: string;
  tap_to_view: string;
  why_benefits_you: string;
  optional_not_condition: string;
  key_specs: string;
  certified_preowned: string;
  watch_caption: string; // contains {n} (video caption)
  video_fallback: string; // default caption when none provided
  // reserve / inquiry
  reserve_vehicle: string;
  reserved: string;
  reserved_subtitle: string; // contains {n} (dealer name)
  vehicle_held_title: string;
  vehicle_held_body: string;
  dealership: string;
  close: string;
  reserve_intro: string;
  hold_for_me: string;
  test_drive: string;
  make_offer: string;
  your_name: string;
  full_name: string;
  phone: string;
  email: string;
  message: string;
  default_inquiry_message: string;
  send_request: string;
  reserve_now: string;
  reserving: string;
  sending: string;
  inquiry_disclaimer: string;
  inquiry_validation_error: string;
  inquiry_send_error: string;
  // handoff
  open_on_another_device_title: string;
  scan_to_continue: string;
  scan_to_continue_body: string;
  copy_link: string;
  call_dealership: string;
  share_vehicle: string;
  // availability
  pickup: string;
  ready_now: string;
  delivery: string;
  on_request: string;
  pickup_available_at: string; // contains {n} (dealer + city phrase)
  pickup_available_generic: string;
  delivery_ask: string;
  // trust band
  prep_signed: string;
  prep_pending: string;
  prep_checked: string; // "Checked"
  prep_signed_title: string; // contains {n} (date)
  prep_required_title: string;
  recalls_clear: string;
  recalls_open: string; // contains {n}
  recalls_as_of: string; // contains {n} (date)
  recalls_open_title: string;
  recalls_clear_title: string;
  archived: string;
  archived_title: string;
  // recall banner
  recall_banner_title: string;
  recall_banner_body: string;
  recall_more: string; // contains {n}
  // specs
  body: string;
  drivetrain: string;
  transmission: string;
  fuel: string;
  mpg: string;
  exterior: string;
  // photos
  photos: string;
  photo_alt: string; // contains {n} (photo index)
  more_photos: string; // contains {n}
  // certification
  warranty: string;
  coverage: string;
  inspection: string;
  view_full_program: string;
  // payment estimator
  est_monthly_payment: string;
  estimate_only: string;
  per_mo: string;
  apr: string;
  down: string;
  term: string;
  // protection (VehiclePortal)
  your_protection: string;
  protection: string[];
  questions: string;
  questions_body: string;
  call: string;
  published: string;
  powered_by: string;
  scan_service_history: string;
  scan_remaining_warranty: string;
  scan_available_accessories: string;
  scan_warranty_factory: string;
  scan_warranty_powertrain: string;
  scan_warranty_note: string;
  scan_accessories_note: string;
}

export const LABELS: Record<PublicLocale, PublicMessages> = {
  en: {
    language_name: "English",
    switch_to: "Español",
    loading_vehicle: "Loading vehicle details…",
    vehicle_unavailable: "Vehicle Not Available",
    vehicle_unavailable_body:
      "This listing may have been sold or unpublished. Check with the dealership for current availability.",
    slow_down: "Slow Down a Moment",
    rate_limited_body: "You're loading pages quickly. Please wait a few seconds and try again.",
    vehicle_not_found: "Vehicle Not Found",
    not_stickered_yet: "This vehicle may not have been stickered yet.",
    vehicle_details_fallback: "Vehicle Details — VIN {n}",
    open_on_another_device: "Open on another device",
    share: "Share",
    link_copied: "Link copied",
    new_vehicle: "New Vehicle",
    preowned_vehicle: "Pre-Owned Vehicle",
    suggested_retail_price: "Suggested Retail Price",
    asking_price: "Asking Price",
    drive_out_price: "Drive-out price",
    drive_out_disclaimer:
      "Every mandatory fee is in this number. Tax, tag, and registration are state-set and added at titling.",
    whats_in_price: "What's in this price",
    addon_included_note: "Included in the total above",
    base_price: "Base price",
    base: "Base",
    accessories: "Accessories",
    dealer_installed_addons: "Dealer-installed add-ons",
    doc_fee: "Doc fee",
    miles: "miles",
    mi_short: "mi",
    stock: "Stock",
    about_this_vehicle: "About this vehicle",
    video_walkaround: "Video Walkaround",
    watch_video: "Watch Video",
    whats_on_vehicle: "What's On This Vehicle",
    whats_on_intro:
      "Below are the dealer-installed products and accessories on this vehicle. Items marked Pre-Installed are already on the vehicle and included in the price. Items marked Optional can be accepted or declined at no impact to your purchase.",
    preinstalled_included: "Pre-Installed (Included in Price)",
    optional_you_choose: "Optional (You Choose)",
    no_additional_products: "No additional products on this vehicle.",
    included_with_purchase: "Included With Your Purchase",
    notable_features: "Notable features",
    program_details: "Program Details",
    program_documents: "Program documents",
    vehicle_documents: "Vehicle Documents",
    factory_monroney: "Factory Monroney label",
    tap_to_view: "Tap to view",
    why_benefits_you: "Why this benefits you:",
    optional_not_condition: "Optional · not a condition of credit approval",
    key_specs: "Key specs",
    certified_preowned: "Certified Pre-Owned",
    watch_caption: "Watch {n}",
    video_fallback: "video",
    reserve_vehicle: "Reserve this vehicle",
    reserved: "Reserved",
    reserved_subtitle: "{n} will be in touch shortly.",
    vehicle_held_title: "Your vehicle is held.",
    vehicle_held_body:
      "The dealer has your request time-stamped and hashed into the audit trail. Expect contact shortly during business hours.",
    dealership: "Dealership",
    close: "Close",
    reserve_intro:
      "Tell us what you'd like to do next. The dealer will reach out with next steps — no contract, no cost.",
    hold_for_me: "Hold for me",
    test_drive: "Test drive",
    make_offer: "Make an offer",
    your_name: "Your name",
    full_name: "Full name",
    phone: "Phone",
    email: "Email",
    message: "Message",
    default_inquiry_message: "I'm interested in this vehicle. Please contact me.",
    send_request: "Send request",
    reserve_now: "Reserve now",
    reserving: "Reserving…",
    sending: "Sending…",
    inquiry_disclaimer:
      "By sending this you agree we can share your contact with this dealership so they can follow up. Your request is time-stamped and logged to the dealer's audit trail.",
    inquiry_validation_error: "Name plus email or phone is required.",
    inquiry_send_error: "Couldn't send your request. Try calling the dealer directly.",
    open_on_another_device_title: "Open on another device",
    scan_to_continue: "Scan to continue on your phone",
    scan_to_continue_body:
      "Point your phone camera at the code. At delivery, this is also how the buyer signs on their own device — every signature stays bound to the buyer's hardware.",
    copy_link: "Copy link",
    call_dealership: "Call dealership",
    share_vehicle: "Share vehicle",
    pickup: "Pickup",
    ready_now: "Ready now",
    delivery: "Delivery",
    on_request: "On request",
    pickup_available_at: "Available today at {n}.",
    pickup_available_generic: "Available today at the dealership.",
    delivery_ask: "Ask about home delivery within the dealer's service area.",
    prep_signed: "Prep-signed",
    prep_pending: "Pending",
    prep_checked: "Checked",
    prep_signed_title: "Shop foreman signed on {n}",
    prep_required_title: "Foreman sign-off required before publish",
    recalls_clear: "Recalls clear",
    recalls_open: "{n} recall(s) open",
    recalls_as_of: "as of {n}",
    recalls_open_title:
      "One or more open NHTSA campaigns. Ask the dealer about remedy status.",
    recalls_clear_title: "NHTSA campaign check found no open do-not-drive recalls.",
    archived: "Archived",
    archived_title:
      "Every signed document for this VIN is retained in a tamper-evident archive for 7 years.",
    recall_banner_title: "Open NHTSA recall(s) on this VIN",
    recall_banner_body:
      "The campaigns below are on file with NHTSA. Ask the dealer whether remedies have been applied before purchase.",
    recall_more: "+ {n} more",
    body: "Body",
    drivetrain: "Drivetrain",
    transmission: "Transmission",
    fuel: "Fuel",
    mpg: "MPG",
    exterior: "Exterior",
    photos: "Photos",
    photo_alt: "Vehicle photo {n}",
    more_photos: "+ {n} more photos available…",
    warranty: "Warranty",
    coverage: "Coverage",
    inspection: "Inspection",
    view_full_program: "View full program details →",
    est_monthly_payment: "Estimated monthly payment",
    estimate_only:
      "Estimate only. Your actual rate and payment depend on your credit and the lender's terms.",
    per_mo: "/mo",
    apr: "APR %",
    down: "Down $",
    term: "Term mo",
    your_protection: "Your Protection",
    protection: [
      "Every product is fully disclosed with pricing before you sign anything.",
      "Optional items can be declined with zero impact on your purchase or financing.",
      "All disclosures comply with FTC federal requirements and your state's consumer protection laws.",
      "Your signature, initials, and selections are timestamped and stored in a tamper-proof audit trail.",
      "You will receive a copy of all signed documents for your records.",
    ],
    questions: "Questions?",
    questions_body:
      "Take your time reviewing everything above. When you're ready, your salesperson will walk you through each item and answer any questions.",
    call: "Call",
    published: "Published",
    powered_by: "Powered by AutoLabels.io",
    scan_service_history: "Service history",
    scan_remaining_warranty: "Remaining warranty",
    scan_available_accessories: "Available accessories",
    scan_warranty_factory: "Factory / Bumper-to-Bumper",
    scan_warranty_powertrain: "Powertrain",
    scan_warranty_note: "Estimated from the in-service date; confirm exact coverage with the manufacturer.",
    scan_accessories_note: "Optional add-ons available for this vehicle — ask your salesperson.",
  },
  es: {
    language_name: "Español",
    switch_to: "English",
    loading_vehicle: "Cargando los detalles del vehículo…",
    vehicle_unavailable: "Vehículo no disponible",
    vehicle_unavailable_body:
      "Es posible que este anuncio se haya vendido o retirado. Confirme la disponibilidad actual con el concesionario.",
    slow_down: "Espere un momento",
    rate_limited_body: "Está cargando páginas muy rápido. Espere unos segundos e inténtelo de nuevo.",
    vehicle_not_found: "Vehículo no encontrado",
    not_stickered_yet: "Es posible que este vehículo aún no tenga etiqueta.",
    vehicle_details_fallback: "Detalles del vehículo — VIN {n}",
    open_on_another_device: "Abrir en otro dispositivo",
    share: "Compartir",
    link_copied: "Enlace copiado",
    new_vehicle: "Vehículo nuevo",
    preowned_vehicle: "Vehículo usado",
    suggested_retail_price: "Precio de venta sugerido",
    asking_price: "Precio de venta",
    drive_out_price: "Precio total de salida",
    drive_out_disclaimer:
      "Todos los cargos obligatorios están incluidos en este número. Los impuestos, las placas y el registro los fija el estado y se agregan al titular.",
    whats_in_price: "Qué incluye este precio",
    addon_included_note: "Incluido en el total anterior",
    base_price: "Precio base",
    base: "Base",
    accessories: "Accesorios",
    dealer_installed_addons: "Accesorios instalados por el concesionario",
    doc_fee: "Cargo por documentación",
    miles: "millas",
    mi_short: "mi",
    stock: "Inventario",
    about_this_vehicle: "Acerca de este vehículo",
    video_walkaround: "Recorrido en video",
    watch_video: "Ver video",
    whats_on_vehicle: "Lo que incluye este vehículo",
    whats_on_intro:
      "A continuación se muestran los productos y accesorios instalados por el concesionario en este vehículo. Los artículos marcados como Preinstalado ya están en el vehículo e incluidos en el precio. Los artículos marcados como Opcional puede aceptarlos o rechazarlos sin que afecte su compra.",
    preinstalled_included: "Preinstalado (incluido en el precio)",
    optional_you_choose: "Opcional (usted elige)",
    no_additional_products: "No hay productos adicionales en este vehículo.",
    included_with_purchase: "Incluido con su compra",
    notable_features: "Características destacadas",
    program_details: "Detalles del programa",
    program_documents: "Documentos del programa",
    vehicle_documents: "Documentos del vehículo",
    factory_monroney: "Etiqueta Monroney de fábrica",
    tap_to_view: "Toque para ver",
    why_benefits_you: "Por qué le beneficia:",
    optional_not_condition: "Opcional · no es una condición para aprobar el crédito",
    key_specs: "Especificaciones clave",
    certified_preowned: "Usado certificado",
    watch_caption: "Ver {n}",
    video_fallback: "video",
    reserve_vehicle: "Reservar este vehículo",
    reserved: "Reservado",
    reserved_subtitle: "{n} se comunicará con usted en breve.",
    vehicle_held_title: "Su vehículo está apartado.",
    vehicle_held_body:
      "El concesionario tiene su solicitud registrada con fecha y hora en el historial de auditoría. Espere ser contactado en breve durante el horario comercial.",
    dealership: "Concesionario",
    close: "Cerrar",
    reserve_intro:
      "Díganos qué le gustaría hacer a continuación. El concesionario se comunicará con los siguientes pasos — sin contrato ni costo.",
    hold_for_me: "Apartar para mí",
    test_drive: "Prueba de manejo",
    make_offer: "Hacer una oferta",
    your_name: "Su nombre",
    full_name: "Nombre completo",
    phone: "Teléfono",
    email: "Correo electrónico",
    message: "Mensaje",
    default_inquiry_message: "Me interesa este vehículo. Por favor contácteme.",
    send_request: "Enviar solicitud",
    reserve_now: "Reservar ahora",
    reserving: "Reservando…",
    sending: "Enviando…",
    inquiry_disclaimer:
      "Al enviar esto, acepta que podemos compartir su contacto con este concesionario para que puedan dar seguimiento. Su solicitud queda registrada con fecha y hora en el historial de auditoría del concesionario.",
    inquiry_validation_error: "Se requiere el nombre más el correo electrónico o el teléfono.",
    inquiry_send_error: "No se pudo enviar su solicitud. Intente llamar directamente al concesionario.",
    open_on_another_device_title: "Abrir en otro dispositivo",
    scan_to_continue: "Escanee para continuar en su teléfono",
    scan_to_continue_body:
      "Apunte la cámara de su teléfono al código. En la entrega, así es también como el comprador firma en su propio dispositivo — cada firma queda vinculada al equipo del comprador.",
    copy_link: "Copiar enlace",
    call_dealership: "Llamar al concesionario",
    share_vehicle: "Compartir vehículo",
    pickup: "Recoger",
    ready_now: "Listo ahora",
    delivery: "Entrega",
    on_request: "A solicitud",
    pickup_available_at: "Disponible hoy en {n}.",
    pickup_available_generic: "Disponible hoy en el concesionario.",
    delivery_ask: "Pregunte sobre la entrega a domicilio dentro del área de servicio del concesionario.",
    prep_signed: "Preparación firmada",
    prep_pending: "Pendiente",
    prep_checked: "Verificado",
    prep_signed_title: "El jefe de taller firmó el {n}",
    prep_required_title: "Se requiere la firma del jefe de taller antes de publicar",
    recalls_clear: "Sin llamados a revisión",
    recalls_open: "{n} llamado(s) a revisión abierto(s)",
    recalls_as_of: "al {n}",
    recalls_open_title:
      "Una o más campañas abiertas de la NHTSA. Pregunte al concesionario sobre el estado de la reparación.",
    recalls_clear_title: "La revisión de campañas de la NHTSA no encontró llamados a revisión abiertos.",
    archived: "Archivado",
    archived_title:
      "Cada documento firmado para este VIN se conserva en un archivo a prueba de manipulaciones durante 7 años.",
    recall_banner_title: "Llamado(s) a revisión de la NHTSA abierto(s) en este VIN",
    recall_banner_body:
      "El fabricante tiene uno o más llamados a revisión de seguridad abiertos en este vehículo. Pida al concesionario que confirme el estado de la reparación antes de comprar.",
    recall_more: "+ {n} más",
    body: "Carrocería",
    drivetrain: "Tracción",
    transmission: "Transmisión",
    fuel: "Combustible",
    mpg: "MPG",
    exterior: "Exterior",
    photos: "Fotos",
    photo_alt: "Foto del vehículo {n}",
    more_photos: "+ {n} fotos más disponibles…",
    warranty: "Garantía",
    coverage: "Cobertura",
    inspection: "Inspección",
    view_full_program: "Ver los detalles completos del programa →",
    est_monthly_payment: "Pago mensual estimado",
    estimate_only:
      "Solo es una estimación. No es una oferta de financiamiento. Sus términos reales dependen de la aprobación de crédito, impuestos y cargos.",
    per_mo: "/mes",
    apr: "TAE %",
    down: "Enganche $",
    term: "Plazo meses",
    your_protection: "Su protección",
    protection: [
      "Cada producto se divulga por completo con su precio antes de que firme cualquier cosa.",
      "Los artículos opcionales pueden rechazarse sin ningún efecto en su compra ni en su financiamiento.",
      "Todas las divulgaciones cumplen con los requisitos federales de la FTC y las leyes de protección al consumidor de su estado.",
      "Su firma, iniciales y selecciones quedan registradas con fecha y hora en un historial de auditoría a prueba de manipulaciones.",
      "Recibirá una copia de todos los documentos firmados para sus registros.",
    ],
    questions: "¿Preguntas?",
    questions_body:
      "Tómese su tiempo para revisar todo lo anterior. Cuando esté listo, su vendedor le explicará cada artículo y responderá cualquier pregunta.",
    call: "Llamar a",
    published: "Publicado",
    powered_by: "Con la tecnología de AutoLabels.io",
    scan_service_history: "Historial de servicio",
    scan_remaining_warranty: "Garantía restante",
    scan_available_accessories: "Accesorios disponibles",
    scan_warranty_factory: "De fábrica / Defensa a defensa",
    scan_warranty_powertrain: "Tren motriz",
    scan_warranty_note: "Estimado a partir de la fecha de puesta en servicio; confirme la cobertura exacta con el fabricante.",
    scan_accessories_note: "Complementos opcionales disponibles para este vehículo — consulte con su vendedor.",
  },
};

const STORAGE_KEY = "public_lang";

const seedLocale = (initial?: PublicLocale | null): PublicLocale => {
  if (initial === "en" || initial === "es") return initial;
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav && nav.toLowerCase().startsWith("es") ? "es" : "en";
};

interface PublicLocaleContextValue {
  lang: PublicLocale;
  setLang: (l: PublicLocale) => void;
  L: PublicMessages;
}

const PublicLocaleContext = createContext<PublicLocaleContextValue | null>(null);

export const PublicLocaleProvider = ({
  initial,
  children,
}: {
  initial?: PublicLocale | null;
  children: ReactNode;
}) => {
  const [lang, setLang] = useState<PublicLocale>(() => seedLocale(initial));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const value = useMemo<PublicLocaleContextValue>(
    () => ({ lang, setLang, L: LABELS[lang] }),
    [lang],
  );

  return <PublicLocaleContext.Provider value={value}>{children}</PublicLocaleContext.Provider>;
};

// Sub-components anywhere under a PublicLocaleProvider read the active
// locale + label map without prop threading. Falls back to English
// outside a provider so a stray render never crashes.
export const usePublicLocale = (): PublicLocaleContextValue => {
  const ctx = useContext(PublicLocaleContext);
  if (ctx) return ctx;
  return { lang: "en", setLang: () => {}, L: LABELS.en };
};

// Replaces {n} in a template string (recall counts, photo counts).
export const fmt = (template: string, n: number | string): string =>
  template.replace("{n}", String(n));
