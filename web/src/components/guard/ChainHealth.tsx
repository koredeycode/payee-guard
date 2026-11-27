"use client";

import { useEffect, useState } from "react";
import { aevumTestnet } from "@aevum-kit/aevum";

type Health = "checking" | "online" | "offline" | "mismatch";

const labels: Record<Health, string> = {
  checking: `Chain ${aevumTestnet.id} · checking`,
  online: `Chain ${aevumTestnet.id} · reachable`,
  offline: `Chain ${aevumTestnet.id} · unreachable, showing fixtures`,
  mismatch: `Chain ${aevumTestnet.id} · RPC answered on a different chain`,
};

/** One read of eth_chainId. No polling, no wallet, and a quiet fallback when RPC is down. */
export function ChainHealth() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(aevumTestnet.rpcUrls.default.http[0], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("rpc status");
        return response.json();
      })
      .then((data: { result?: string }) => {
        const chainId = Number.parseInt(data.result ?? "", 16);
        setHealth(chainId === aevumTestnet.id ? "online" : "mismatch");
      })
      .catch(() => setHealth("offline"))
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`health-banner ${health}`} role="status" aria-label={labels[health]}>
      <span className={`dot ${health === "online" ? "" : health === "checking" ? "idle" : "bad"}`} aria-hidden="true" />
      <span>{labels[health]}</span>
      <span className="health-detail">
        {health === "online" ? aevumTestnet.rpcUrls.default.http[0] : "Fixtures stay readable without a live RPC"}
      </span>
    </div>
  );
}
