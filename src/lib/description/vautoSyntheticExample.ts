import type { StoredPriceRow } from "@/lib/admin/pricing/feeBasis";
import { PROPOSED_FEE_INCLUSIVE_DISCLOSURE } from "./vautoExport";

// One synthetic vehicle used to prove that the price breakdown, the
// description, the disclosure and the exported vAuto text agree. Every name,
// VIN, price and fact here is invented; nothing is read from or written to a
// real store.

export interface SyntheticFact {
  id: string;
  label: string;
  value: string;
  source: string;
  status: "verified";
  /** The sentence the writer drew from this fact. */
  sentence: string;
}

const fact = (id: string, label: string, value: string, source: string, sentence: string): SyntheticFact =>
  ({ id, label, value, source, status: "verified", sentence });

export const SYNTHETIC_STORE = { name: "Example Motors North", city: "Example City", state: "CT" };

export const SYNTHETIC_VEHICLE = {
  id: "veh-synthetic-1",
  vin: "EXMPL00000SYN0001",
  stock: "EX1001",
  label: "2024 Example Crossover LX AWD",
  mileage: 18240,
};

export const SYNTHETIC_SETTINGS = {
  advertised_includes_doc_fee: true,
  doc_fee_enabled: true,
  doc_fee_amount: 499,
};

/** Fee-inclusive: price is the advertised total, advertised_price_before_doc + doc_fee = price. */
export const SYNTHETIC_PRICE_ROW: StoredPriceRow = {
  price: 28995,
  advertisedBeforeDoc: 28496,
  websiteSalePrice: 28995,
  docFee: 499,
};

export const SYNTHETIC_DISCLOSURE = PROPOSED_FEE_INCLUSIVE_DISCLOSURE;
export const SYNTHETIC_CTA = "Contact Example Motors North to confirm availability and schedule a test drive.";

