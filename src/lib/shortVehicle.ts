export const shortVehicle = (label: string): string =>
  /^(19|20)\d\d\s/.test(label) ? label.split(" ").slice(0, 3).join(" ") : label;
