// The generator runs as plain JS so it stays usable outside the app's build.
// These are its exported shapes, declared once so tests can import it typed.
export interface ZipPoint { code: string; city: string; state: string; lat: number; lon: number }
export interface MarketArea { area: string; miles: number; size: number }
export declare const KNOWLEDGE_REVISION: string;
export declare function haversine(
  a: { lat: number; lon: number }, b: { lat: number; lon: number }): number;
export declare function parseZips(csv: string): Map<string, ZipPoint>;
export declare function marketArea(
  zips: Map<string, ZipPoint>, originZip: string,
  radiusMiles: number, limit?: number): MarketArea[];
export declare const DEFAULT_RADIUS_MILES: number;
export declare const DEFAULT_POOL_SIZE: number;
export interface MarketAreaEnvelope {
  method: "radius_derived";
  origin_zip: string;
  radius_miles: number;
  dataset: string;
  derived_at: string;
  areas: Array<{ area: string; miles: number }>;
}
export declare function marketAreaEnvelope(
  zips: Map<string, ZipPoint>, originZip: string, radiusMiles: number,
  limit?: number, dataset?: string): MarketAreaEnvelope;
