import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Car, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Seo from "@/components/Seo";
import { supabase } from "@/integrations/supabase/client";
import { useReconEstimates, type ReconLine, type ReconMessage } from "@/hooks/useReconEstimates";
import { listingGallery } from "@/lib/photos";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import {
  Button,
  EmptyState,
  LinkButton,
  LocalTabs,
  PageBody,
  PageHeader,
  Panel,
  SkeletonBlock,
  StatusText,
  Td,
  Th,
  WorkTable,
  type LocalTab,
} from "@/components/product";
import { Crumbs, DetailLayout, SummaryList, fmtDateTime } from "@/components/detail/parts";
import { ESTIMATE_STATE, EstimateState, LINE_STATUS, ageOf, money, photoUrls, printWorkOrder } from "@/components/recon/estimateParts";

// /recon/estimates/:id — one recon estimate. Decisions go through the same
// member RPCs as the board (role-gated and audited on the server); this page
// never approves anything on open.

type EstimateTab = "lines" | "photos" | "history";

interface ListingBits {
  id: string;
  mileage: number | null;
  photos?: unknown;
  hero_image_url?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const ownerOf = (v: string | null) => (v && !UUID.test(v) ? v : "Unassigned");

const ReconEstimateDetail = () => {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { estimates, isManager, loading, loadDetail, decide, postMessage, sendToService } = useReconEstimates();
  const sel = useMemo(() => estimates.find((e) => e.id === id) || null, [estimates, id]);
  const [detail, setDetail] = useState<{ lines: ReconLine[]; messages: ReconMessage[] } | null>(null);
  const [listing, setListing] = useState<ListingBits | null>(null);
  const [stock, setStock] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choice, setChoice] = useState<"approve" | "decline" | null>(null);
  const [comment, setComment] = useState("");
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => setDetail(await loadDetail(id)), [loadDetail, id]);
  useEffect(() => { if (id) void refresh(); }, [id, refresh, estimates]);

  useEffect(() => {
    if (!sel?.vin) return;
    let live = true;
    (async () => {
      try {
        const { data } = await (supabase as any).from("vehicle_listings").select("*").eq("vin", sel.vin).maybeSingle();
        if (live && data) {
          setListing(data as ListingBits);
          setStock(vehicleStockNumber(data) || null);
        }
      } catch {
        if (live) setListing(null);
      }
    })();
    return () => { live = false; };
  }, [sel?.vin]);

  if (loading && !sel) {
    return (
      <PageBody width="wide">
        <div role="status" aria-label="Loading estimate" className="flex flex-col gap-3">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-10 w-1/3" />
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </PageBody>
    );
  }

  if (!sel) {
    return (
      <PageBody width="form">
        <Crumbs items={[{ label: "Recon Approvals", to: "/recon" }, { label: "Not found" }]} />
        <EmptyState
          title="Estimate not found"
          detail="It may have been removed or belongs to another rooftop."
          action={<LinkButton to="/recon" variant="primary">Back to Recon Approvals</LinkButton>}
        />
      </PageBody>
    );
  }

  const lines = detail?.lines || [];
  const messages = detail?.messages || [];
  const pending = lines.filter((l) => l.approval_status === "pending");
  const decided = lines.filter((l) => l.decided_at);
  const lineCount = detail ? lines.length : null;
  const photos = lines.flatMap((l) => photoUrls(l.photos).map((u) => ({ url: u, line: l.description })));
  const tabParam = searchParams.get("tab");
  const tab: EstimateTab = tabParam === "photos" || tabParam === "history" ? tabParam : "lines";
  const base = `/recon/estimates/${encodeURIComponent(sel.id)}`;
  const tabs: LocalTab[] = [
    { key: "lines", label: "Line items", to: base, count: lineCount, active: tab === "lines" },
    { key: "photos", label: "Photos and documents", to: `${base}?tab=photos`, count: detail ? photos.length : null, active: tab === "photos" },
    { key: "history", label: "Approval history", to: `${base}?tab=history`, count: detail ? decided.length + messages.length : null, active: tab === "history" },
  ];

  const staged = sel.origin === "ingest" && !sel.sent_to_service_at;
  const canDecide = isManager && pending.length > 0 && !staged;
  const valid = choice !== null && (choice === "approve" || comment.trim().length > 0);
  const recId = `REC-${sel.id.slice(0, 8).toUpperCase()}`;
  const gallery = listing ? listingGallery(listing) : [];

  const decideLine = async (lineId: string, action: "approve" | "decline", r?: string) => {
    setBusy(lineId);
    const ok = await decide(sel.id, lineId, action, r);
    setBusy(null);
    setDeclineFor(null);
    setReason("");
    if (ok) await refresh();
    else toast.error("Could not record that decision.");
  };

  const submitDecision = async () => {
    if (!choice || !valid) return;
    setBusy("all");
    const ok = await decide(sel.id, null, choice, choice === "decline" ? comment.trim() : undefined);
    if (ok && choice === "approve" && comment.trim()) await postMessage(sel.id, comment.trim());
    setBusy(null);
    if (ok) {
      setChoice(null);
      setComment("");
      await refresh();
      toast.success(choice === "approve" ? "Remaining items approved" : "Remaining items declined");
    } else toast.error("Could not record that decision.");
  };

  const okAndSend = async () => {
    setBusy("send");
    if (pending.length) await decide(sel.id, null, "approve");
    const ok = await sendToService(sel.id);
    setBusy(null);
    if (ok) { await refresh(); toast.success("Sent to service"); } else toast.error("Could not send to service.");
  };

  const post = async () => {
    if (!msg.trim()) return;
    const ok = await postMessage(sel.id, msg.trim());
    if (ok) { setMsg(""); await refresh(); } else toast.error("Could not post.");
  };

  const linesTable = (
    <Panel flush>
      <WorkTable caption="Itemized labor, parts and sublet" minWidth={600}>
        <thead>
          <tr>
            <Th className="w-10">#</Th>
            <Th>Description</Th>
            <Th>Type</Th>
            <Th align="right">Labor</Th>
            <Th align="right">Parts</Th>
            <Th align="right">Sublet</Th>
            <Th align="right">Total</Th>
            <Th>Status</Th>
            <Th className="w-10"><span className="sr-only">Decide</span></Th>
          </tr>
        </thead>
        <tbody>
          {!detail && (
            <tr><Td className="text-adm-muted" align="left">Reading line items.</Td></tr>
          )}
          {lines.map((l, i) => {
            const st = LINE_STATUS[l.approval_status] || LINE_STATUS.pending;
            const canAct = isManager && l.approval_status === "pending" && !staged;
            return (
              <tr key={l.id}>
                <Td className="text-adm-muted tabular-nums">{i + 1}</Td>
                <Td className="min-w-[200px]">
                  <p className="font-semibold text-adm-ink">{l.description}</p>
                  {l.vendor && <p className="text-[12px] leading-[18px] text-adm-muted">{l.vendor}</p>}
                  {l.approval_status === "declined" && l.decline_reason && <p className="text-[12px] leading-[18px] text-adm-danger">Declined: {l.decline_reason}</p>}
                  {canAct && declineFor === l.id && (
                    <div className="mt-2 flex min-w-[220px] flex-col gap-2">
                      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for declining (required)" aria-label="Reason for declining" className="h-9 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="danger" disabled={!reason.trim() || busy === l.id} onClick={() => decideLine(l.id, "decline", reason.trim())}>Confirm decline</Button>
                        <Button size="sm" onClick={() => { setDeclineFor(null); setReason(""); }}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </Td>
                <Td className="capitalize whitespace-nowrap">{l.category || "Unknown"}</Td>
                <Td align="right">{money(l.labor_cost)}</Td>
                <Td align="right">{money(l.parts_cost)}</Td>
                <Td align="right">{money(l.sublet_cost)}</Td>
                <Td align="right" className="font-semibold">{money(l.line_total)}</Td>
                <Td><StatusText tone={st.tone}>{st.label}</StatusText></Td>
                <Td align="right">
                  {canAct && (
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`Decide on ${l.description}`} className="rounded-[6px] p-1 text-adm-muted hover:bg-adm-workspace">
                        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={busy === l.id} onSelect={() => decideLine(l.id, "approve")}>Approve this item</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDeclineFor(l.id)}>Decline this item</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </Td>
              </tr>
            );
          })}
          {detail && lines.length === 0 && (
            <tr><Td className="text-adm-muted">No line items are on this estimate.</Td></tr>
          )}
        </tbody>
      </WorkTable>
    </Panel>
  );

  const photosBody = (
    <Panel title="Photos and documents" titleSize="sm" inset="sm">
      {photos.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[4px] border border-adm-border bg-adm-workspace">
              <img src={p.url} alt={p.line} className="aspect-[4/3] w-full object-cover" />
              <span className="block truncate px-2 py-1 text-[12px] leading-[18px] text-adm-muted">{p.line}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-[14px] leading-[20px] text-adm-muted">No photos or documents are attached to the line items on this estimate.</p>
      )}
    </Panel>
  );

  const historyBody = (
    <div className="flex flex-col gap-6">
      <Panel title="Decisions" titleSize="sm" inset="sm">
        {decided.length ? (
          <ol className="divide-y divide-adm-border">
            {decided.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-4 py-2 text-[14px] leading-[20px]">
                <span className="min-w-0">
                  <span className="block text-adm-ink">{l.description}</span>
                  <span className="block text-[13px] text-adm-muted">{(LINE_STATUS[l.approval_status] || LINE_STATUS.pending).label} by {l.decided_by || "Unknown"}{l.decided_role ? `, ${l.decided_role}` : ""}</span>
                </span>
                <span className="text-adm-muted tabular-nums whitespace-nowrap">{fmtDateTime(l.decided_at)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] leading-[20px] text-adm-muted">No line item has been decided yet.</p>
        )}
      </Panel>
      <Panel title="Questions and notes" titleSize="sm" inset="sm">
        <div className="mb-3 flex max-h-72 flex-col gap-3 overflow-y-auto">
          {messages.length === 0 && <p className="text-[14px] leading-[20px] text-adm-muted">No messages yet. Ask service a question or leave a note.</p>}
          {messages.map((m) => (
            <div key={m.id} className="text-[14px] leading-[20px]">
              <span className="font-semibold text-adm-ink">{m.author_name || "Someone"}</span>
              {m.author_role && <span className="text-[12px] text-adm-muted"> | {m.author_role}</span>}
              <span className="text-[12px] text-adm-muted"> | {fmtDateTime(m.created_at)}</span>
              <p className="text-adm-ink">{m.body}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void post(); }} placeholder={isManager ? "Ask service about this recon" : "Reply or add a note"} aria-label="Message" className="h-10 flex-1 rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" />
          <Button variant="primary" disabled={!msg.trim()} onClick={post}>Send</Button>
        </div>
      </Panel>
    </div>
  );

  const reviewPanel = (
    <Panel title="Review estimate" titleSize="sm" inset="sm" id="review-estimate">
      {staged && isManager ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-[18px] text-adm-muted">This estimate came from intake and has not been released to service.</p>
          <Button variant="primary" disabled={busy === "send"} onClick={okAndSend}>{busy === "send" ? "Sending" : "Approve and send to service"}</Button>
        </div>
      ) : !isManager ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">Only a manager, admin or owner can decide on an estimate. You can still add a note under Approval history.</p>
      ) : pending.length === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">Every line item has a decision. Nothing is waiting on review.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex gap-5">
            <legend className="sr-only">Decision for the {pending.length} pending items</legend>
            {(["approve", "decline"] as const).map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink">
                <input type="radio" name="decision" checked={choice === c} onChange={() => setChoice(c)} className="h-4 w-4 accent-[var(--adm-primary,#1D4ED8)]" />
                {c === "approve" ? "Approve" : "Decline"}
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="sr-only">Comment</span>
            <textarea
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={choice === "decline" ? "Add a comment (required)" : "Add a comment (optional)"}
              className="w-full rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-[14px] leading-[20px] placeholder:text-adm-muted"
            />
            <span className="block text-right text-[12px] leading-[18px] text-adm-muted tabular-nums">{comment.length}/500</span>
          </label>
          <Button variant="primary" disabled={!valid || busy === "all"} onClick={submitDecision}>{busy === "all" ? "Submitting" : "Submit decision"}</Button>
          <p className="text-[12px] leading-[18px] text-adm-muted">Applies to the {pending.length} pending {pending.length === 1 ? "item" : "items"}. Items already decided are not changed.</p>
        </div>
      )}
    </Panel>
  );

  return (
    <PageBody width="wide">
      <Seo title={`Recon estimate ${recId}`} description="One recon estimate: line items, evidence, history and the review decision." path={`/recon/estimates/${sel.id}`} />
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            Recon Estimate {recId}
            <EstimateState status={sel.status} />
          </span>
        }
        actions={
          <>
            {listing && <LinkButton to={`/vehicle-file/${listing.id}`}>View vehicle</LinkButton>}
            {canDecide && <Button variant="primary" onClick={() => document.getElementById("review-estimate")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="More actions" className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace">
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!detail} onSelect={() => printWorkOrder(sel, lines)}>Print work order</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <section aria-label="Estimate identity" className="grid gap-x-6 gap-y-3 rounded-[6px] border border-adm-border bg-adm-surface p-4 lg:grid-cols-[168px_minmax(0,1fr)_minmax(0,1fr)_200px]">
        <div className="flex h-[112px] items-center justify-center overflow-hidden rounded-[4px] bg-adm-workspace">
          {gallery.length ? <img src={gallery[0]} alt={sel.ymm || "Vehicle"} className="h-full w-full object-cover" /> : <Car className="h-10 w-10 text-adm-muted" strokeWidth={1.25} aria-label="No photo on file" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[16px] leading-[22px] font-semibold text-adm-ink">{sel.ymm || "Vehicle"}</p>
          <SummaryList
            dense
            rows={[
              { label: "VIN", value: <span className="font-mono">{sel.vin}</span> },
              { label: "Stock", value: stock || "Unknown" },
              { label: "Mileage", value: listing?.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "Unknown" },
            ]}
          />
        </div>
        <SummaryList
          dense
          rows={[
            { label: "Owner", value: ownerOf(sel.submitted_by) },
            { label: "Created", value: fmtDateTime(sel.created_at) },
            { label: "Age", value: ageOf(sel.created_at) },
            ...(sel.notes ? [{ label: "Note", value: <span className="block max-w-[200px] truncate" title={sel.notes}>{sel.notes}</span> }] : []),
          ]}
        />
        <div className="border-t border-adm-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <p className="text-[12px] leading-[18px] text-adm-muted">Estimate total</p>
          <p className="text-[24px] leading-[32px] font-bold tabular-nums text-adm-ink">{money(sel.subtotal)}</p>
          <p className="mt-2 text-[12px] leading-[18px] text-adm-muted">Approved total</p>
          <p className="text-[16px] leading-[22px] font-semibold tabular-nums text-adm-ink">{sel.approved_total > 0 ? money(sel.approved_total) : "None yet"}</p>
          <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{ESTIMATE_STATE[sel.status]?.label || sel.status}{sel.sent_to_service_at ? ", sent to service" : ""}</p>
        </div>
      </section>

      <DetailLayout
        main={
          <>
            <LocalTabs tabs={tabs} label="Estimate sections" />
            {tab === "lines" && linesTable}
            {tab === "photos" && photosBody}
            {tab === "history" && historyBody}
          </>
        }
        aside={reviewPanel}
      />

    </PageBody>
  );
};

export default ReconEstimateDetail;
