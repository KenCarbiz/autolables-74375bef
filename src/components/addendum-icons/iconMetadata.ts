import type { ComponentType } from "react";
import {
  CheckCircle2, Check, XCircle, AlertTriangle, AlertCircle, Info, BadgeCheck, ShieldCheck,
  Clock, Hourglass, Star, Sparkles, ThumbsUp, Award, Medal, Flag, Ban, CircleDot,
  TrendingUp, TrendingDown, QrCode, Fingerprint, ScanLine, Car, CarFront, Truck, Gauge,
  Fuel, Battery, BatteryCharging, Zap, PlugZap, Cog, Disc, Snowflake, Wind, Thermometer,
  Droplets, Droplet, Key, KeyRound, Lock, Navigation, Compass, MapPin, Camera, Music,
  Bluetooth, Wifi, Smartphone, Sun, Moon, Armchair, Fan, Lightbulb, Eye, Route, Mountain,
  Shield, Layers, Paintbrush, SprayCan, Umbrella, CloudRain, Package, Luggage, Box, Link2,
  Bike, Tent, ShieldPlus, ShieldAlert, HeartHandshake, LifeBuoy, PhoneCall, CalendarClock,
  Infinity as InfinityIcon, FileCheck, Banknote, Gem, Wrench, AirVent, ClipboardCheck,
  CalendarCheck, FileText, FileSignature, Files, FolderOpen, ClipboardList, ScrollText,
  Stamp, Pen, BookOpen, Receipt, Printer, Download, Upload, Search, Copy, Share2,
  ExternalLink, Plus, Minus, X, Menu, Phone, Mail, MessageSquare, Send, Globe, Settings,
  AlertOctagon, BellRing, Waves, FileWarning, RefreshCw, DollarSign, Percent, Tag, Gift,
  Handshake, Users, Volume2, Radio, Timer, CalendarDays, History, Grid3x3, Layers2,
  BadgeDollarSign, PiggyBank, Landmark, CircleDollarSign, Barcode, ArrowRight, ArrowLeft,
  ChevronsRight, Leaf,
} from "lucide-react";
import type { AddendumIconCategory, AddendumIconMeta, AddendumIconSource, AddendumIconStatus } from "./iconTypes";
import type { AddendumIconColor } from "./colorTokens";
import {
  PassportBook, PassportShield, PassportBadge, PassportStamp, DigitalPassport,
  VehiclePassportShield, PassportQr, PassportVerified, PassportDocuments, PassportHistory,
  PassportProtection, PassportBenefits, WindowTint, PaintProtectionFilm, WindowSticker,
  AddendumSheet, OilCan, OilChange, FuelNozzle, SteeringWheel, PlaceholderGlyph,
} from "./customIcons";

// One definition per icon: the render component AND the manifest row live
// together so the registry and metadata can never drift apart. Artwork for
// custom_required entries is a stand-in — swap the SVG in customIcons.tsx
// (or point `icon` at final art) without touching template code.

export type AddendumIconComponent = ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  "aria-label"?: string;
}>;

export interface AddendumIconDef extends AddendumIconMeta {
  icon: AddendumIconComponent;
}

const ALL_COLORS: AddendumIconColor[] = ["blue", "green", "purple", "orange", "gray", "navy"];

const USE_BY_CATEGORY: Record<AddendumIconCategory, string> = {
  status: "Status rows, verification chips, and result badges",
  passport: "Vehicle Passport trust surfaces and QR touchpoints",
  vehicle: "Spec rows, drivetrain call-outs, and feature highlights",
  accessories: "Addendum line items for installed or optional equipment",
  coverage: "Warranty, protection-plan, and coverage summaries",
  maintenance: "Service records, prep work, and fluid call-outs",
  documents: "Document lists, compliance labels, and packet rows",
  ui: "Buttons, links, and communication actions",
  warnings: "Recall, disclosure, and caution rows",
};

const d = (
  iconId: string,
  name: string,
  category: AddendumIconCategory,
  icon: AddendumIconComponent,
  source: AddendumIconSource,
  defaultColor: AddendumIconColor,
  tags: string[],
  opts: { status?: AddendumIconStatus; description?: string; use?: string; colors?: AddendumIconColor[] } = {},
): AddendumIconDef => ({
  iconId,
  name,
  category,
  icon,
  source,
  defaultColor,
  allowedColors: opts.colors ?? ALL_COLORS,
  tags,
  status: opts.status ?? "ready",
  description: opts.description ?? `${name} icon for ${category} content.`,
  recommendedUse: opts.use ?? USE_BY_CATEGORY[category],
  });

