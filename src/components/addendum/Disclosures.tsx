import { ShieldCheck, AlertTriangle } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { resolveOperatingState } from "@/lib/dealerState";
import {
  getStateCompliance,
  getAddendumDisclosures,
} from "@/data/stateCompliance";

export type DisclosureLanguage = "en" | "es";

interface DisclosuresProps {
  inkSaving?: boolean;
  language?: DisclosureLanguage;
}

// Hard-coded disclosure copy split by language. The state-specific
// block (stateCompliance.ts) stays in English until per-state legal
// review is completed — non-English readers see an inline note that
// state-specific disclosures remain in English.
const STRINGS = {
  en: {
    heading: "Required Disclosures & Consumer Rights",
    carsBanner: (languages: string) =>
      `CALIFORNIA SB 766 DISCLOSURE — This addendum reflects California's add-on disclosure requirements effective October 1, 2026. Headings are in 12-point bold type and body text in 10-point bold type as required.${languages ? " Available in: " + languages + "." : ""}`,
    ackLabel: "ADDENDUM & WINDOW STICKER ACKNOWLEDGMENT:",
    ackBody:
      "By signing this addendum, the consumer acknowledges and agrees that: (1) this addendum accurately reflects and corresponds to the window sticker affixed to this vehicle; (2) the consumer has been given adequate time and opportunity to review both the window sticker on the vehicle and this addendum in full; (3) the products, pricing, and terms listed on this addendum match those displayed on the vehicle's window sticker; and (4) the consumer's initials and signature below constitute acceptance of the products and pricing as disclosed on both documents. Any discrepancy between the window sticker and this addendum should be reported to dealership management prior to signing.",
    preInstalledLabel: "PRE-INSTALLED / NON-REMOVABLE ITEMS:",
    preInstalledBody:
      "Products marked as pre-installed have been physically applied to or permanently installed on this vehicle prior to the date of sale. Because these products cannot be removed without damage to the vehicle, their costs are included in the dealer's asking price for this vehicle. By signing below, the consumer acknowledges that these items are present on the vehicle and that their costs are reflected in the agreed-upon selling price.",
    postSaleLabel: "POST-SALE PURCHASE WINDOW:",
    postSaleBody: (days: number, state: string) =>
      `Under ${state} law, you have up to ${days} days after the date of sale to purchase any optional add-on product or service listed on this addendum. Contact the dealership within this window if you wish to add any previously declined products.`,
    contractLabel: "SALES CONTRACT NOTICE:",
    retentionBody: (years: number, state: string) =>
      `This document and all associated signing records will be retained for a minimum of ${years} years in compliance with applicable federal and ${state || "state"} record retention requirements.`,
    stateDisclosuresEnglishNote:
      "State-specific disclosures below remain in English. Please ask a dealership representative if you need verbal translation before signing.",
  },
  es: {
    heading: "Divulgaciones Requeridas y Derechos del Consumidor",
    carsBanner: (languages: string) =>
      `DIVULGACIÓN DE CALIFORNIA (SB 766) — Este anexo cumple con los requisitos de divulgación de California con vigencia a partir del 1 de octubre de 2026. Los encabezados están en negrita de 12 puntos y el texto del cuerpo en negrita de 10 puntos, según lo requerido.${languages ? " Disponible en: " + languages + "." : ""}`,
    ackLabel: "RECONOCIMIENTO DEL ANEXO Y ETIQUETA DE VENTANA:",
    ackBody:
      "Al firmar este anexo, el consumidor reconoce y acepta que: (1) este anexo refleja con precisión y corresponde a la etiqueta de la ventana adherida a este vehículo; (2) al consumidor se le ha dado tiempo y oportunidad adecuados para revisar tanto la etiqueta de la ventana del vehículo como este anexo en su totalidad; (3) los productos, precios y términos enumerados en este anexo coinciden con los mostrados en la etiqueta de la ventana del vehículo; y (4) las iniciales y la firma del consumidor a continuación constituyen la aceptación de los productos y precios divulgados en ambos documentos. Cualquier discrepancia entre la etiqueta de la ventana y este anexo debe informarse a la gerencia del concesionario antes de firmar.",
    preInstalledLabel: "ARTÍCULOS PREINSTALADOS / NO REMOVIBLES:",
    preInstalledBody:
      "Los productos marcados como preinstalados han sido aplicados físicamente o instalados permanentemente en este vehículo antes de la fecha de venta. Debido a que estos productos no pueden retirarse sin dañar el vehículo, sus costos están incluidos en el precio de venta del concesionario. Al firmar a continuación, el consumidor reconoce que estos artículos están presentes en el vehículo y que sus costos se reflejan en el precio de venta acordado.",
    postSaleLabel: "VENTANA DE COMPRA POSTERIOR A LA VENTA:",
    postSaleBody: (days: number, state: string) =>
      `Conforme a la ley de ${state}, usted dispone de hasta ${days} días después de la fecha de venta para comprar cualquier producto o servicio complementario opcional enumerado en este anexo. Comuníquese con el concesionario dentro de este período si desea agregar algún producto rechazado anteriormente.`,
    contractLabel: "AVISO DEL CONTRATO DE VENTA:",
    retentionBody: (years: number, state: string) =>
      `Este documento y todos los registros de firma asociados se conservarán por un mínimo de ${years} años, conforme a los requisitos federales y de ${state || "estado"} aplicables sobre retención de registros.`,
    stateDisclosuresEnglishNote:
      "Las divulgaciones específicas del estado que aparecen a continuación permanecen en inglés. Solicite a un representante del concesionario una traducción verbal antes de firmar si la necesita.",
  },
} as const;

