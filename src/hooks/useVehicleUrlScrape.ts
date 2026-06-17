import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ScrapedVehicle {
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  stock: string;
  mileage: string;
  color: string;
  interiorColor: string;
  price: string;
  condition: string;
  bodyStyle: string;
  transmission: string;
  driveType: string;
  fuelType: string;
  engine: string;
  description: string;
  imageUrl: string;
  ymm: string;
  sourceUrl: string;
}

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

export const useVehicleUrlScrape = () => {
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrape = async (url: string): Promise<ScrapedVehicle | null> => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a URL");
      return null;
    }

    try {
      new URL(trimmed);
    } catch {
      setError("Invalid URL format");
      return null;
    }

    setScraping(true);
    setError(null);

    let html = "";

    // Try each CORS proxy
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetch(proxy(trimmed), { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          html = await res.text();
          if (html.length > 500) break;
        }
      } catch {
        continue;
      }
    }

    // Parse whatever the proxy returned.
    let result = html ? parseVehiclePage(html, trimmed) : null;
    const empty = (r: ScrapedVehicle | null) => !r || (!r.vin && !r.make && !r.model && !r.year);

    // Fallback for JS-walled sites (Team Velocity/Apollo, DealerOn, etc.):
    // a plain fetch returns the empty JS shell, so render the page through
    // Firecrawl (when configured) and parse the real HTML.
    if (empty(result)) {
      try {
        const { data } = await supabase.functions.invoke("firecrawl-scrape", { body: { url: trimmed } });
        const fcHtml = (data as { html?: string } | null)?.html;
        if (fcHtml && fcHtml.length > 500) {
          const fcResult = parseVehiclePage(fcHtml, trimmed);
          if (!empty(fcResult)) result = fcResult;
        }
      } catch {
        /* Firecrawl unavailable — fall through to the error below */
      }
    }

    setScraping(false);

    if (empty(result)) {
      setError("No vehicle data found. Add the Firecrawl key for JS-heavy sites, or paste the page source.");
      return null;
    }

    return result;
  };

  const parseFromSource = (source: string): ScrapedVehicle | null => {
    setError(null);
    if (!source || source.length < 100) {
      setError("Pasted content too short — paste the full page source");
      return null;
    }
    const result = parseVehiclePage(source, "");
    if (!result.vin && !result.make && !result.model) {
      setError("No vehicle data found in pasted source.");
      return null;
    }
    return result;
  };

  return { scrape, parseFromSource, scraping, error };
};

function parseVehiclePage(html: string, sourceUrl: string): ScrapedVehicle {
  const vehicle: ScrapedVehicle = {
    vin: "", year: "", make: "", model: "", trim: "", stock: "",
    mileage: "", color: "", interiorColor: "", price: "", condition: "",
    bodyStyle: "", transmission: "", driveType: "", fuelType: "", engine: "",
    description: "", imageUrl: "", ymm: "", sourceUrl,
  };

  // 1. Parse JSON-LD structured data (most reliable)
  const jsonLdBlocks = extractJsonLd(html);
  for (const block of jsonLdBlocks) {
    parseJsonLd(block, vehicle);
  }

  // 2. Parse meta tags (Open Graph, standard meta)
  parseMetaTags(html, vehicle);

  // 3. Parse common HTML patterns and data attributes
  parseHtmlPatterns(html, vehicle);

  // Build YMM string
  const parts = [vehicle.year, vehicle.make, vehicle.model];
  if (vehicle.trim) parts.push(vehicle.trim);
  vehicle.ymm = parts.filter(Boolean).join(" ");

  return vehicle;
}

function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else {
        results.push(parsed);
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return results;
}

