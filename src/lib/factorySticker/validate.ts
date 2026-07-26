import { z } from "zod";

export class VinValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VinValidationError";
  }
}

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

export function vinNormalize(vin: string): string {
  const v = String(vin ?? "").trim().toUpperCase();
  if (v.length !== 17) {
    throw new VinValidationError(`VIN must be exactly 17 characters, got ${v.length}`);
  }
  if (/[IOQ]/.test(v)) {
    throw new VinValidationError("VIN may not contain the letters I, O, or Q");
  }
  if (!VIN_CHARS.test(v)) {
    throw new VinValidationError("VIN contains characters outside A-Z (minus I/O/Q) and 0-9");
  }
  return v;
}

const PLACEHOLDER_EXACT = new Set(["null", "undefined", "nan", "tbd", "n/a", "todo"]);

export function isPlaceholderText(s: string): boolean {
  const t = s.trim().toLowerCase();
  return PLACEHOLDER_EXACT.has(t) || t.includes("lorem");
}

export const MAX_PLAUSIBLE_PRICE = 10_000_000;

const cleanStr = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .refine((s) => !isPlaceholderText(s), { message: "placeholder text is not allowed" });

const money = z
  .number()
  .finite()
  .min(0, "price must not be negative")
  .max(MAX_PLAUSIBLE_PRICE, "price is implausibly large");

const mpg = z.number().finite().positive().max(300);
const epaRating = z.number().finite().min(1).max(10);
const nhtsaRating = z.number().finite().min(1).max(5);

const CURRENT_YEAR = new Date().getFullYear();

const vinSchema = z.string().superRefine((v, ctx) => {
  try {
    const normalized = vinNormalize(v);
    if (normalized !== v) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VIN is not normalized (uppercase, trimmed)" });
    }
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
  }
});

const priceStatusSchema = z.enum(["PRICED", "INCLUDED", "NO_CHARGE", "UNAVAILABLE"]);

const pricedItemRule = (
  item: { price?: number; priceStatus: z.infer<typeof priceStatusSchema>; name: string },
  ctx: z.RefinementCtx,
) => {
  if (item.priceStatus === "PRICED" && item.price === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${item.name}" is PRICED but has no price` });
  }
  if (item.priceStatus === "NO_CHARGE" && item.price !== undefined && item.price !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${item.name}" is NO_CHARGE but has a non-zero price` });
  }
  if ((item.priceStatus === "INCLUDED" || item.priceStatus === "UNAVAILABLE") && item.price !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${item.name}" is ${item.priceStatus} and must not carry a price` });
  }
};

const packageSchema = z
  .object({
    code: cleanStr.optional(),
    name: cleanStr,
    description: cleanStr.optional(),
    price: money.optional(),
    priceStatus: priceStatusSchema,
    features: z.array(cleanStr),
  })
  .strict()
  .superRefine(pricedItemRule);

const optionSchema = z
  .object({
    code: cleanStr.optional(),
    name: cleanStr,
    description: cleanStr.optional(),
    price: money.optional(),
    priceStatus: priceStatusSchema,
  })
  .strict()
  .superRefine(pricedItemRule);