const Disclosures = ({ inkSaving, language = "en" }: DisclosuresProps) => {
  const { settings } = useDealerSettings();
  const { currentStore } = useTenant();

  const t = STRINGS[language];
  const dealerState = resolveOperatingState(settings, currentStore?.state);
  const compliance = getStateCompliance(dealerState);
  const stateDisclosures = getAddendumDisclosures(dealerState);

  const headingClass = compliance.requiresBoldType
    ? "text-[12px] font-bold"
    : "text-[10px] font-bold";
  const bodyClass = compliance.requiresBoldType
    ? "text-[10px] font-bold leading-[1.45]"
    : "text-[9px] leading-[1.45]";

  const languageList = compliance.requiredLanguages
    .map(l => ({ es: "Spanish", zh: "Chinese", tl: "Tagalog", vi: "Vietnamese", ko: "Korean" }[l] || l))
    .join(", ");
  const languageListEs = compliance.requiredLanguages
    .map(l => ({ es: "Español", zh: "Chino", tl: "Tagalo", vi: "Vietnamita", ko: "Coreano" }[l] || l))
    .join(", ");

  return (
    <div className={`px-3 py-2 rounded space-y-2 ${inkSaving ? "bg-card" : "bg-light"}`}>
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
        <p className={`${headingClass} text-foreground`}>{t.heading}</p>
      </div>

      {compliance.carsActState && (
        <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[8px] text-amber-800 font-semibold leading-tight">
            {t.carsBanner(language === "es" ? languageListEs : languageList)}
          </p>
        </div>
      )}

      <div className={compliance.requiresBoldType ? "border-2 border-foreground rounded p-2" : ""}>
        <p className={`${bodyClass} text-muted-foreground`}>
          <strong>{t.ackLabel}</strong> {t.ackBody}
        </p>
      </div>

      <p className={`${bodyClass} text-muted-foreground`}>
        <strong>{t.preInstalledLabel}</strong> {t.preInstalledBody}
      </p>

      {/* State-specific disclosures stay in English. Add a bilingual
          note so non-English readers know to ask for verbal
          translation before signing. */}
      {language !== "en" && stateDisclosures.length > 0 && (
        <p className={`${bodyClass} text-muted-foreground italic`}>
          {t.stateDisclosuresEnglishNote}
        </p>
      )}
      {stateDisclosures.map((disclosure, i) => (
        <p key={i} className={`${bodyClass} text-muted-foreground`}>
          {disclosure}
        </p>
      ))}

      {compliance.postSalePurchaseWindowDays > 0 && (
        <p className={`${bodyClass} text-muted-foreground`}>
          <strong>{t.postSaleLabel}</strong>{" "}
          {t.postSaleBody(compliance.postSalePurchaseWindowDays, compliance.stateName)}
        </p>
      )}

      <div
        className={`mt-1 pt-1 border-t border-border-custom/50 ${
          compliance.requiresBoldType ? "border-2 border-foreground rounded p-2" : ""
        }`}
      >
        <p className={`${bodyClass} text-muted-foreground`}>
          <strong>{t.contractLabel}</strong> {compliance.salesContractClause}
        </p>
      </div>

      {compliance.docFeeDisclosures.length > 0 && (
        <p className={`${bodyClass} text-muted-foreground`}>
          <strong>{compliance.docFeeTerminology.toUpperCase()} NOTICE ({compliance.stateCode}):</strong>{" "}
          {compliance.docFeeDisclosures.join(" ")}
        </p>
      )}

      <p className={`text-[8px] text-muted-foreground/70 mt-1`}>
        {t.retentionBody(compliance.recordRetentionYears, compliance.stateName)}
      </p>
    </div>
  );
};

export default Disclosures;
