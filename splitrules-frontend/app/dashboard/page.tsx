"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ConnectStripeButton from "../_components/connect-stripe-button";

type HealthState = "checking" | "ok" | "error";

type PeriodSummary = {
  amount: number; // major units (e.g. 12.34)
  count: number; // payment intents count
  currency: string; // "eur" | "usd"
};

type ProviderRow = {
  providerId: string;
  providerName?: string | null;
  currency: string;

  piTodayAmount: number;
  piTodayCount: number;

  piMtdAmount: number;
  piMtdCount: number;

  piYtdAmount: number;
  piYtdCount: number;
};

type RevenuePayload = {
  today: PeriodSummary;
  mtd: PeriodSummary;
  ytd: PeriodSummary;
  providers: ProviderRow[];
};

type ProvidersResponse =
  | { ok?: boolean; merchantId?: string; stripeAccountId?: string; providers?: unknown; [k: string]: any }
  | { error: string; [k: string]: any }
  | any;

// --- Backend base (Codespaces robust) ---
function deriveApiBase(): string {
  const env = (
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND ||
    ""
  ).trim();
  if (env) return env.replace(/\/+$/, "");

  if (typeof window === "undefined") return "http://localhost:4242";

  const u = new URL(window.location.href);
  if (u.hostname === "localhost") return "http://localhost:4242";

  const host = u.host;
  if (host.includes("-3000.")) return `${u.protocol}//${host.replace("-3000.", "-4242.")}`;
  if (host.endsWith(":3000")) return `${u.protocol}//${host.replace(":3000", ":4242")}`;

  return "http://localhost:4242";
}

