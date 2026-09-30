import { ResourcesFinanceWorkspace } from "@/components/ResourcesFinanceWorkspace";

export function FinanceWorkspace() {
  return (
    <div className="page-enter space-y-6">
      <header className="border-b border-[#dfdbd1] pb-5">
        <p className="eyebrow">NEXUS</p>
        <h1 className="mt-1 font-editorial text-[2rem] leading-none text-[#193d32]">
          Finance &amp; Resources
        </h1>
        <p className="mt-2 text-sm text-[#69796f]">
          The full school finance and resources register.
        </p>
      </header>
      <ResourcesFinanceWorkspace />
    </div>
  );
}
