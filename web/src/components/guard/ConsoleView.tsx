"use client";

import { useState, type FormEvent } from "react";
import { keccak256, parseUnits, stringToHex, isAddress, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { AlertTriangle, Check, CircleAlert, Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import { iconProps } from "@/components/Icons";
import { demoSessions, knownPayees, pendingIntents, type DemoSession, type PendingIntent } from "@/data/scenarios";
import { explain } from "@/lib/errors";
import { GUARD_CHAIN_ID, guardAddress, guardDemoMode, payeeGuardAbi, TUSD8_DECIMALS } from "@/lib/guard";
import { reasonCodes, reasonExplanations } from "@/lib/reasonCodes";
import { skeleton } from "@/lib/confusables";
import { short } from "@/lib/order";

type Tone = "info" | "good" | "bad";

interface Notice {
  tone: Tone;
  text: string;
}

const noticeIcons = { info: CircleAlert, good: Check, bad: X };

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function ConsoleView() {
  const { address, chainId, isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const { data: pausedOnChain } = useReadContract({
    address: guardAddress,
    abi: payeeGuardAbi,
    functionName: "paused",
    chainId: GUARD_CHAIN_ID,
    query: { enabled: Boolean(guardAddress) },
  });

  const [notice, setNotice] = useState<Notice | null>(null);
  const [payeeName, setPayeeName] = useState("");
  const [payeeAddress, setPayeeAddress] = useState("");
  const [payeeDomain, setPayeeDomain] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [allowlisted, setAllowlisted] = useState<string[]>([]);
  const [agentId, setAgentId] = useState("");
  const [agentWallet, setAgentWallet] = useState("");
  const [perPaymentCap, setPerPaymentCap] = useState("1.00");
  const [totalCap, setTotalCap] = useState("12.00");
  const [expiryDays, setExpiryDays] = useState("30");
  const [sessions, setSessions] = useState<DemoSession[]>(demoSessions);
  const [intents, setIntents] = useState<PendingIntent[]>(pendingIntents);
  const [pausedLocal, setPausedLocal] = useState(false);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.50");

  const paused = guardDemoMode ? pausedLocal : Boolean(pausedOnChain);
  const nameHash = payeeName.trim() ? keccak256(stringToHex(payeeName.trim())) : null;
  const metadataHash = payeeName.trim()
    ? keccak256(stringToHex(`${payeeName.trim()}|${payeeAddress.trim()}|${payeeDomain.trim()}`))
    : null;
  const folded = skeleton(payeeName);
  const lookalikes = folded
    ? knownPayees.filter((known) => known !== payeeName.trim() && editDistance(folded, skeleton(known)) <= 1)
    : [];
  const needsConfirmation = lookalikes.length > 0;
  const confirmed = confirmation.trim().toLowerCase() === "confirm lookalike";

  function say(tone: Tone, text: string) {
    setNotice({ tone, text });
  }

  function ready(): boolean {
    if (guardDemoMode) return true;
    if (!isConnected) {
      say("bad", "Connect the owner wallet before sending a transaction.");
      return false;
    }
    if (chainId !== GUARD_CHAIN_ID) {
      say("bad", "Switch the wallet to chain 44005 before sending a transaction.");
      return false;
    }
    return true;
  }

  async function send(label: string, fn: () => Promise<unknown>) {
    if (!ready()) return;
    if (guardDemoMode) {
      say("info", `Demo only — ${label} was recorded locally. Nothing was sent on-chain.`);
      return;
    }
    try {
      const hash = await fn();
      say("good", `${label} submitted. Transaction ${short(String(hash), 10, 8)}.`);
    } catch (error) {
      say("bad", explain(error));
    }
  }

  function submitAllowlist(event: FormEvent) {
    event.preventDefault();
    if (!payeeName.trim() || !isAddress(payeeAddress.trim()) || !nameHash || !metadataHash) {
      say("bad", "Enter a name, a valid payee address and a domain.");
      return;
    }
    if (needsConfirmation && !confirmed) {
      say("bad", "Type Confirm lookalike to allow an allowlist write for a confusable name.");
      return;
    }
    setAllowlisted((current) => [...current, payeeName.trim()]);
    void send(
      `Payee ${payeeName.trim()} allowlisted`,
      () =>
        writeContractAsync({
          address: guardAddress!,
          abi: payeeGuardAbi,
          functionName: "allowlistPayee",
          args: [payeeName.trim(), payeeAddress.trim() as Address, payeeDomain.trim(), nameHash, metadataHash],
        }),
    );
    if (guardDemoMode) setConfirmation("");
  }

  function submitSession(action: "create" | "rotate" | "revoke") {
    if (!agentId.trim()) {
      say("bad", "Enter an agent id first.");
      return;
    }
    if (action === "create" && !isAddress(agentWallet.trim())) {
      say("bad", "Enter a valid session wallet address.");
      return;
    }
    if (action !== "revoke" && !isAddress(agentWallet.trim())) {
      say("bad", "Enter a valid replacement wallet address.");
      return;
    }

    let caps: [bigint, bigint, bigint] | null = null;
    if (action === "create") {
      try {
        const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Number(expiryDays) || 30) * 86400);
        caps = [parseUnits(perPaymentCap, TUSD8_DECIMALS), parseUnits(totalCap, TUSD8_DECIMALS), expiresAt];
      } catch {
        say("bad", "Caps must be amounts with at most six decimal places.");
        return;
      }
    }

    if (guardDemoMode) {
      setSessions((current) => {
        if (action === "revoke") return current.map((item) => (item.agentId === agentId.trim() ? { ...item, status: "revoked" } : item));
        if (action === "rotate") return current.map((item) => (item.agentId === agentId.trim() ? { ...item, wallet: short(agentWallet.trim(), 6, 4) } : item));
        return [
          ...current.filter((item) => item.agentId !== agentId.trim()),
          {
            agentId: agentId.trim(),
            wallet: short(agentWallet.trim(), 6, 4),
            perPaymentCap,
            totalCap,
            spent: "0.00",
            status: "active",
          },
        ];
      });
    }

    const label = action === "create" ? `Session ${agentId.trim()} created` : action === "rotate" ? `Session ${agentId.trim()} rotated` : `Session ${agentId.trim()} revoked`;
    void send(
      label,
      async () => {
        if (action === "create" && caps) {
          return writeContractAsync({
            address: guardAddress!,
            abi: payeeGuardAbi,
            functionName: "createSession",
            args: [agentId.trim(), agentWallet.trim() as Address, caps[0], caps[1], caps[2]],
          });
        }
        if (action === "rotate") {
          return writeContractAsync({
            address: guardAddress!,
            abi: payeeGuardAbi,
            functionName: "rotateSession",
            args: [agentId.trim(), agentWallet.trim() as Address],
          });
        }
        return writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: "revokeSession", args: [agentId.trim()] });
      },
    );
  }

  function decideIntent(intent: PendingIntent, approve: boolean) {
    if (guardDemoMode) setIntents((current) => current.filter((item) => item.id !== intent.id));
    void send(
      approve ? `Intent ${short(intent.id, 8, 6)} approved` : `Intent ${short(intent.id, 8, 6)} cancelled`,
      () =>
        writeContractAsync({
          address: guardAddress!,
          abi: payeeGuardAbi,
          functionName: approve ? "approveIntent" : "cancelIntent",
          args: [intent.id as Hex],
        }),
    );
  }

  function togglePause() {
    if (!guardDemoMode) setPausedLocal(!pausedLocal);
    void send(
      paused ? "Payments resumed" : "Payments paused",
      () => writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: "setPaused", args: [!paused] }),
    );
  }

  function submitWithdraw(event: FormEvent) {
    event.preventDefault();
    if (!isAddress(withdrawTo.trim())) {
      say("bad", "Enter a valid destination address.");
      return;
    }
    let amount: bigint;
    try {
      amount = parseUnits(withdrawAmount, TUSD8_DECIMALS);
    } catch {
      say("bad", "Enter an amount with at most six decimal places.");
      return;
    }
    void send(
      `Withdrawal of ${withdrawAmount} tUSD8 submitted`,
      () => writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: "withdraw", args: [withdrawTo.trim() as Address, amount] }),
    );
  }

  const NoticeIcon = notice ? noticeIcons[notice.tone] : CircleAlert;

  return (
    <main className="shell guard-page">
      <header className="guard-head">
        <div>
          <p className="kicker">Owner actions</p>
          <h1>Owner console</h1>
          <p className="lede">
            Verify a payee, bound an agent session and decide what a payment intent is allowed to do. Every reason code below is written in plain language.
          </p>
        </div>
        <p className="mode-note">
          <span className={`dot ${guardDemoMode ? "idle" : ""}`} aria-hidden="true" />
          {guardDemoMode ? "Demo mode · no contract address configured" : `Live mode · ${short(guardAddress!, 8, 6)} · chain ${GUARD_CHAIN_ID}`}
        </p>
      </header>

      {guardDemoMode && (
        <div className="demo-disclaimer" role="note">
          <AlertTriangle {...iconProps} />
          <span>
            No contract address is set. Forms update local lists only. Set <code>NEXT_PUBLIC_PAYEE_GUARD_AEVUM</code> and connect the owner wallet to send writes.
          </span>
        </div>
      )}

      {notice && (
        <div className={`console-notice ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          <NoticeIcon {...iconProps} />
          <span>{notice.text}</span>
        </div>
      )}

      <div className="console-grid">
        <div className="console-column">
          <section className="card form-card" aria-labelledby="allowlist-heading">
            <h2 id="allowlist-heading">Allowlist a payee</h2>
            <p className="card-sub">The owner verifies the name once. The contract keeps the two hashes, not the name itself.</p>
            <form onSubmit={submitAllowlist} className="form-stack">
              <div className="field">
                <label htmlFor="payee-name">Registered name</label>
                <input id="payee-name" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Northwind Freight Ltd" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="payee-address">Payee wallet</label>
                <input id="payee-address" className="mono" value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor="payee-domain">Invoice domain</label>
                <input id="payee-domain" value={payeeDomain} onChange={(event) => setPayeeDomain(event.target.value)} placeholder="northwindfreight.example" autoComplete="off" />
              </div>

              <dl className="hash-readout">
                <div>
                  <dt>nameHash</dt>
                  <dd>{nameHash ? <code>{nameHash}</code> : <span className="empty-value">Enter a name to compute</span>}</dd>
                </div>
                <div>
                  <dt>metadataHash</dt>
                  <dd>{metadataHash ? <code>{metadataHash}</code> : <span className="empty-value">Enter a name to compute</span>}</dd>
                </div>
              </dl>

              {needsConfirmation && (
                <div className="lookalike-warning" role="alert">
                  <AlertTriangle {...iconProps} />
                  <div>
                    <p className="warning-title">Confusable with an allowlisted payee</p>
                    <p className="warning-detail">
                      {lookalikes.join(", ")} has the same folded skeleton as this name. Type <strong>Confirm lookalike</strong> before adding it.
                    </p>
                    <div className="field">
                      <label htmlFor="confirm-lookalike">Typed confirmation</label>
                      <input
                        id="confirm-lookalike"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        placeholder="Confirm lookalike"
                        autoComplete="off"
                        aria-describedby="confirm-help"
                      />
                      <p id="confirm-help" className="field-help">
                        Required when a name folds to an existing payee
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="btn" disabled={isPending || (needsConfirmation && !confirmed)}>
                  Add to allowlist
                </button>
                {allowlisted.length > 0 && <span className="quiet-meta">{allowlisted.length} added this session</span>}
              </div>
            </form>
          </section>

          <section className="card form-card" aria-labelledby="session-heading">
            <h2 id="session-heading">Agent sessions</h2>
            <p className="card-sub">A session gives one agent a wallet, a per-payment cap and a total cap.</p>
            <div className="form-stack">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="agent-id">Agent id</label>
                  <input id="agent-id" className="mono" value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="agent-invoices-01" autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="agent-wallet">Session wallet</label>
                  <input id="agent-wallet" className="mono" value={agentWallet} onChange={(event) => setAgentWallet(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
                </div>
              </div>
              <div className="form-row three">
                <div className="field">
                  <label htmlFor="per-cap">Per payment, tUSD8</label>
                  <input id="per-cap" className="num" inputMode="decimal" value={perPaymentCap} onChange={(event) => setPerPaymentCap(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="total-cap">Total cap, tUSD8</label>
                  <input id="total-cap" className="num" inputMode="decimal" value={totalCap} onChange={(event) => setTotalCap(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="expiry">Expires in days</label>
                  <input id="expiry" className="num" inputMode="numeric" value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" disabled={isPending} onClick={() => submitSession("create")}>
                  Create session
                </button>
                <button type="button" className="btn secondary" disabled={isPending} onClick={() => submitSession("rotate")}>
                  <RotateCw {...iconProps} /> Rotate wallet
                </button>
                <button type="button" className="btn ghost danger" disabled={isPending} onClick={() => submitSession("revoke")}>
                  <X {...iconProps} /> Revoke session
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="console-column">
          <section className="card form-card" aria-labelledby="intents-heading">
            <h2 id="intents-heading">Intents awaiting a decision</h2>
            <p className="card-sub">A blocked intent stays visible until an owner approves or cancels it.</p>
            {intents.length === 0 ? (
              <p className="empty">No intents are waiting.</p>
            ) : (
              <ul className="intent-list">
                {intents.map((intent) => (
                  <li className="intent-row" key={intent.id}>
                    <div className="intent-body">
                      <span className="intent-title">{intent.payee}</span>
                      <span className="intent-meta">
                        <code>{intent.reasonCode}</code> · {intent.agentId} · <span className="num">{intent.amount} tUSD8</span>
                      </span>
                      <span className="intent-meta">{reasonExplanations[intent.reasonCode]}</span>
                    </div>
                    <div className="intent-actions">
                      <button type="button" className="btn small" disabled={isPending} onClick={() => decideIntent(intent, true)}>
                        Approve
                      </button>
                      <button type="button" className="btn small secondary" disabled={isPending} onClick={() => decideIntent(intent, false)}>
                        Cancel
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card form-card" aria-labelledby="controls-heading">
            <h2 id="controls-heading">Owner controls</h2>
            <p className="card-sub">Pause stops every agent at once. Withdraw moves committed funds back to the owner.</p>
            <div className="control-row">
              <div>
                <span className="control-label">Payments</span>
                <span className={`control-state ${paused ? "paused" : "active"}`}>
                  <span className={`dot ${paused ? "bad" : ""}`} aria-hidden="true" /> {paused ? "Paused" : "Running"}
                </span>
              </div>
              <button type="button" className="btn secondary" disabled={isPending} onClick={togglePause}>
                {paused ? <Play {...iconProps} /> : <Pause {...iconProps} />} {paused ? "Resume payments" : "Pause payments"}
              </button>
            </div>
            <form onSubmit={submitWithdraw} className="form-stack">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="withdraw-to">Destination</label>
                  <input id="withdraw-to" className="mono" value={withdrawTo} onChange={(event) => setWithdrawTo(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
                </div>
                <div className="field">
                  <label htmlFor="withdraw-amount">Amount, tUSD8</label>
                  <input id="withdraw-amount" className="num" inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn ghost danger" disabled={isPending}>
                  <Trash2 {...iconProps} /> Withdraw
                </button>
              </div>
            </form>
          </section>

          <section className="card" aria-labelledby="sessions-heading">
            <h2 id="sessions-heading">Sessions on file</h2>
            <ul className="session-list">
              {sessions.map((session) => (
                <li className="session-row" key={session.agentId}>
                  <code className="session-id">{session.agentId}</code>
                  <span className="session-wallet mono">{session.wallet}</span>
                  <span className="session-cap num">{session.spent} / {session.totalCap}</span>
                  <span className={`session-state ${session.status}`}>
                    <span className={`dot ${session.status === "revoked" ? "bad" : ""}`} aria-hidden="true" /> {session.status === "revoked" ? "Revoked" : "Active"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="card reason-table" aria-labelledby="reasons-heading">
        <h2 id="reasons-heading">Reason codes in plain language</h2>
        <dl>
          {reasonCodes.map((code) => (
            <div key={code}>
              <dt><code>{code}</code></dt>
              <dd>{reasonExplanations[code]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