function formatMoney(amount: number, currency: string) {
  const cur = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur}`;
  }
}

function getAbsoluteReturnTo(pathname: string) {
  if (typeof window === "undefined") return pathname;
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) return pathname;
  if (pathname.startsWith("/")) return `${window.location.origin}${pathname}`;
  return `${window.location.origin}/${pathname}`;
}

const LS_FLAG = "sr_stripe_connected";
const LS_ACCT = "sr_stripe_account_id";

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RevenuePayload | null>(null);

  const [connected, setConnected] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  const [apiBase, setApiBase] = useState<string>("");

  const API_PREFIX = (process.env.NEXT_PUBLIC_API_PREFIX || "/api").replace(/\/+$/, "");
  const api = useCallback(
    (path: string) => `${apiBase}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`,
    [apiBase, API_PREFIX]
  );

  const merchantId = "demo";
  const currency = "usd"; // keep simple for MVP; you can add toggle later

  useEffect(() => {
    setApiBase(deriveApiBase());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const flag = window.localStorage.getItem(LS_FLAG) === "1";
      const acct = window.localStorage.getItem(LS_ACCT) || "";
      if (flag) {
        setConnected(true);
        setConnectMsg(acct ? `Connected: ${acct}` : "Connected");
      }
    } catch {}
  }, []);

  const loadHealth = useCallback(async () => {
    if (!apiBase) return;
    setHealth("checking");
    try {
      const res = await fetch(api("/health"), { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      setHealth(res.ok && (j?.ok === true || j?.status === "ok") ? "ok" : "error");
    } catch {
      setHealth("error");
    }
  }, [apiBase, api]);

  const refreshStripeStatusFromBackend = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(api(`/providers?merchantId=${encodeURIComponent(merchantId)}`), {
        cache: "no-store",
      });
      const text = await res.text();
      let j: ProvidersResponse = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch {
        j = {};
      }

      const acct =
        j?.stripeAccountId || j?.merchant?.stripeAccountId || j?.data?.stripeAccountId || null;

      if (typeof acct === "string" && acct.startsWith("acct_")) {
        setConnected(true);
        setConnectMsg(`Connected: ${acct}`);
        try {
          window.localStorage.setItem(LS_FLAG, "1");
          window.localStorage.setItem(LS_ACCT, acct);
        } catch {}
      }
    } catch {
      // ignore
    }
  }, [apiBase, api, merchantId]);

  const loadRevenue = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    setError(null);

    try {
      const url = api(
        `/revenue/summary?merchantId=${encodeURIComponent(merchantId)}&currency=${encodeURIComponent(
          currency
        )}`
      );

      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Revenue summary failed: ${res.status}${txt ? ` — ${txt}` : ""}`);
      }

      const j = (await res.json()) as RevenuePayload;
      setData(j);
    } catch (e: any) {
      setData(null);
      setError(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [apiBase, api, merchantId, currency]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadHealth(), loadRevenue(), refreshStripeStatusFromBackend()]);
  }, [loadHealth, loadRevenue, refreshStripeStatusFromBackend]);

  useEffect(() => {
    if (!apiBase) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);

    const acct =
      url.searchParams.get("acct") ||
      url.searchParams.get("account_id") ||
      url.searchParams.get("stripe_account") ||
      url.searchParams.get("account") ||
      "";

    const connect =
      url.searchParams.get("connect") ||
      (url.searchParams.get("stripe_connected") === "1" ? "success" : null) ||
      (url.searchParams.get("connected") === "1" ? "success" : null);

    const msg = url.searchParams.get("msg") || url.searchParams.get("error") || "";

    if (connect !== "success" && connect !== "error") return;

    if (connect === "success") {
      setConnected(true);
      setConnectMsg(acct ? `Connected: ${acct}` : "Connected");
      try {
        window.localStorage.setItem(LS_FLAG, "1");
        if (acct) window.localStorage.setItem(LS_ACCT, acct);
      } catch {}
      refreshAll();
    } else {
      setConnected(false);
      setConnectMsg(msg ? decodeURIComponent(msg) : "Connect failed");
      try {
        window.localStorage.removeItem(LS_FLAG);
        window.localStorage.removeItem(LS_ACCT);
      } catch {}
    }

    const timeoutId = window.setTimeout(() => {
      try {
        const clean = new URL(window.location.href);
        [
          "connect",
          "acct",
          "account_id",
          "stripe_account",
          "account",
          "msg",
          "error",
          "stripe_connected",
          "connected",
        ].forEach((k) => clean.searchParams.delete(k));
        const qs = clean.searchParams.toString();
        window.history.replaceState({}, "", clean.pathname + (qs ? `?${qs}` : ""));
      } catch {}
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [refreshAll]);

  const providersSorted = useMemo(() => {
    const list = data?.providers ? [...data.providers] : [];
    list.sort((a, b) => (b.piYtdAmount ?? 0) - (a.piYtdAmount ?? 0));
    return list;
  }, [data]);

  const today = data?.today;
  const mtd = data?.mtd;
  const ytd = data?.ytd;

  const returnToAbs = useMemo(() => getAbsoluteReturnTo("/dashboard"), []);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.title}>SplitRules</div>
        <div style={styles.subtitle}>
          Dashboard: Revenue (Today / MTD / YTD) + Provider breakdown — Amount &amp; Count.
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Revenue Summary</div>
              <div style={styles.cardMeta}>
                API: <span style={styles.mono}>{apiBase || "…"}</span>{" "}
                <span style={{ ...styles.mono, opacity: 0.55 }}>
                  (prefix: {API_PREFIX || "(none)"})
                </span>
              </div>
            </div>

            <div style={styles.actionsStack}>
              {health === "ok" ? (
                <div style={{ ...styles.stackItem, ...styles.statusPill, ...styles.statusOk }}>
                  ✓ Backend reachable
                </div>
              ) : health === "error" ? (
                <div style={{ ...styles.stackItem, ...styles.statusPill, ...styles.statusBad }}>
                  Backend not reachable
                </div>
              ) : (
                <div style={{ ...styles.stackItem, ...styles.statusPill, ...styles.statusNeutral }}>
                  Checking…
                </div>
              )}

              {connected ? (
                <div
                  style={{ ...styles.stackItem, ...styles.statusPill, ...styles.statusOk }}
                  title={connectMsg || "Connected"}
                >
                  ✓ Stripe connected
                </div>
              ) : (
                <div style={{ ...styles.stackItem, ...styles.statusPill, ...styles.statusNeutral }}>
                  Stripe not connected
                </div>
              )}

              {!connected ? (
                <div style={styles.stackItem}>
                  <div style={styles.fullWidthWrap}>
                    <ConnectStripeButton merchantId={merchantId} returnTo={returnToAbs} />
                  </div>
                </div>
              ) : null}

              <button
                onClick={refreshAll}
                style={{ ...styles.stackItem, ...styles.button, ...styles.buttonSecondary }}
                disabled={loading}
                type="button"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {connectMsg ? (
            <div style={connected ? styles.okPill : styles.errorPill}>
              {connected ? "Connected" : "Connect error"}: {connectMsg}
            </div>
          ) : null}

          {error ? <div style={styles.errorPill}>Load failed: {error}</div> : null}

          <div style={styles.summaryGrid}>
            <SummaryBox
              label="Today"
              amount={today?.amount ?? 0}
              count={today?.count ?? 0}
              currency={(today?.currency ?? currency).toLowerCase()}
            />
            <SummaryBox
              label="Month to date"
              amount={mtd?.amount ?? 0}
              count={mtd?.count ?? 0}
              currency={(mtd?.currency ?? currency).toLowerCase()}
            />
            <SummaryBox
              label="Year to date"
              amount={ytd?.amount ?? 0}
              count={ytd?.count ?? 0}
              currency={(ytd?.currency ?? currency).toLowerCase()}
            />
          </div>

          <div style={styles.sectionTitle}>Provider Breakdown</div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, ...styles.thLeft }}>Provider</th>
                  <th style={{ ...styles.th, ...styles.thRight }}>Today</th>
                  <th style={{ ...styles.th, ...styles.thRight }}>MTD</th>
                  <th style={{ ...styles.th, ...styles.thRight }}>YTD</th>
                  <th style={{ ...styles.th, ...styles.thLeft }}>Provider ID</th>
                </tr>
              </thead>
              <tbody>
                {providersSorted.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={5}>
                      No providers / no data yet.
                    </td>
                  </tr>
                ) : (
                  providersSorted.map((p) => (
                    <tr key={p.providerId}>
                      <td style={{ ...styles.td, ...styles.tdLeft }}>
                        <div style={{ fontWeight: 800 }}>{p.providerName || "Provider"}</div>
                        <div style={{ opacity: 0.55, fontSize: 12 }}>
                          Currency: {(p.currency || currency).toUpperCase()}
                        </div>
                      </td>

                      <td style={{ ...styles.td, ...styles.tdRight }}>
                        <div style={{ fontWeight: 900 }}>
                          {formatMoney(p.piTodayAmount || 0, p.currency || currency)}
                        </div>
                        <div style={{ opacity: 0.55, fontSize: 12 }}>{p.piTodayCount || 0} intents</div>
                      </td>

                      <td style={{ ...styles.td, ...styles.tdRight }}>
                        <div style={{ fontWeight: 900 }}>
                          {formatMoney(p.piMtdAmount || 0, p.currency || currency)}
                        </div>
                        <div style={{ opacity: 0.55, fontSize: 12 }}>{p.piMtdCount || 0} intents</div>
                      </td>

                      <td style={{ ...styles.td, ...styles.tdRight }}>
                        <div style={{ fontWeight: 900 }}>
                          {formatMoney(p.piYtdAmount || 0, p.currency || currency)}
                        </div>
                        <div style={{ opacity: 0.55, fontSize: 12 }}>{p.piYtdCount || 0} intents</div>
                      </td>

                      <td style={{ ...styles.td, ...styles.tdLeft }}>
                        <span style={styles.monoSmall}>{p.providerId}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={styles.footerLine}>
            Backend status:{" "}
            <b>{health === "checking" ? "checking…" : health === "ok" ? "connected" : "not reachable"}</b>
          </div>

          <div style={styles.note}>
            Revenue totals = PaymentIntents (gross). Provider breakdown is based on metadata attribution.
          </div>
        </div>

        <div style={styles.copyright}>SplitRules © 2026</div>
      </div>
    </div>
  );
}

function SummaryBox(props: { label: string; amount: number; count: number; currency: string }) {
  return (
    <div style={styles.summaryBox}>
      <div style={styles.summaryLabel}>{props.label}</div>
      <div style={styles.summaryAmount}>{formatMoney(props.amount, props.currency)}</div>
      <div style={styles.summarySub}>{props.count} Payment Intents</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 24, display: "flex", justifyContent: "center" },
  shell: { width: "min(980px, 100%)" },
  title: { fontSize: 44, fontWeight: 900, letterSpacing: -0.6, marginBottom: 6 },
  subtitle: { opacity: 0.65, marginBottom: 18 },

  card: {
    borderRadius: 18,
    background: "rgba(255,255,255,0.55)",
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
    padding: 18,
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: 900 },
  cardMeta: { marginTop: 4, fontSize: 12, opacity: 0.65 },

  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  monoSmall: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    opacity: 0.7,
  },

  actionsStack: { display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch", width: 220 },

  stackItem: {
    width: "100%",
    height: 38,
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  fullWidthWrap: { width: "100%", display: "block" },

  statusPill: { border: "1px solid rgba(0,0,0,0.10)", background: "rgba(255,255,255,0.65)" },
  statusOk: {
    border: "1px solid rgba(30, 160, 90, 0.35)",
    background: "rgba(30, 160, 90, 0.12)",
    color: "rgba(10, 90, 40, 0.95)",
  },
  statusBad: {
    border: "1px solid rgba(220, 80, 80, 0.22)",
    background: "rgba(220, 80, 80, 0.14)",
    color: "rgba(120, 20, 20, 0.9)",
  },
  statusNeutral: { color: "rgba(0,0,0,0.65)" },

  button: { border: "1px solid rgba(0,0,0,0.10)", background: "rgba(255,255,255,0.65)", cursor: "pointer" },
  buttonSecondary: { opacity: 0.95 },

  okPill: {
    display: "inline-block",
    background: "rgba(30, 160, 90, 0.12)",
    border: "1px solid rgba(30, 160, 90, 0.20)",
    color: "rgba(10, 90, 40, 0.95)",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    marginBottom: 12,
    fontWeight: 800,
  },
  errorPill: {
    display: "inline-block",
    background: "rgba(220, 80, 80, 0.14)",
    border: "1px solid rgba(220, 80, 80, 0.22)",
    color: "rgba(120, 20, 20, 0.9)",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    marginBottom: 12,
    fontWeight: 800,
  },

  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  summaryBox: { borderRadius: 14, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(0,0,0,0.06)", padding: 14 },
  summaryLabel: { fontSize: 12, opacity: 0.65, marginBottom: 6, fontWeight: 800 },
  summaryAmount: { fontSize: 26, fontWeight: 950, letterSpacing: -0.4 },
  summarySub: { marginTop: 4, fontSize: 12, opacity: 0.6, fontWeight: 800 },

  sectionTitle: { fontSize: 16, fontWeight: 950, marginTop: 4, marginBottom: 10 },

  tableWrap: { borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.45)" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 12,
    letterSpacing: 0.2,
    opacity: 0.7,
    padding: "12px 12px",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    background: "rgba(255,255,255,0.35)",
    fontWeight: 900,
  },
  thLeft: { textAlign: "left" },
  thRight: { textAlign: "right" },
  td: { padding: "12px 12px", borderBottom: "1px solid rgba(0,0,0,0.05)", fontSize: 13, fontWeight: 700 },
  tdLeft: { textAlign: "left" },
  tdRight: { textAlign: "right", whiteSpace: "nowrap" },

  footerLine: { marginTop: 10, fontSize: 12, opacity: 0.7 },
  note: { marginTop: 8, fontSize: 11, opacity: 0.55, textAlign: "center" },
  copyright: { marginTop: 14, fontSize: 11, opacity: 0.55, textAlign: "center", fontWeight: 700 },
};