export const SYNTHETIC_FACTS: SyntheticFact[] = [
  fact("identity", "Vehicle", "2024 Example Crossover LX AWD, 18,240 miles", "VIN decode + odometer",
    "This 2024 Example Crossover LX AWD with 18,240 miles is offered by Example Motors North in Example City, CT."),
  fact("engine", "Engine", "1.5L turbocharged 4-cylinder, 190 hp", "VIN decode",
    "Power comes from a 1.5-liter turbocharged four-cylinder engine rated at 190 horsepower."),
  fact("trans", "Transmission", "Continuously variable", "VIN decode",
    "A continuously variable transmission keeps the engine in its efficient range around town and on the highway."),
  fact("awd", "Drivetrain", "All-wheel drive", "VIN decode",
    "All-wheel drive sends power to the wheels with the most grip, which helps on wet roads and in light snow."),
  fact("mpg", "EPA estimate", "27 city / 31 highway mpg", "EPA fuel economy record",
    "The EPA rates this configuration at 27 mpg in the city and 31 mpg on the highway."),
  fact("seats", "Seating", "Five passengers, cloth", "Build data",
    "The cabin seats five, with cloth upholstery that is easy to keep clean."),
  fact("heated", "Heated front seats", "Installed", "Build data",
    "Heated front seats come standard on this trim."),
  fact("rear-seat", "Rear seat", "60/40 split folding", "Build data",
    "The 60/40 split folding rear seat lets you carry a long item and a passenger at the same time."),
  fact("cargo", "Cargo volume", "39.3 cu ft behind the rear seat", "Manufacturer specifications",
    "Behind the rear seat there are 39.3 cubic feet of cargo space."),
  fact("cargo-max", "Maximum cargo", "75.8 cu ft", "Manufacturer specifications",
    "Fold the rear seat down and the cargo area grows to 75.8 cubic feet."),
  fact("screen", "Touchscreen", "7-inch display", "Build data",
    "A 7-inch touchscreen handles audio, phone and vehicle settings."),
  fact("carplay", "Smartphone integration", "Apple CarPlay and Android Auto", "Build data",
    "Apple CarPlay and Android Auto are supported, so your maps and music appear on the dash display."),
  fact("usb", "USB ports", "Two front, two rear", "Build data",
    "There are two USB ports up front and two more for rear passengers."),
  fact("acc", "Adaptive cruise control", "Installed", "Build data",
    "Adaptive cruise control can hold a set gap to the vehicle ahead."),
  fact("lka", "Lane keeping assist", "Installed", "Build data",
    "Lane keeping assist can provide steering input when the vehicle starts to drift from its lane."),
  fact("aeb", "Automatic emergency braking", "Installed", "Build data",
    "Automatic emergency braking with pedestrian detection is part of the standard driver assistance package."),
  fact("bsm", "Blind spot monitoring", "Installed", "Build data",
    "Blind spot monitoring warns you of a vehicle alongside before you change lanes."),
  fact("rcta", "Rear cross traffic alert", "Installed", "Build data",
    "Rear cross traffic alert watches for approaching traffic when you back out of a parking space."),
  fact("camera", "Rearview camera", "Installed with guidelines", "Build data",
    "A rearview camera with guidelines helps when parking."),
  fact("hba", "Auto high beams", "Installed", "Build data",
    "Automatic high beams switch between high and low beams for oncoming traffic."),
  fact("keyless", "Keyless entry", "Smart key with push-button start", "Build data",
    "A smart key with push-button start means the key can stay in your pocket."),
  fact("climate", "Climate control", "Single-zone automatic", "Build data",
    "Automatic climate control holds the cabin temperature you set."),
  fact("wheels", "Wheels", "17-inch alloy", "Build data",
    "It rides on 17-inch alloy wheels."),
  fact("tires", "Tires", "All-season, 7/32 in tread measured", "Reconditioning inspection",
    "The all-season tires measured 7/32 of an inch of tread at our inspection."),
  fact("brakes", "Brakes", "Front pads 8 mm, rear pads 7 mm", "Reconditioning inspection",
    "Brake pads measured 8 millimeters in front and 7 millimeters in the rear."),
  fact("oil", "Oil service", "Oil and filter changed", "Reconditioning work order",
    "The oil and filter were changed during reconditioning."),
  fact("wipers", "Wiper blades", "Replaced", "Reconditioning work order",
    "New wiper blades were installed before the vehicle went on sale."),
  fact("cabin-filter", "Cabin air filter", "Replaced", "Reconditioning work order",
    "The cabin air filter was replaced."),
  fact("battery", "Battery", "Tested, passed", "Reconditioning inspection",
    "The 12-volt battery was tested and passed."),
  fact("inspection", "State safety inspection", "Passed", "Reconditioning inspection",
    "It passed a state safety inspection at our service department."),
  fact("recall", "Open recalls", "None open at last check", "NHTSA recall lookup",
    "An NHTSA recall lookup showed no open recalls when we last checked this VIN."),
  fact("owners", "Previous owners", "One", "Vehicle history report",
    "The vehicle history report lists one previous owner."),
  fact("service", "Service records", "Four dealer service visits", "Vehicle history report",
    "Four dealer service visits are recorded in the vehicle history report."),
  fact("warranty", "Powertrain warranty", "Factory coverage to 5 years / 60,000 miles from the in-service date", "Manufacturer warranty terms",
    "Factory powertrain coverage runs to five years or 60,000 miles from the original in-service date, whichever comes first."),
  fact("color", "Exterior color", "Lunar Silver Metallic", "Build data",
    "The exterior is finished in Lunar Silver Metallic."),
  fact("interior", "Interior color", "Black cloth", "Build data",
    "The interior is black cloth."),
  fact("keys", "Keys", "Two smart keys", "Reconditioning inspection",
    "Two smart keys come with the vehicle."),
  fact("manual", "Owner's manual", "Present", "Reconditioning inspection",
    "The owner's manual is in the glove box."),
  fact("tow", "Towing", "1,500 lb rated", "Manufacturer specifications",
    "It is rated to tow up to 1,500 pounds when properly equipped."),
  fact("ground", "Ground clearance", "7.3 in", "Manufacturer specifications",
    "Ground clearance is 7.3 inches."),
  fact("tank", "Fuel tank", "14.0 gal", "Manufacturer specifications",
    "The fuel tank holds 14 gallons."),
  fact("roof-rails", "Roof rails", "Installed", "Build data",
    "Roof rails are installed for a cargo box or bike rack."),
  fact("liftgate", "Liftgate", "Manual", "Build data",
    "The liftgate is manual."),
  fact("mirrors", "Mirrors", "Heated power side mirrors", "Build data",
    "Heated power side mirrors help keep your view clear on frosty mornings."),
  fact("steering", "Steering wheel", "Leather-wrapped with audio controls", "Build data",
    "A leather-wrapped steering wheel carries the audio and cruise controls."),
  fact("bluetooth", "Bluetooth", "Hands-free phone and audio streaming", "Build data",
    "Bluetooth supports hands-free calling and audio streaming."),
  fact("audio", "Audio", "Six speakers", "Build data",
    "The audio system uses six speakers."),
  fact("lights", "Headlights", "LED low and high beams", "Build data",
    "LED headlights provide the low and high beams."),
  fact("drl", "Daytime running lights", "LED", "Build data",
    "LED daytime running lights are standard."),
  fact("tpms", "Tire pressure monitoring", "Individual tire display", "Build data",
    "The tire pressure monitor shows the reading for each tire."),
  fact("detail", "Detailing", "Interior and exterior detailed", "Reconditioning work order",
    "The interior and exterior were detailed before photos were taken."),
  fact("photos", "Photos", "Taken at the dealership after detailing", "Dealer media",
    "Every photo in this listing shows this exact vehicle, taken at the dealership after detailing."),
  fact("wheelbase", "Wheelbase", "104.7 in", "Manufacturer specifications",
    "The 104.7-inch wheelbase gives a settled ride without making the crossover hard to park."),
  fact("turning", "Turning circle", "37.7 ft", "Manufacturer specifications",
    "A 37.7-foot turning circle makes U-turns and tight parking garages easier."),
  fact("rear-vents", "Rear climate vents", "Installed", "Build data",
    "Rear seat passengers get their own air vents on the back of the center console."),
  fact("armrest", "Center armrest", "Storage bin with sliding lid", "Build data",
    "The front center armrest opens to a storage bin with room for a tablet or a small bag."),
  fact("cupholders", "Cupholders", "Two front, two in the rear armrest", "Build data",
    "There are two cupholders up front and two more in the fold-down rear armrest."),
  fact("cargo-cover", "Cargo cover", "Retractable, present", "Reconditioning inspection",
    "The retractable cargo cover is present and keeps items in the back out of sight."),
  fact("spare", "Spare tire", "Temporary spare and jack present", "Reconditioning inspection",
    "A temporary spare tire and the jack are stored under the cargo floor."),
  fact("floor-mats", "Floor mats", "Cloth mats front and rear", "Reconditioning inspection",
    "Cloth floor mats are in place in the front and rear footwells."),
  fact("alignment", "Alignment", "Checked, within specification", "Reconditioning work order",
    "Wheel alignment was checked during reconditioning and is within the manufacturer's specification."),
  fact("coolant", "Fluids", "Coolant, brake and washer fluid topped off", "Reconditioning work order",
    "Coolant, brake fluid and washer fluid were checked and topped off."),
  fact("road-test", "Road test", "Completed by a technician", "Reconditioning work order",
    "A technician completed a road test after the reconditioning work was finished."),
  fact("drive-modes", "Drive modes", "Normal, Eco and Snow", "Build data",
    "Normal, Eco and Snow drive modes adjust throttle response and traction for the conditions."),
  fact("hill-start", "Hill start assist", "Installed", "Build data",
    "Hill start assist briefly holds the brakes so the vehicle does not roll back on a slope."),
  fact("stability", "Stability control", "Installed with traction control", "Build data",
    "Electronic stability control works with traction control to help keep the vehicle on its intended path."),
];

/** The writer's draft: one sentence per verified fact, identity first, no price anywhere. */
export const SYNTHETIC_NARRATIVE = SYNTHETIC_FACTS.map((f) => f.sentence).join(" ");