const custom = { status: "custom_required" as const };
const placeholder = { status: "placeholder" as const };

export const ADDENDUM_ICON_DEFS: AddendumIconDef[] = [
  // ── S — Status / indicators ──────────────────────────────────
  d("S001", "Check Circle", "status", CheckCircle2, "lucide", "green", ["check", "verified", "done"]),
  d("S002", "Check", "status", Check, "lucide", "green", ["check", "yes", "included"]),
  d("S003", "X Circle", "status", XCircle, "lucide", "gray", ["no", "excluded", "unavailable"]),
  d("S004", "Alert Triangle", "status", AlertTriangle, "lucide", "orange", ["warning", "caution"]),
  d("S005", "Alert Circle", "status", AlertCircle, "lucide", "orange", ["alert", "attention"]),
  d("S006", "Info", "status", Info, "lucide", "blue", ["info", "note", "detail"]),
  d("S007", "Badge Check", "status", BadgeCheck, "lucide", "green", ["verified", "certified", "badge"]),
  d("S008", "Shield Check", "status", ShieldCheck, "lucide", "green", ["protected", "secure", "verified"]),
  d("S009", "Clock", "status", Clock, "lucide", "blue", ["time", "pending", "schedule"]),
  d("S010", "Hourglass", "status", Hourglass, "lucide", "gray", ["waiting", "processing"]),
  d("S011", "Star", "status", Star, "lucide", "orange", ["rating", "featured", "favorite"]),
  d("S012", "Sparkles", "status", Sparkles, "lucide", "purple", ["new", "highlight", "premium"]),
  d("S013", "Thumbs Up", "status", ThumbsUp, "lucide", "green", ["approved", "recommended"]),
  d("S014", "Award", "status", Award, "lucide", "purple", ["award", "winner", "recognition"]),
  d("S015", "Medal", "status", Medal, "lucide", "orange", ["medal", "achievement", "top"]),
  d("S016", "Flag", "status", Flag, "lucide", "blue", ["flag", "marker", "milestone"]),
  d("S017", "Ban", "status", Ban, "lucide", "gray", ["not included", "prohibited"]),
  d("S018", "Circle Dot", "status", CircleDot, "lucide", "blue", ["active", "selected", "current"]),
  d("S019", "Trending Up", "status", TrendingUp, "lucide", "green", ["value", "increase", "market"]),
  d("S020", "Trending Down", "status", TrendingDown, "lucide", "blue", ["price drop", "decrease"]),

  // ── P — Passport / trust / verification ──────────────────────
  d("P001", "Passport Book", "passport", PassportBook, "custom", "blue", ["passport", "book", "identity"], custom),
  d("P002", "Passport Shield", "passport", PassportShield, "custom", "blue", ["passport", "shield", "trust"], custom),
  d("P003", "Passport Badge", "passport", PassportBadge, "custom", "purple", ["passport", "badge", "certified"], custom),
  d("P004", "Passport Stamp", "passport", PassportStamp, "custom", "navy", ["passport", "stamp", "record"], custom),
  d("P005", "Digital Passport", "passport", DigitalPassport, "custom", "blue", ["passport", "mobile", "digital"], custom),
  d("P006", "Vehicle Passport Shield", "passport", VehiclePassportShield, "custom", "blue", ["passport", "vehicle", "shield"], custom),
  d("P007", "Passport QR", "passport", PassportQr, "custom", "navy", ["passport", "qr", "scan"], custom),
  d("P008", "Passport Verified", "passport", PassportVerified, "custom", "green", ["passport", "verified", "check"], custom),
  d("P009", "Passport Documents", "passport", PassportDocuments, "custom", "blue", ["passport", "documents", "packet"], custom),
  d("P010", "Passport History", "passport", PassportHistory, "custom", "blue", ["passport", "history", "timeline"], custom),
  d("P011", "Passport Protection", "passport", PassportProtection, "custom", "green", ["passport", "protection", "coverage"], custom),
  d("P012", "Passport Benefits", "passport", PassportBenefits, "custom", "purple", ["passport", "benefits", "perks"], custom),
  d("P013", "QR Code", "passport", QrCode, "lucide", "navy", ["qr", "scan", "code"]),
  d("P014", "Fingerprint", "passport", Fingerprint, "lucide", "blue", ["identity", "unique", "vin"]),
  d("P015", "Scan Line", "passport", ScanLine, "lucide", "blue", ["scan", "reader", "capture"]),

  // ── V — Vehicle / performance / drivetrain ───────────────────
  d("V001", "Car", "vehicle", Car, "lucide", "blue", ["car", "vehicle", "sedan"]),
  d("V002", "Car Front", "vehicle", CarFront, "lucide", "blue", ["car", "front", "grille"]),
  d("V003", "Truck", "vehicle", Truck, "lucide", "blue", ["truck", "pickup", "hauling"]),
  d("V004", "Gauge", "vehicle", Gauge, "lucide", "blue", ["speed", "odometer", "performance"]),
  d("V005", "Fuel Pump", "vehicle", Fuel, "lucide", "blue", ["fuel", "gas", "mpg"]),
  d("V006", "Battery", "vehicle", Battery, "lucide", "blue", ["battery", "12v", "power"]),
  d("V007", "Battery Charging", "vehicle", BatteryCharging, "lucide", "green", ["ev", "charging", "hybrid"]),
  d("V008", "EV Bolt", "vehicle", Zap, "lucide", "green", ["electric", "ev", "power"]),
  d("V009", "Charge Plug", "vehicle", PlugZap, "lucide", "green", ["ev", "plug", "charger"]),
  d("V010", "Engine Cog", "vehicle", Cog, "lucide", "blue", ["engine", "mechanical", "powertrain"]),
  d("V011", "Brake Disc", "vehicle", Disc, "lucide", "blue", ["brakes", "rotor", "disc"]),
  d("V012", "Wheel", "vehicle", CircleDot, "lucide", "navy", ["wheel", "tire", "rim"]),
  d("V013", "AWD Snowflake", "vehicle", Snowflake, "lucide", "blue", ["awd", "winter", "traction"]),
  d("V014", "Aerodynamics", "vehicle", Wind, "lucide", "blue", ["aero", "airflow", "spoiler"]),
  d("V015", "Thermometer", "vehicle", Thermometer, "lucide", "orange", ["temperature", "climate", "coolant"]),
  d("V016", "Key", "vehicle", Key, "lucide", "navy", ["key", "keyless", "entry"]),
  d("V017", "Smart Key", "vehicle", KeyRound, "lucide", "navy", ["smart key", "fob", "proximity"]),
  d("V018", "Lock", "vehicle", Lock, "lucide", "navy", ["security", "lock", "anti-theft"]),
  d("V019", "Navigation", "vehicle", Navigation, "lucide", "blue", ["navigation", "gps", "maps"]),
  d("V020", "Compass", "vehicle", Compass, "lucide", "blue", ["compass", "direction", "adventure"]),
  d("V021", "Backup Camera", "vehicle", Camera, "lucide", "blue", ["camera", "backup", "surround view"]),
  d("V022", "Premium Audio", "vehicle", Music, "lucide", "purple", ["audio", "speakers", "sound"]),
  d("V023", "Bluetooth", "vehicle", Bluetooth, "lucide", "blue", ["bluetooth", "wireless", "pairing"]),
  d("V024", "Wi-Fi Hotspot", "vehicle", Wifi, "lucide", "blue", ["wifi", "hotspot", "connectivity"]),
  d("V025", "Smartphone Link", "vehicle", Smartphone, "lucide", "blue", ["carplay", "android auto", "phone"]),
  d("V026", "Sunroof", "vehicle", Sun, "lucide", "orange", ["sunroof", "moonroof", "panoramic"]),
  d("V027", "Moonroof", "vehicle", Moon, "lucide", "navy", ["moonroof", "glass roof"]),
  d("V028", "Seating", "vehicle", Armchair, "lucide", "blue", ["seats", "leather", "comfort"]),
  d("V029", "Climate Fan", "vehicle", Fan, "lucide", "blue", ["climate", "ac", "ventilated"]),
  d("V030", "LED Lighting", "vehicle", Lightbulb, "lucide", "orange", ["led", "headlights", "lighting"]),
  d("V031", "Driver Assist", "vehicle", Eye, "lucide", "blue", ["adas", "monitoring", "blind spot"]),
  d("V032", "Off-Road", "vehicle", Mountain, "lucide", "green", ["offroad", "terrain", "4x4"]),
  d("V033", "Eco Mode", "vehicle", Leaf, "lucide", "green", ["eco", "efficiency", "hybrid"]),
  d("V034", "Steering Wheel", "vehicle", SteeringWheel, "custom", "blue", ["steering", "wheel", "heated wheel"], custom),
  d("V035", "Heated Seats", "vehicle", PlaceholderGlyph, "custom", "orange", ["heated seats", "comfort"], custom),

  // ── A — Accessories / aftermarket ────────────────────────────
  d("A001", "Window Tint", "accessories", WindowTint, "custom", "green", ["tint", "window", "appearance"], custom),
  d("A002", "Paint Protection Film", "accessories", PaintProtectionFilm, "custom", "green", ["ppf", "film", "paint"], custom),
  d("A003", "Ceramic Coating", "accessories", Droplets, "lucide", "green", ["ceramic", "coating", "hydrophobic"]),
  d("A004", "Paint Sealant", "accessories", Paintbrush, "lucide", "green", ["paint", "sealant", "finish"]),
  d("A005", "Undercoating", "accessories", SprayCan, "lucide", "green", ["undercoat", "rust", "spray"]),
  d("A006", "All-Weather Mats", "accessories", CloudRain, "lucide", "green", ["mats", "weather", "floor"]),
  d("A007", "Cargo Package", "accessories", Package, "lucide", "green", ["cargo", "organizer", "trunk"]),
  d("A008", "Cargo Cover", "accessories", Box, "lucide", "green", ["cargo", "cover", "privacy"]),
  d("A009", "Luggage Carrier", "accessories", Luggage, "lucide", "green", ["luggage", "carrier", "travel"]),
  d("A010", "Roof Rack", "accessories", PlaceholderGlyph, "custom", "green", ["roof rack", "crossbars"], custom),
  d("A011", "Trailer Hitch", "accessories", Link2, "lucide", "green", ["hitch", "towing", "trailer"]),
  d("A012", "Bike Rack", "accessories", Bike, "lucide", "green", ["bike", "rack", "carrier"]),
  d("A013", "Roof Tent Ready", "accessories", Tent, "lucide", "green", ["overland", "tent", "camping"]),
  d("A014", "Mud Flaps", "accessories", PlaceholderGlyph, "custom", "green", ["mud flaps", "splash guards"], custom),
  d("A015", "Bed Liner", "accessories", PlaceholderGlyph, "custom", "green", ["bed liner", "truck bed"], custom),
  d("A016", "Running Boards", "accessories", PlaceholderGlyph, "custom", "green", ["running boards", "steps"], custom),
  d("A017", "Tonneau Cover", "accessories", PlaceholderGlyph, "custom", "green", ["tonneau", "bed cover"], custom),
  d("A018", "Wheel Locks", "accessories", Lock, "lucide", "green", ["wheel locks", "security"]),
  d("A019", "Remote Start", "accessories", Radio, "lucide", "green", ["remote start", "convenience"]),
  d("A020", "Alarm System", "accessories", BellRing, "lucide", "green", ["alarm", "security", "anti-theft"]),
  d("A021", "Dash Camera", "accessories", Camera, "lucide", "green", ["dash cam", "recording"]),
  d("A022", "Splash Guards", "accessories", Droplet, "lucide", "green", ["splash", "guards"]),
  d("A023", "Door Edge Guards", "accessories", Shield, "lucide", "green", ["door", "edge", "guards"]),
  d("A024", "Body Side Molding", "accessories", Layers, "lucide", "green", ["molding", "body side"]),
  d("A025", "Nitrogen Fill", "accessories", Wind, "lucide", "green", ["nitrogen", "tires"]),
  d("A026", "Interior Protection", "accessories", Armchair, "lucide", "green", ["interior", "fabric", "leather care"]),
  d("A027", "Grille Guard", "accessories", Grid3x3, "lucide", "green", ["grille", "guard", "brush"]),
  d("A028", "Accessory Bundle", "accessories", Gift, "lucide", "purple", ["bundle", "package", "value"]),
  d("A029", "Dealer Installed", "accessories", Wrench, "lucide", "green", ["dealer installed", "equipment"]),
  d("A030", "Optional Add-On", "accessories", Plus, "lucide", "gray", ["optional", "available", "add-on"]),
  d("A031", "Not Included In Total", "accessories", Minus, "lucide", "gray", ["not included", "excluded", "pricing"]),
  d("A032", "Appearance Package", "accessories", Sparkles, "lucide", "purple", ["appearance", "styling"]),

  // ── C — Coverage / warranty / protection ─────────────────────
  d("C001", "Warranty Shield", "coverage", Shield, "lucide", "blue", ["warranty", "coverage", "protection"]),
  d("C002", "Coverage Verified", "coverage", ShieldCheck, "lucide", "green", ["warranty", "verified", "active"]),
  d("C003", "Extended Coverage", "coverage", ShieldPlus, "lucide", "purple", ["extended", "warranty", "vsc"]),
  d("C004", "Coverage Alert", "coverage", ShieldAlert, "lucide", "orange", ["expiring", "coverage", "attention"]),
  d("C005", "Factory Warranty", "coverage", PlaceholderGlyph, "custom", "blue", ["factory", "warranty", "oem"], custom),
  d("C006", "Roadside Assistance", "coverage", LifeBuoy, "lucide", "blue", ["roadside", "assistance", "towing"]),
  d("C007", "Assistance Hotline", "coverage", PhoneCall, "lucide", "blue", ["hotline", "support", "24/7"]),
  d("C008", "Coverage Term", "coverage", CalendarClock, "lucide", "blue", ["term", "months", "expiration"]),
  d("C009", "Unlimited Miles", "coverage", InfinityIcon, "lucide", "green", ["unlimited", "miles"]),
  d("C010", "Service Contract", "coverage", FileCheck, "lucide", "blue", ["contract", "vsc", "agreement"]),
  d("C011", "Deductible", "coverage", Banknote, "lucide", "navy", ["deductible", "cost", "claim"]),
  d("C012", "Premium Protection", "coverage", Gem, "lucide", "purple", ["premium", "tier", "top"]),
  d("C013", "Corrosion Coverage", "coverage", Umbrella, "lucide", "blue", ["corrosion", "rust", "perforation"]),
  d("C014", "Customer Care", "coverage", HeartHandshake, "lucide", "green", ["care", "goodwill", "support"]),
  d("C015", "Transferable", "coverage", RefreshCw, "lucide", "blue", ["transferable", "second owner"]),
  d("C016", "Certified Coverage", "coverage", BadgeCheck, "lucide", "purple", ["cpo", "certified", "program"]),

  // ── M — Maintenance / service / fluids ───────────────────────
  d("M001", "Oil Service", "maintenance", Droplet, "lucide", "orange", ["oil", "change", "fluid"]),
  d("M002", "Fuel System", "maintenance", Fuel, "lucide", "orange", ["fuel", "system", "injector"]),
  d("M003", "Wrench", "maintenance", Wrench, "lucide", "blue", ["repair", "service", "mechanical"]),
  d("M004", "Multi-Point Inspection", "maintenance", ClipboardCheck, "lucide", "green", ["inspection", "multi-point", "prep"]),
  d("M005", "Scheduled Service", "maintenance", CalendarCheck, "lucide", "blue", ["scheduled", "maintenance", "interval"]),
  d("M006", "Cabin Air Filter", "maintenance", AirVent, "lucide", "blue", ["filter", "cabin", "air"]),
  d("M007", "Battery Service", "maintenance", Battery, "lucide", "orange", ["battery", "test", "replace"]),
  d("M008", "Brake Service", "maintenance", Disc, "lucide", "orange", ["brakes", "pads", "rotors"]),
  d("M009", "Tire Rotation", "maintenance", RefreshCw, "lucide", "blue", ["tires", "rotation", "balance"]),
  d("M010", "Alignment", "maintenance", Route, "lucide", "blue", ["alignment", "steering"]),
  d("M011", "Coolant Service", "maintenance", Thermometer, "lucide", "orange", ["coolant", "flush", "radiator"]),
  d("M012", "Detail Service", "maintenance", Sparkles, "lucide", "purple", ["detail", "clean", "recondition"]),
  d("M013", "Car Wash", "maintenance", SprayCan, "lucide", "blue", ["wash", "exterior", "clean"]),
  d("M014", "Wiper Service", "maintenance", PlaceholderGlyph, "custom", "blue", ["wipers", "blades", "visibility"], custom),
  d("M015", "Service Timer", "maintenance", Timer, "lucide", "blue", ["due", "interval", "reminder"]),
  d("M016", "Reconditioning", "maintenance", History, "lucide", "green", ["recon", "get ready", "restored"]),
  d("M017", "Oil Can", "maintenance", OilCan, "custom", "blue", ["oil can", "oil service", "lubrication"], custom),
  d("M018", "Oil Change Interval", "maintenance", OilChange, "custom", "blue", ["oil change", "interval", "maintenance"], custom),
  d("M019", "Fuel Nozzle", "maintenance", FuelNozzle, "custom", "blue", ["fuel nozzle", "fuel type", "refill"], custom),

  // ── D — Documents / compliance ───────────────────────────────
  d("D001", "Document", "documents", FileText, "lucide", "navy", ["document", "file", "page"]),
  d("D002", "Verified Document", "documents", FileCheck, "lucide", "green", ["verified", "approved", "document"]),
  d("D003", "Signature Document", "documents", FileSignature, "lucide", "navy", ["signature", "esign", "signed"]),
  d("D004", "Document Set", "documents", Files, "lucide", "navy", ["packet", "documents", "set"]),
  d("D005", "Document Folder", "documents", FolderOpen, "lucide", "navy", ["folder", "records", "archive"]),
  d("D006", "Checklist", "documents", ClipboardList, "lucide", "blue", ["checklist", "items", "tasks"]),
  d("D007", "Disclosure", "documents", ScrollText, "lucide", "navy", ["disclosure", "terms", "legal"]),
  d("D008", "Official Stamp", "documents", Stamp, "lucide", "navy", ["stamp", "official", "notarized"]),
  d("D009", "Signature Pen", "documents", Pen, "lucide", "navy", ["pen", "sign", "initial"]),
  d("D010", "Owner Manual", "documents", BookOpen, "lucide", "blue", ["manual", "booklet", "guide"]),
  d("D011", "Receipt", "documents", Receipt, "lucide", "navy", ["receipt", "invoice", "purchase"]),
  d("D012", "Window Sticker", "documents", WindowSticker, "custom", "blue", ["window sticker", "monroney", "label"], custom),
  d("D013", "Addendum", "documents", AddendumSheet, "custom", "blue", ["addendum", "supplemental", "sticker"], custom),
  d("D014", "Buyers Guide", "documents", PlaceholderGlyph, "custom", "navy", ["buyers guide", "ftc", "as-is"], custom),
  d("D015", "FTC Compliant", "documents", PlaceholderGlyph, "custom", "green", ["ftc", "compliant", "regulation"], custom),
  d("D016", "Title Record", "documents", FileWarning, "lucide", "navy", ["title", "brand", "record"], placeholder),
  d("D017", "Barcode", "documents", Barcode, "lucide", "navy", ["barcode", "vin", "scan"]),

  // ── U — UI / actions / communication ─────────────────────────
  d("U001", "Search", "ui", Search, "lucide", "gray", ["search", "find", "lookup"]),
  d("U002", "Copy", "ui", Copy, "lucide", "gray", ["copy", "duplicate", "clipboard"]),
  d("U003", "Share", "ui", Share2, "lucide", "blue", ["share", "send", "social"]),
  d("U004", "External Link", "ui", ExternalLink, "lucide", "blue", ["link", "external", "open"]),
  d("U005", "Add", "ui", Plus, "lucide", "blue", ["add", "new", "create"]),
  d("U006", "Remove", "ui", X, "lucide", "gray", ["remove", "close", "dismiss"]),
  d("U007", "Menu", "ui", Menu, "lucide", "navy", ["menu", "navigation", "list"]),
  d("U008", "Phone", "ui", Phone, "lucide", "blue", ["call", "phone", "contact"]),
  d("U009", "Email", "ui", Mail, "lucide", "blue", ["email", "message", "contact"]),
  d("U010", "Message", "ui", MessageSquare, "lucide", "blue", ["chat", "text", "sms"]),
  d("U011", "Send", "ui", Send, "lucide", "blue", ["send", "submit", "deliver"]),
  d("U012", "Website", "ui", Globe, "lucide", "blue", ["website", "online", "web"]),
  d("U013", "Settings", "ui", Settings, "lucide", "gray", ["settings", "configure", "admin"]),
  d("U014", "Download", "ui", Download, "lucide", "blue", ["download", "save", "export"]),
  d("U015", "Upload", "ui", Upload, "lucide", "blue", ["upload", "attach", "import"]),
  d("U016", "Print", "ui", Printer, "lucide", "navy", ["print", "paper", "output"]),
  d("U017", "Price Tag", "ui", Tag, "lucide", "green", ["price", "tag", "label"]),
  d("U018", "Dollar", "ui", DollarSign, "lucide", "green", ["price", "dollar", "payment"]),
  d("U019", "Percent", "ui", Percent, "lucide", "green", ["apr", "percent", "rate"]),
  d("U020", "Handshake", "ui", Handshake, "lucide", "green", ["deal", "agreement", "close"]),
  d("U021", "Team", "ui", Users, "lucide", "blue", ["team", "staff", "people"]),
  d("U022", "Announcement", "ui", Volume2, "lucide", "orange", ["announce", "promo", "offer"]),
  d("U023", "Calendar", "ui", CalendarDays, "lucide", "blue", ["calendar", "date", "appointment"]),
  d("U024", "Layers", "ui", Layers2, "lucide", "gray", ["layers", "stack", "templates"]),
  d("U025", "Savings Tag", "ui", BadgeDollarSign, "lucide", "green", ["savings", "fuel savings", "value tag"]),
  d("U026", "Savings", "ui", PiggyBank, "lucide", "green", ["savings", "budget", "piggy bank"]),
  d("U027", "Financing", "ui", Landmark, "lucide", "blue", ["financing", "bank", "lender"]),
  d("U028", "Price Circle", "ui", CircleDollarSign, "lucide", "green", ["price", "cost", "dollar"]),
  d("U029", "Arrow Right", "ui", ArrowRight, "lucide", "blue", ["arrow", "next", "forward"]),
  d("U030", "Arrow Left", "ui", ArrowLeft, "lucide", "blue", ["arrow", "back", "previous"]),
  d("U031", "Chevrons Right", "ui", ChevronsRight, "lucide", "blue", ["chevrons", "more", "continue"]),

  // ── W — Warnings / alerts / recall ───────────────────────────
  d("W001", "Open Recall", "warnings", AlertOctagon, "lucide", "orange", ["recall", "open", "nhtsa"]),
  d("W002", "Stop Sale", "warnings", Ban, "lucide", "orange", ["stop sale", "do not drive"]),
  d("W003", "Recall Notice", "warnings", BellRing, "lucide", "orange", ["recall", "notice", "campaign"]),
  d("W004", "Caution", "warnings", AlertTriangle, "lucide", "orange", ["caution", "warning"]),
  d("W005", "Flood History", "warnings", Waves, "lucide", "orange", ["flood", "water", "damage"]),
  d("W006", "Branded Title", "warnings", FileWarning, "lucide", "orange", ["salvage", "branded", "title"]),
  d("W007", "Odometer Alert", "warnings", Gauge, "lucide", "orange", ["odometer", "rollback", "discrepancy"]),
  d("W008", "Airbag Recall", "warnings", PlaceholderGlyph, "custom", "orange", ["airbag", "takata", "recall"], custom),
  d("W009", "Inspection Required", "warnings", ClipboardCheck, "lucide", "orange", ["inspection", "required", "state"]),
  d("W010", "Time Sensitive", "warnings", Timer, "lucide", "orange", ["deadline", "expiring", "urgent"]),
];

export const ADDENDUM_ICON_METADATA: AddendumIconMeta[] = ADDENDUM_ICON_DEFS.map((def) => {
  const { icon: _icon, ...meta } = def;
  return meta;
});
