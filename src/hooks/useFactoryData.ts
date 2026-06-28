import { useState } from "react";

export interface NhtsaMsrpData {
  baseMsrp: string;
  standardEquipment: string[];
  vehicleType: string;
  plantInfo: string;
  bodyClass: string;
  gvwr: string;
  trim: string;
}

const NHTSA_API = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinExtended";

export const useFactoryData = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFactoryData = async (vin: string): Promise<NhtsaMsrpData | null> => {
    const cleaned = vin.trim().toUpperCase();
    if (cleaned.length !== 17) {
      setError("VIN must be 17 characters");
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${NHTSA_API}/${cleaned}?format=json`);
      if (!res.ok) throw new Error("NHTSA API request failed");

      const json = await res.json();
      const results = json.Results || [];

      const getValue = (varName: string): string => {
        const item = results.find((r: any) => r.Variable === varName);
        return item?.Value || "";
      };

      // Extract standard equipment from decoded fields
      const equipment: string[] = [];

      const abs = getValue("Anti-lock Braking System (ABS)");
      if (abs && abs !== "0") equipment.push(`ABS: ${abs}`);

      const airbags = getValue("Air Bag Loc Front");
      if (airbags) equipment.push(`Front Airbags: ${airbags}`);

      const sideAirbags = getValue("Air Bag Loc Side");
      if (sideAirbags) equipment.push(`Side Airbags: ${sideAirbags}`);

      const curtainAirbags = getValue("Air Bag Loc Curtain");
      if (curtainAirbags) equipment.push(`Curtain Airbags: ${curtainAirbags}`);

      const esc = getValue("Electronic Stability Control (ESC)");
      if (esc && esc !== "0") equipment.push(`Electronic Stability Control`);

      const tpms = getValue("Tire Pressure Monitoring System (TPMS) Type");
      if (tpms) equipment.push(`TPMS: ${tpms}`);

      const fc = getValue("Forward Collision Warning");
      if (fc && fc !== "0") equipment.push(`Forward Collision Warning`);

      const laneDepart = getValue("Lane Departure Warning (LDW)");
      if (laneDepart && laneDepart !== "0") equipment.push(`Lane Departure Warning`);

      const blindSpot = getValue("Blind Spot Monitoring (BSM)");
      if (blindSpot && blindSpot !== "0") equipment.push(`Blind Spot Monitoring`);

      const adaptiveCruise = getValue("Adaptive Cruise Control (ACC)");
      if (adaptiveCruise && adaptiveCruise !== "0") equipment.push(`Adaptive Cruise Control`);

      const rearCamera = getValue("Backup Camera");
      if (rearCamera && rearCamera !== "0") equipment.push(`Backup Camera`);

      const parkAssist = getValue("Parking Assist");
      if (parkAssist && parkAssist !== "0") equipment.push(`Parking Assist`);

      const autoEmergBrake = getValue("Automatic Emergency Braking (AEB)");
      if (autoEmergBrake && autoEmergBrake !== "0") equipment.push(`Automatic Emergency Braking`);

      const headlampType = getValue("Headlamp Light Source");
      if (headlampType) equipment.push(`Headlamps: ${headlampType}`);

      const entertainment = getValue("Entertainment System");
      if (entertainment) equipment.push(`Entertainment: ${entertainment}`);

      const engineConfig = getValue("Engine Configuration");
      const displacement = getValue("Displacement (L)");
      const cylinders = getValue("Engine Number of Cylinders");
      const hp = getValue("Engine Power (kW)");
      if (displacement || cylinders) {
        const parts: string[] = [];
        if (displacement) parts.push(`${displacement}L`);
        if (cylinders) parts.push(`${cylinders}-cylinder`);
        if (engineConfig) parts.push(engineConfig);
        if (hp) parts.push(`${Math.round(parseFloat(hp) * 1.341)}hp`);
        equipment.push(`Engine: ${parts.join(" ")}`);
      }

      const trans = getValue("Transmission Style");
      const speeds = getValue("Transmission Speeds");
      if (trans) equipment.push(`Transmission: ${speeds ? `${speeds}-Speed ` : ""}${trans}`);

      const driveType = getValue("Drive Type");
      if (driveType) equipment.push(`Drive: ${driveType}`);

      const fuelType = getValue("Fuel Type - Primary");
      if (fuelType) equipment.push(`Fuel: ${fuelType}`);

      const doors = getValue("Doors");
      if (doors) equipment.push(`${doors}-Door`);

      const seatRows = getValue("Seat Rows");
      if (seatRows) equipment.push(`${seatRows} Seat Rows`);

      const wheels = getValue("Wheel Size Front (in)");
      if (wheels) equipment.push(`${wheels}" Wheels`);

      const baseMsrp = getValue("Base Price ($)");

      return {
        baseMsrp: baseMsrp || "",
        standardEquipment: equipment,
        vehicleType: getValue("Vehicle Type"),
        plantInfo: getValue("Plant Company Name"),
        bodyClass: getValue("Body Class"),
        gvwr: getValue("Gross Vehicle Weight Rating From"),
        trim: getValue("Trim"),
      };
    } catch (err: any) {
      setError(err.message || "Failed to fetch factory data");
      setLoading(false);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { fetchFactoryData, loading, error };
};
