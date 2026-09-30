import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MODULE_URL = "/modules/resources-finance.html";

export function ResourcesFinanceWorkspace() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);
  const version = useRef(0);
  const dataRef = useRef<any>(undefined);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const utils = trpc.useUtils();
  const query = trpc.smis.resourcesFinance.get.useQuery(undefined, { retry: false });
  const mutation = trpc.smis.resourcesFinance.save.useMutation();
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;
  dataRef.current = query.data;

  const sendInit = () => {
    const current = dataRef.current;
    if (!frameReady.current || !current || !frameRef.current?.contentWindow) return;
    version.current = current.version;
    frameRef.current.contentWindow.postMessage({
      type: "nexus:init",
      state: current.state,
      ctx: { ...current.context, role: current.role },
    }, window.location.origin);
  };

  useEffect(() => { sendInit(); }, [query.data]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as { type?: string; data?: unknown } | null;
      if (!message || typeof message !== "object") return;
      if (message.type === "nexus:ready") {
        frameReady.current = true;
        sendInit();
        return;
      }
      if (message.type !== "nexus:save" || typeof message.data !== "string") return;
      const serialized = message.data;
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          const result = await mutationRef.current.mutateAsync({ data: serialized, version: version.current });
          version.current = result.version;
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "Unable to save Resources & Finance data";
          if (messageText.includes("VERSION_CONFLICT")) {
            try {
              const latest = await utils.smis.resourcesFinance.get.fetch();
              version.current = latest.version;
              if (latest.state && frameRef.current?.contentWindow) {
                frameRef.current.contentWindow.postMessage({
                  type: "nexus:state", state: latest.state,
                  ctx: { ...latest.context, role: latest.role },
                }, window.location.origin);
              }
            } catch {
              toast.error("Another user saved changes. Reload this section to continue.");
            }
          } else {
            toast.error(messageText.replaceAll("_", " "));
          }
        }
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [utils]);

  if (query.isLoading) return <div className="soft-card flex items-center gap-3 rounded-xl p-6 text-sm text-[#53675d]"><LoaderCircle className="animate-spin" size={18}/>Loading the protected Finance & Resources register…</div>;
  if (query.error || !query.data) return <div role="alert" className="soft-card rounded-xl border border-[#e8bcb6] p-5 text-sm text-[#843b35]">This module is not available for your account. Ask an administrator for Finance or Stores access.</div>;

  return <section className="soft-card overflow-hidden rounded-xl border border-[#d8ded7] bg-white">
    <iframe
      ref={frameRef}
      title="Finance & Resources"
      src={MODULE_URL}
      onLoad={() => { frameReady.current = true; sendInit(); }}
      className="block min-h-[78vh] w-full border-0"
      sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads"
    />
  </section>;
}