const stickerSchema = z
  .object({
    vehicle: z
      .object({
        vin: vinSchema,
        year: z.number().int().min(1950).max(CURRENT_YEAR + 2),
        make: cleanStr,
        model: cleanStr,
        trim: cleanStr.optional(),
        series: cleanStr.optional(),
        bodyStyle: cleanStr.optional(),
        stockNumber: cleanStr.optional(),
        condition: z.enum(["NEW", "USED", "CPO", "DEMO"]),
        exteriorColor: cleanStr.optional(),
        exteriorColorCode: cleanStr.optional(),
        interiorColor: cleanStr.optional(),
        interiorColorCode: cleanStr.optional(),
        engine: cleanStr.optional(),
        transmission: cleanStr.optional(),
        drivetrain: cleanStr.optional(),
        fuelType: cleanStr.optional(),
      })
      .strict(),
    equipment: z
      .object({
        standard: z.array(
          z
            .object({
              category: z.enum([
                "EXTERIOR", "INTERIOR", "COMFORT_CONVENIENCE", "FUNCTIONAL",
                "POWERTRAIN", "SAFETY_SECURITY", "TECHNOLOGY", "OTHER",
              ]),
              items: z.array(cleanStr).min(1),
            })
            .strict(),
        ),
        packages: z.array(packageSchema),
        options: z.array(optionSchema),
      })
      .strict(),
    pricing: z
      .object({
        currency: z.literal("USD"),
        baseMsrp: money.optional(),
        packagesTotal: money.optional(),
        optionsTotal: money.optional(),
        factoryInstalledTotal: money.optional(),
        destinationCharge: money.optional(),
        calculatedTotalMsrp: money.optional(),
        sourceReportedTotalMsrp: money.optional(),
        reconciliationDifference: z.number().finite().min(-MAX_PLAUSIBLE_PRICE).max(MAX_PLAUSIBLE_PRICE).optional(),
        reconciliationStatus: z.enum(["MATCHED", "MINOR_VARIATION", "REVIEW_REQUIRED", "INSUFFICIENT_DATA"]),
      })
      .strict(),
    regulatory: z
      .object({
        epaStatus: z.enum(["VERIFIED", "UNAVAILABLE", "NOT_APPLICABLE"]),
        cityMpg: mpg.optional(),
        highwayMpg: mpg.optional(),
        combinedMpg: mpg.optional(),
        annualFuelCost: money.optional(),
        gallonsPer100Miles: z.number().finite().positive().max(50).optional(),
        fiveYearCostDifference: z.number().finite().min(-100000).max(100000).optional(),
        greenhouseGasRating: epaRating.optional(),
        smogRating: epaRating.optional(),
        epaSourceReference: cleanStr.optional(),
        nhtsaStatus: z.enum(["VERIFIED", "NOT_RATED", "UNAVAILABLE"]),
        overallRating: nhtsaRating.optional(),
        frontalDriverRating: nhtsaRating.optional(),
        frontalPassengerRating: nhtsaRating.optional(),
        sideFrontRating: nhtsaRating.optional(),
        sideRearRating: nhtsaRating.optional(),
        rolloverRating: nhtsaRating.optional(),
        nhtsaSourceReference: cleanStr.optional(),
      })
      .strict(),
    factory: z
      .object({
        assemblyPlant: cleanStr.optional(),
        assemblyCountry: cleanStr.optional(),
        finalAssemblyPoint: cleanStr.optional(),
        transportMethod: cleanStr.optional(),
        orderNumber: cleanStr.optional(),
        sequenceNumber: cleanStr.optional(),
        dealerCode: cleanStr.optional(),
        partsContent: z
          .array(z.object({ label: cleanStr, value: cleanStr, sourceVerified: z.boolean() }).strict())
          .optional(),
      })
      .strict(),
    warranty: z
      .object({
        basic: cleanStr.optional(),
        powertrain: cleanStr.optional(),
        corrosion: cleanStr.optional(),
        roadside: cleanStr.optional(),
        emissions: cleanStr.optional(),
        sourceVerified: z.boolean(),
      })
      .strict()
      .optional(),
    dealer: z
      .object({
        tenantId: cleanStr,
        name: cleanStr,
        address: cleanStr.optional(),
        city: cleanStr.optional(),
        state: cleanStr.optional(),
        postalCode: cleanStr.optional(),
        phone: cleanStr.optional(),
        website: cleanStr.optional(),
        authorizedLogoUrl: cleanStr.optional(),
      })
      .strict(),
    document: z
      .object({
        vehicleId: cleanStr,
        documentId: cleanStr,
        sourceProvider: z.enum(["NEOVIN", "OEM_PDF", "DEALER_UPLOAD", "MANUAL_REVIEW"]),
        sourceClassification: z.enum([
          "ORIGINAL_OEM_DOCUMENT", "OEM_BUILD_DATA", "OEM_INVENTORY_MATCH",
          "CONFIGURATION_MATCH", "DEALER_VERIFIED",
        ]),
        confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
        verificationStatus: z.enum(["AUTO_VERIFIED", "DEALER_VERIFIED", "REVIEW_REQUIRED", "UNPUBLISHED"]),
        generatedAt: z.string().datetime({ offset: true }),
        passportUrl: z.string().url(),
        templateVersion: cleanStr,
        rendererVersion: cleanStr,
        dataVersion: cleanStr,
      })
      .strict(),
  })
  .strict();

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateStickerData(data: unknown): ValidationResult {
  const parsed = stickerSchema.safeParse(data);
  if (parsed.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
