import { useParams } from "react-router-dom";
import { ConsoleFixtureProvider } from "@/lib/platformConsole/dataSource";
import { CONSOLE_FIXTURES } from "./fixtures";
import { ConsoleScreen } from "./PlatformConsole";

// Development-only. Renders one console reference screen from synthetic data
// so the visual harness can capture it deterministically. Registered only when
// import.meta.env.DEV is true. The rail and header are plain stand-ins at the
// reference sizes (216px rail, 64px header); scoring regions exclude them.

export default function ConsoleDesignFixture() {
  const { screen } = useParams<{ screen: string }>();
  const entry = screen ? CONSOLE_FIXTURES[screen] : undefined;
  if (!entry) {
    return (
      <div className="p-8 text-sm" data-console-fixture-list>
        <p className="font-semibold">Unknown console fixture.</p>
        <p>Known: {Object.keys(CONSOLE_FIXTURES).join(", ")}</p>
      </div>
    );
  }
  const desktop = entry.frame === "desktop";
  return (
    <ConsoleFixtureProvider fixture={entry.fixture}>
      <div data-console-fixture={screen} className="flex min-h-screen bg-[#F4F6F9]">
        {desktop && <div aria-hidden="true" className="w-[216px] shrink-0 bg-[#14283D]" />}
        <div className="min-w-0 flex-1">
          <div aria-hidden="true" className="h-16 bg-white" />
          <main>
            <ConsoleScreen path={entry.path} />
          </main>
        </div>
      </div>
    </ConsoleFixtureProvider>
  );
}
