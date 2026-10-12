import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Package, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const inputClass = "w-full rounded-lg border border-[#d8e2d8] bg-white px-3 py-2.5 text-sm text-[#263327] outline-none transition focus:border-[#7ca57b] focus:ring-2 focus:ring-[#628962]/15";
const movementTitle: Record<string, string> = { received: "Received", issued: "Issued", adjustment: "Adjustment" };

export function StorekeeperWorkspace({ canEdit }: { canEdit: boolean }) {
  const [itemId, setItemId] = useState("");
  const [movementType, setMovementType] = useState<"received" | "issued" | "adjustment">("received");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const stock = trpc.smis.store.overview.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const movements = trpc.smis.store.movements.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const record = trpc.smis.store.recordMovement.useMutation({
    onSuccess: () => {
      toast.success(movementTitle[movementType] + " movement recorded");
      setQuantity("");
      setReference("");
      void utils.smis.store.overview.invalidate();
      void utils.smis.store.movements.invalidate();
      void utils.smis.snapshot.invalidate();
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const rows = stock.data ?? [];
  const visibleRows = useMemo(() => rows.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const lowStock = rows.filter(row => Number(row.quantity) <= Number(row.reorderLevel));

  if (stock.isLoading) return <div className="store-workspace-loading" aria-label="Loading stock register"><div /><div /><div /></div>;
  if (stock.isError) return <section className="store-workspace-error"><div><p className="font-bold text-[#202b21]">Stock records could not be loaded</p><p className="mt-1 text-sm text-[#68746a]">Check the connection and try again.</p><button type="button" onClick={() => void stock.refetch()} className="quiet-button mt-4"><RefreshCw size={14} />Try again</button></div></section>;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!itemId || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Select an item and enter a quantity greater than zero");
      return;
    }
    record.mutate({ itemId: Number(itemId), movementType, quantity: amount, reference: reference.trim() || null });
  };

  return <div className="store-workspace page-enter">
    <header className="store-workspace-header"><div><p className="eyebrow">NEXUS · school operations</p><h1>Stock register</h1><p>Balances and movements from the school’s recorded store transactions.</p></div><div className="store-access-chip"><ShieldCheck size={15} />{canEdit ? "Store editor" : "Read-only access"}</div></header>

    <section className="store-summary-grid" aria-label="Stock summary">
      <article><span>Stock items</span><b>{rows.length.toLocaleString("en-KE")}</b><small>Items in the current register</small></article>
      <article className={lowStock.length ? "store-summary-alert" : ""}><span>At or below reorder</span><b>{lowStock.length.toLocaleString("en-KE")}</b><small>{lowStock.length ? "Requires review" : "No reorder alerts"}</small></article>
      <article><span>Recent movements</span><b>{movements.data?.length ?? 0}</b><small>Latest saved transactions</small></article>
    </section>

    {canEdit && <form className="store-movement-form" onSubmit={submit}>
      <div className="store-form-heading"><span className="store-form-icon"><Plus size={16} /></span><div><b>Record a stock movement</b><small>Saved to the NEXUS store register and audit trail.</small></div></div>
      <div className="store-form-fields">
        <label>Item<select className={inputClass} value={itemId} onChange={event => setItemId(event.target.value)} required><option value="">Choose an item</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name} · on hand {row.quantity} {row.unit}</option>)}</select></label>
        <label>Movement type<select className={inputClass} value={movementType} onChange={event => setMovementType(event.target.value as typeof movementType)}><option value="received">Receipt · adds stock</option><option value="issued">Issue · reduces stock</option><option value="adjustment">Adjustment · adds stock</option></select></label>
        <label>Quantity<input className={inputClass} type="number" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} required placeholder="0" /></label>
        <label>Reference <span className="text-[#879187]">(optional)</span><input className={inputClass} value={reference} onChange={event => setReference(event.target.value)} maxLength={120} placeholder="Delivery note or issue reference" /></label>
        <button className="action-button store-submit" type="submit" disabled={record.isPending || !rows.length}>{record.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />}{record.isPending ? "Saving…" : "Save movement"}</button>
      </div>
    </form>}

    <div className="store-register-grid">
      <section className="store-register-panel"><div className="store-register-head"><div><p className="dashboard-eyebrow">Live stock ledger</p><h2>Current balances</h2></div><label className="store-search"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter items" aria-label="Filter stock items" /></label></div>
        {visibleRows.length ? <div className="store-table-wrap"><table className="store-table"><thead><tr><th>Item</th><th>On hand</th><th>Reorder point</th><th>Status</th></tr></thead><tbody>{visibleRows.map(row => { const isLow = Number(row.quantity) <= Number(row.reorderLevel); return <tr key={row.id}><td><b>{row.name}</b><small>{row.unit}</small></td><td>{Number(row.quantity).toLocaleString("en-KE")}</td><td>{Number(row.reorderLevel).toLocaleString("en-KE")} {row.unit}</td><td><span className={`store-status ${isLow ? "store-status-low" : "store-status-ok"}`}>{isLow ? "Reorder" : "On track"}</span></td></tr>; })}</tbody></table></div> : <div className="store-empty"><Package size={19} /><b>{search ? "No stock items match" : "No stock items recorded"}</b><p>{search ? "Try another item name." : "Saved store items will appear here."}</p></div>}
      </section>
      <section className="store-register-panel"><div className="store-register-head"><div><p className="dashboard-eyebrow">Recorded receipts and issues</p><h2>Recent movements</h2></div><span className="store-history-count">{movements.data?.length ?? 0}</span></div>
        {movements.isLoading ? <p className="p-5 text-sm text-[#718077]">Loading movement history…</p> : movements.isError ? <div className="store-empty"><p>Movement history could not be loaded.</p><button type="button" onClick={() => void movements.refetch()} className="quiet-button mt-3"><RefreshCw size={14} />Retry</button></div> : movements.data?.length ? <div className="store-movement-list">{movements.data.slice(0, 12).map(movement => <article key={movement.id}><span className={`store-movement-icon store-movement-${movement.movementType}`}>{movement.movementType === "issued" ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}</span><div className="min-w-0 flex-1"><b>{movement.item}</b><small>{movementTitle[movement.movementType] ?? movement.movementType} · {movement.reference || "No reference"} · {new Date(movement.createdAt).toLocaleDateString("en-KE")}</small></div><strong>{movement.movementType === "issued" ? "−" : "+"}{Number(movement.quantity).toLocaleString("en-KE")}</strong></article>)}</div> : <div className="store-empty"><Package size={19} /><b>No movements recorded</b><p>Receipts and issues will appear after they are saved.</p></div>}
      </section>
    </div>
    <p className="store-assets-note"><ShieldCheck size={14} />This system has no separate asset-register records; this view reports only the stock items and movements NEXUS currently stores.</p>
  </div>;
}