function parseJsonLd(obj: any, vehicle: ScrapedVehicle) {
  if (!obj || typeof obj !== "object") return;

  // Handle @graph arrays
  if (obj["@graph"]) {
    for (const item of obj["@graph"]) {
      parseJsonLd(item, vehicle);
    }
    return;
  }

  const type = (obj["@type"] || "").toLowerCase();
  if (!type.includes("car") && !type.includes("vehicle") && !type.includes("product") && !type.includes("auto")) {
    return;
  }

  // VIN
  if (obj.vehicleIdentificationNumber) vehicle.vin = obj.vehicleIdentificationNumber;
  if (obj.vin) vehicle.vin = obj.vin;

  // Year
  if (obj.vehicleModelDate) vehicle.year = String(obj.vehicleModelDate);
  if (obj.modelDate) vehicle.year = String(obj.modelDate);
  if (obj.productionDate) vehicle.year = String(obj.productionDate).slice(0, 4);

  // Make
  if (obj.brand) {
    vehicle.make = typeof obj.brand === "string" ? obj.brand : (obj.brand.name || "");
  }
  if (obj.manufacturer) {
    const mfg = typeof obj.manufacturer === "string" ? obj.manufacturer : (obj.manufacturer.name || "");
    if (!vehicle.make) vehicle.make = mfg;
  }

  // Model
  if (obj.model) {
    vehicle.model = typeof obj.model === "string" ? obj.model : (obj.model.name || "");
  }

  // Name often has "Year Make Model Trim"
  if (obj.name && !vehicle.year) {
    const nameMatch = String(obj.name).match(/^(\d{4})\s+(\S+)\s+(.+)/);
    if (nameMatch) {
      vehicle.year = vehicle.year || nameMatch[1];
      vehicle.make = vehicle.make || nameMatch[2];
      vehicle.model = vehicle.model || nameMatch[3];
    }
  }

  // Trim
  if (obj.vehicleConfiguration) vehicle.trim = obj.vehicleConfiguration;
  if (obj.trim) vehicle.trim = obj.trim;

  // Mileage
  if (obj.mileageFromOdometer) {
    const m = obj.mileageFromOdometer;
    vehicle.mileage = typeof m === "object" ? String(m.value || "") : String(m);
  }

  // Color
  if (obj.color) vehicle.color = obj.color;
  if (obj.vehicleInteriorColor) vehicle.interiorColor = obj.vehicleInteriorColor;

  // Body
  if (obj.bodyType) vehicle.bodyStyle = obj.bodyType;

  // Transmission
  if (obj.vehicleTransmission) vehicle.transmission = obj.vehicleTransmission;

  // Drive type
  if (obj.driveWheelConfiguration) vehicle.driveType = obj.driveWheelConfiguration;

  // Fuel
  if (obj.fuelType) vehicle.fuelType = obj.fuelType;

  // Engine
  if (obj.vehicleEngine) {
    const eng = obj.vehicleEngine;
    vehicle.engine = typeof eng === "string" ? eng : (eng.name || eng.engineDisplacement || "");
  }

  // Condition
  if (obj.itemCondition) {
    const cond = String(obj.itemCondition).toLowerCase();
    vehicle.condition = cond.includes("new") ? "New" : cond.includes("used") ? "Used" : "";
  }

  // Price
  if (obj.offers) {
    const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
    if (offer?.price) vehicle.price = String(offer.price);
  }

  // Image
  if (obj.image) {
    const img = Array.isArray(obj.image) ? obj.image[0] : obj.image;
    vehicle.imageUrl = typeof img === "string" ? img : (img?.url || "");
  }

  // Description
  if (obj.description) vehicle.description = String(obj.description).slice(0, 500);

  // Stock number (non-standard but some dealers include it)
  if (obj.sku) vehicle.stock = obj.sku;
  if (obj.stockNumber) vehicle.stock = obj.stockNumber;
  if (obj.productID) vehicle.stock = vehicle.stock || obj.productID;
}

