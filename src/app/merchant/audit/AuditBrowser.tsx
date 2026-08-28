"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type AuditEvent = {
  id: string;
  eventType: string;
  transactionId: string | null;
  cartId: string | null;
  requestId: string | null;
  timestamp: string;
  fromState: string | null;
  toState: string | null;
  cartHash: string | null;
  policyPassed: number | null;
  policyTotal: number | null;
  isSimulated: boolean;
  verificationSource: string | null;
};

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", { hour12: false });
  } catch {
    return iso;
  }
}

export function AuditBrowser() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTxn = searchParams.get("transactionId") ?? "";
  const initialCart = searchParams.get("cartId") ?? "";

  const [transactionId, setTransactionId] = React.useState(initialTxn);
  const [cartId, setCartId] = React.useState(initialCart);
  const [events, setEvents] = React.useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchEvents = React.useCallback(async (txn?: string, cart?: string) => {
    const t = (txn ?? transactionId).trim();
    const c = (cart ?? cartId).trim();
    if (!t && !c) {
      setError("Enter transactionId or cartId");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (t) params.set("transactionId", t);
      else if (c) params.set("cartId", c);
      const res = await fetch(`/api/audit?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to fetch audit");
        setEvents([]);
        return;
      }
      setEvents(body.events ?? []);
      // Update URL for shareable link
      const next = new URLSearchParams();
      if (t) next.set("transactionId", t);
      if (!t && c) next.set("cartId", c);
      router.replace(`/merchant/audit?${next.toString()}`, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [transactionId, cartId, router]);

  React.useEffect(() => {
    if (initialTxn || initialCart) {
      // Defer to next microtask to avoid synchronous setState in effect
      const handle = setTimeout(() => {
        void fetchEvents(initialTxn, initialCart);
      }, 0);
      return () => clearTimeout(handle);
    }
  }, [fetchEvents, initialTxn, initialCart]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Lookup audit</CardTitle>
          <CardDescription>GET /api/audit?transactionId=&lt;id&gt; or ?cartId=&lt;id&gt; — deterministic timestamp asc + id asc</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Transaction ID</label>
              <Input placeholder="txn_... or cuid" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchEvents()} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Cart ID</label>
              <Input placeholder="cart_... or cuid" value={cartId} onChange={(e) => setCartId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchEvents()} />
            </div>
            <Button onClick={() => fetchEvents()} loading={loading} disabled={loading}>
              Fetch
            </Button>
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Either transactionId or cartId required. Unknown id returns empty (200) per API convention. No secrets exposed.</p>
          {error ? <p className="text-[12px] text-[#e11d48]">{error}</p> : null}
        </CardContent>
      </Card>

      {events !== null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px] flex items-center gap-2">
              Timeline <Badge variant="neutral">{events.length} events</Badge>
              {loading ? <span className="text-[11px] text-[var(--muted-foreground)]">loading…</span> : null}
            </CardTitle>
            <CardDescription className="break-all">
              Ordered by timestamp asc, id asc — deterministic. Fields: eventType, timestamp, fromState→toState, requestId, cartHash, policyPassed/policyTotal, verificationSource, isSimulated.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {events.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-[var(--muted-foreground)]">No events for this id — create a cart → approve → checkout → verify to generate audit, or check id.</div>
            ) : (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Sim</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-[11px] font-mono whitespace-nowrap">{formatTs(e.timestamp)}</TableCell>
                      <TableCell className="font-medium text-[12px] font-mono">{e.eventType}</TableCell>
                      <TableCell className="text-[11px] font-mono">
                        {e.fromState ?? "—"} → {e.toState ?? "—"}
                        {e.cartHash ? <div className="text-[10px] text-[var(--muted-foreground)]">hash {e.cartHash.slice(0, 8)}</div> : null}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono break-all max-w-[140px]">{e.requestId?.slice(0, 12) ?? "—"}</TableCell>
                      <TableCell className="text-[11px]">{e.policyPassed !== null && e.policyTotal !== null ? `${e.policyPassed}/${e.policyTotal}` : "—"}</TableCell>
                      <TableCell className="text-[11px] font-mono break-all max-w-[160px]">{e.verificationSource ?? "—"}</TableCell>
                      <TableCell><Badge variant={e.isSimulated ? "warning" : "neutral"}>{e.isSimulated ? "sim" : "live"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[13px]">What is audited</CardTitle>
        </CardHeader>
        <CardContent className="text-[12px] leading-5 text-[var(--muted-foreground)]">
          Every approval, policy check, order creation, payment verification, webhook (verified/rejected/unknown/idempotent) is logged via <span className="font-mono bg-[#f3f4f6] px-1 rounded">AuditService.log</span> with deterministic ordering. Merchant orders/payments link here via <span className="font-mono">?transactionId=</span>.
        </CardContent>
      </Card>
    </div>
  );
}
