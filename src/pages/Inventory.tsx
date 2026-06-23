// Inventory renders the Friday "command center" page (InventoryModern), which is
// fully responsive on its own: an executive KPI strip + table on tablet/desktop
// and a card list on mobile. AppShell provides the global mobile header +
// bottom nav around it, so there is no duplicate chrome.
import InventoryModern from "./InventoryModern";

function Inventory() {
  return <InventoryModern />;
}

export default Inventory;