function parseMetaTags(html: string, vehicle: ScrapedVehicle) {
  const getMeta = (name: string): string => {
    const patterns = [
      new RegExp(`<meta[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`, "i"),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return "";
  };

  // OG tags
  const ogTitle = getMeta("og:title");
  const ogDesc = getMeta("og:description");
  const ogImage = getMeta("og:image");

  if (ogTitle && !vehicle.year) {
    const m = ogTitle.match(/(\d{4})\s+(\S+)\s+(.+)/);
    if (m) {
      vehicle.year = vehicle.year || m[1];
      vehicle.make = vehicle.make || m[2];
      vehicle.model = vehicle.model || m[3].split(/\s*[-|·]\s*/)[0].trim();
    }
  }

  if (ogDesc && !vehicle.description) vehicle.description = ogDesc.slice(0, 500);
  if (ogImage && !vehicle.imageUrl) vehicle.imageUrl = ogImage;

  // Common auto-specific meta tags
  if (!vehicle.vin) vehicle.vin = getMeta("vin") || getMeta("vehicle:vin");
  if (!vehicle.stock) vehicle.stock = getMeta("stock") || getMeta("stocknumber") || getMeta("vehicle:stock_number");
  if (!vehicle.price) vehicle.price = getMeta("product:price:amount") || getMeta("og:price:amount");
}

function parseHtmlPatterns(html: string, vehicle: ScrapedVehicle) {
  // VIN patterns in page content
  if (!vehicle.vin) {
    const vinPatterns = [
      /VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i,
      /data-vin\s*=\s*["']([A-HJ-NPR-Z0-9]{17})["']/i,
      /vehicle[_-]?vin["\s:=]*["']?([A-HJ-NPR-Z0-9]{17})/i,
    ];
    for (const p of vinPatterns) {
      const m = html.match(p);
      if (m) { vehicle.vin = m[1]; break; }
    }
  }

  // Stock number patterns
  if (!vehicle.stock) {
    const stockPatterns = [
      /Stock\s*(?:#|Number|No\.?)[:\s]*([A-Za-z0-9-]+)/i,
      /data-stock[_-]?(?:number|num|no)?\s*=\s*["']([^"']+)["']/i,
      /stock[_-]?(?:number|num|no)["'\s:=]+["']?([A-Za-z0-9-]+)/i,
    ];
    for (const p of stockPatterns) {
      const m = html.match(p);
      if (m) { vehicle.stock = m[1].trim(); break; }
    }
  }

  // Mileage patterns
  if (!vehicle.mileage) {
    const milePatterns = [
      /(?:Mileage|Odometer|Miles)[:\s]*([\d,]+)\s*(?:mi|miles)?/i,
      /data-mileage\s*=\s*["']([\d,]+)["']/i,
      /([\d,]+)\s*(?:mi|miles)\b/i,
    ];
    for (const p of milePatterns) {
      const m = html.match(p);
      if (m) { vehicle.mileage = m[1].replace(/,/g, ""); break; }
    }
  }

  // Price patterns
  if (!vehicle.price) {
    const pricePatterns = [
      /(?:Price|Selling\s*Price|Internet\s*Price|Your\s*Price)[:\s]*\$?([\d,]+)/i,
      /data-price\s*=\s*["']([\d,]+)["']/i,
    ];
    for (const p of pricePatterns) {
      const m = html.match(p);
      if (m) { vehicle.price = m[1].replace(/,/g, ""); break; }
    }
  }

  // Color patterns
  if (!vehicle.color) {
    const colorPatterns = [
      /(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]*([A-Za-z\s]+?)(?:\s*<|,|\n|$)/i,
      /data-exterior[_-]?color\s*=\s*["']([^"']+)["']/i,
    ];
    for (const p of colorPatterns) {
      const m = html.match(p);
      if (m) { vehicle.color = m[1].trim(); break; }
    }
  }

  // Interior color
  if (!vehicle.interiorColor) {
    const intPatterns = [
      /(?:Interior\s*Color|Int\.?\s*Color)[:\s]*([A-Za-z\s]+?)(?:\s*<|,|\n|$)/i,
    ];
    for (const p of intPatterns) {
      const m = html.match(p);
      if (m) { vehicle.interiorColor = m[1].trim(); break; }
    }
  }

  // Transmission
  if (!vehicle.transmission) {
    const transPatterns = [
      /(?:Transmission)[:\s]*([A-Za-z0-9\s-]+?)(?:\s*<|,|\n|$)/i,
    ];
    for (const p of transPatterns) {
      const m = html.match(p);
      if (m) { vehicle.transmission = m[1].trim(); break; }
    }
  }

  // Engine
  if (!vehicle.engine) {
    const engPatterns = [
      /(?:Engine)[:\s]*([A-Za-z0-9\s.,-]+?)(?:\s*<|\n|$)/i,
    ];
    for (const p of engPatterns) {
      const m = html.match(p);
      if (m && m[1].length < 80) { vehicle.engine = m[1].trim(); break; }
    }
  }

  // Body style
  if (!vehicle.bodyStyle) {
    const bodyPatterns = [
      /(?:Body\s*(?:Style|Type))[:\s]*([A-Za-z\s]+?)(?:\s*<|,|\n|$)/i,
    ];
    for (const p of bodyPatterns) {
      const m = html.match(p);
      if (m) { vehicle.bodyStyle = m[1].trim(); break; }
    }
  }

  // Condition from title/URL
  if (!vehicle.condition) {
    if (/\b(?:new)\b/i.test(html.slice(0, 2000))) vehicle.condition = "New";
    else if (/\b(?:pre-owned|used|certified)\b/i.test(html.slice(0, 2000))) vehicle.condition = "Used";
  }
}
