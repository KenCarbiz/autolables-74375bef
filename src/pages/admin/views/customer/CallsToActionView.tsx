import StickyButtonsPanel from "@/components/admin/StickyButtonsPanel";
import { InlineNote } from "@/components/admin/v2/primitives";

export default function CallsToActionView() {
  return (
    <div className="space-y-4 max-w-4xl">
      <InlineNote tone="info" title="Button choices save as you change them.">
        The sticky bar on the customer Passport reads these the next time a shopper opens a passport.
      </InlineNote>
      <StickyButtonsPanel />
    </div>
  );
}
