import { Globe } from "lucide-react";
import { usePublicLocale } from "@/lib/i18n/public";

// Compact EN/ES switch for the public window-sticker pages. Reads the
// active locale from PublicLocaleProvider; one tap flips the language
// for the whole page (the choice is persisted in localStorage).
const PublicLanguageToggle = ({ className = "" }: { className?: string }) => {
  const { lang, setLang, L } = usePublicLocale();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "es" : "en")}
      aria-label={`${L.switch_to}`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors ${className}`}
    >
      <Globe className="w-3.5 h-3.5" />
      {L.switch_to}
    </button>
  );
};

export default PublicLanguageToggle;
