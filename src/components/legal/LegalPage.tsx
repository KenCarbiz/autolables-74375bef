import { ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";

export const LAST_UPDATED = "June 20, 2026";

export function Section({ id, n, title, children }: { id?: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export const Sub = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-3">
    <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
    <div className="mt-1.5 space-y-2 text-[15px] leading-relaxed text-slate-700">{children}</div>
  </div>
);

export const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5">
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ul>
);

export default function LegalPage({
  title,
  path,
  intro,
  children,
}: {
  title: string;
  path: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Seo title={`AutoLabels — ${title}`} description={`${title} for AutoLabels.io.`} path={path} />
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <button onClick={() => navigate("/")} aria-label="AutoLabels home" className="flex items-center">
            <Logo variant="full" size={32} />
          </button>
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link to="/terms" className="hover:text-slate-900">Terms</Link>
            <button onClick={() => navigate("/")} className="hover:text-slate-900">Home</button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-12 lg:py-16">
        <h1 className="font-display text-4xl font-black tracking-tighter text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
        {intro && <div className="mt-5 text-[15px] leading-relaxed text-slate-700">{intro}</div>}
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <footer className="border-t border-slate-100 px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} AutoLabels.io · Clear. Compliant. Consistent.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-slate-700">Privacy</Link>
            <Link to="/terms" className="hover:text-slate-700">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
