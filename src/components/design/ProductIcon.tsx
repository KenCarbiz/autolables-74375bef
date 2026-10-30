import type { SVGProps } from "react";
import { PRODUCT_ICON_PATHS, type ProductIconName } from "@/lib/design/productIconPaths";
import { cn } from "@/lib/utils";

type Props = Omit<SVGProps<SVGSVGElement>, "children" | "name"> & {
  name: ProductIconName;
  /** Names an icon that carries meaning; without it the icon is decorative. */
  label?: string;
};

/** The kit's 24px stroke family, inline so currentColor inherits. 20px by default. */
export function ProductIcon({ name, label, className, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cn("h-5 w-5 flex-shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
      dangerouslySetInnerHTML={{ __html: PRODUCT_ICON_PATHS[name] }}
    />
  );
}

export type { ProductIconName };
