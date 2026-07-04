interface StickyActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
}

const StickyActionButton = ({ label, onClick, disabled, loading, hint }: StickyActionButtonProps) => (
  <div className="fixed bottom-0 inset-x-0 z-40 bg-gradient-to-t from-background via-background/95 to-transparent pt-6">
    <div className="max-w-[480px] mx-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {hint && (
        <div className="flex justify-center mb-2">
          <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 text-center">
            {hint}
          </p>
        </div>
      )}
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className="w-full h-14 rounded-2xl bg-blue-600 text-white text-base font-bold shadow-premium hover:bg-blue-700 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Submitting…" : label}
      </button>
    </div>
  </div>
);

export default StickyActionButton;
