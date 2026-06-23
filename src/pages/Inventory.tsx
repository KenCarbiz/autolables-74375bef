import InventoryModern from "./InventoryModern";
import InventoryMobileRestored from "./InventoryMobileRestored";

function Inventory() {
  return (
    <>
      <div className="lg:hidden">
        <InventoryMobileRestored />
      </div>
      <div className="hidden lg:block">
        <InventoryModern />
      </div>
    </>
  );
}

export default Inventory;
