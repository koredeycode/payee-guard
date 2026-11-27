"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { encodeAbiParameters, isAddress, keccak256, parseAbiParameters, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { AlertTriangle, Check, CircleAlert, Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import { iconProps } from "@/components/Icons";
import { demoSessions, knownPayees, pendingIntents, type DemoSession, type PendingIntent } from "@/data/scenarios";
import { explain } from "@/lib/errors";
import { GUARD_CHAIN_ID, guardAddress, guardDemoMode, payeeGuardAbi, TUSD8_DECIMALS } from "@/lib/guard";
import { metadataHash as computeMetadataHash, nameHash as computeNameHash, type MetadataRecord } from "@/lib/hashes";
import { reasonCodes, reasonExplanations } from "@/lib/reasonCodes";
import { skeleton } from "@/lib/confusables";
import { short } from "@/lib/order";

type Tone = "info" | "good" | "bad";
type SessionAction = "create" | "recreate" | "revoke";

interface Notice {
  tone: Tone;
  text: string;
}

const noticeIcons = { info: CircleAlert, good: Check, bad: X };

const DEFAULT_METADATA = `{
  "type": "agent",
  "name": "Northwind Freight Ltd",
  "active": true,
  "services": [{ "type": "payee", "id": "northwind-freight" }],
  "registrations": [{ "agentId": "1", "chainId": 44005 }]
}`;

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

function toUnixSeconds(value: string): bigint | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : null;
}

export function ConsoleView() {
  const { chainId, isConnected } = useAccount();
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
  const [agentId, setAgentId] = useState("1");
  const [payeeAddress, setPayeeAddress] = useState("");
  const [metadataJson, setMetadataJson] = useState(DEFAULT_METADATA);
  const [confirmation, setConfirmation] = useState("");
  const [allowlisted, setAllowlisted] = useState<string[]>([]);
  const [operator, setOperator] = useState("");
  const [maxPerPayment, setMaxPerPayment] = useState("1.00");
  const [maxCumulative, setMaxCumulative] = useState("12.00");
  const [autoApproveLimit, setAutoApproveLimit] = useState("0.25");
  const [validAfter, setValidAfter] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [sessions, setSessions] = useState<DemoSession[]>(demoSessions);
  const [intents, setIntents] = useState<PendingIntent[]>(pendingIntents);
  const [pausedLocal, setPausedLocal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("10.00");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.50");

  // Start and end of a demo session window, set after mount so the server and client agree.
  useEffect(() => {
    const asInput = (date: Date) => date.toISOString().slice(0, 16);
    const now = new Date();
    setValidAfter(asInput(now));
    setExpiresAt(asInput(new Date(now.getTime() + 30 * 86400000)));
  }, []);

  const agentIdBig = useMemo(() => (/^\d+$/.test(agentId.trim()) ? BigInt(agentId.trim()) : null), [agentId]);
  const payeeWallet = useMemo(
    () => (isAddress(payeeAddress.trim()) ? (payeeAddress.trim() as Address) : null),
    [payeeAddress],
  );
  const operatorAddress = useMemo(
    () => (isAddress(operator.trim()) ? (operator.trim() as Address) : null),
    [operator],
  );
  const withdrawAddress = useMemo(
    () => (isAddress(withdrawTo.trim()) ? (withdrawTo.trim() as Address) : null),
    [withdrawTo],
  );

  const paused = guardDemoMode ? pausedLocal : Boolean(pausedOnChain);
  const allowlistNameHash = payeeName.trim() ? computeNameHash(payeeName) : null;
  const parsedMetadata = useMemo<MetadataRecord | null>(() => {
    try {
      const value: unknown = JSON.parse(metadataJson);
      return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as MetadataRecord) : null;
    } catch {
      return null;
    }
  }, [metadataJson]);
  const allowlistMetadataHash = parsedMetadata ? computeMetadataHash(parsedMetadata) : null;

  // sessionKey(agentId, operator) is keccak256(abi.encode(agentId, operator)). When a contract
  // address is configured, prefer the on-chain view over the local calculation.
  const localSessionKey = useMemo(
    () =>
      agentIdBig && operatorAddress
        ? keccak256(encodeAbiParameters(parseAbiParameters("uint256, address"), [agentIdBig, operatorAddress]))
        : null,
    [agentIdBig, operatorAddress],
  );
  const { data: sessionKeyOnChain } = useReadContract({
    address: guardAddress,
    abi: payeeGuardAbi,
    functionName: "sessionKey",
    args: agentIdBig && operatorAddress ? [agentIdBig, operatorAddress] : undefined,
    chainId: GUARD_CHAIN_ID,
    query: { enabled: Boolean(guardAddress) && Boolean(agentIdBig && operatorAddress) },
  });
  const sessionKey = sessionKeyOnChain ?? localSessionKey;

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
    if (!agentIdBig || !payeeWallet || !allowlistNameHash || !allowlistMetadataHash) {
      say("bad", "Enter a numeric agent id, a valid payee wallet and metadata JSON with stable fields.");
      return;
    }
    if (needsConfirmation && !confirmed) {
      say("bad", "Type Confirm lookalike to allow a payee whose name folds to an existing one.");
      return;
    }
    setAllowlisted((current) => [...current, payeeName.trim()]);
    void send(
      `Payee ${payeeName.trim()} allowed for agent ${agentIdBig}`,
      () =>
        writeContractAsync({
          address: guardAddress!,
          abi: payeeGuardAbi,
          functionName: "allowPayee",
          args: [agentIdBig, payeeWallet, allowlistNameHash, allowlistMetadataHash],
        }),
    );
    if (guardDemoMode) setConfirmation("");
  }

  function revokePayee() {
    if (!agentIdBig) {
      say("bad", "Enter a numeric agent id first.");
      return;
    }
    void send(
      `Payee for agent ${agentIdBig} revoked`,
      () => writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: "revokePayee", args: [agentIdBig] }),
    );
  }

  function submitSession(action: SessionAction) {
    if (!agentIdBig || !operatorAddress) {
      say("bad", "Enter a numeric agent id and an operator address.");
      return;
    }

    let caps: [bigint, bigint, bigint, bigint, bigint] | null = null;
    if (action !== "revoke") {
      try {
        const validAfterBig = toUnixSeconds(validAfter);
        const expiresAtBig = toUnixSeconds(expiresAt);
        if (validAfterBig === null || expiresAtBig === null || validAfterBig >= expiresAtBig) {
          say("bad", "The session must start before it expires.");
          return;
        }
        caps = [
          parseUnits(maxPerPayment, TUSD8_DECIMALS),
          parseUnits(maxCumulative, TUSD8_DECIMALS),
          parseUnits(autoApproveLimit, TUSD8_DECIMALS),
          validAfterBig,
          expiresAtBig,
        ];
      } catch {
        say("bad", "Caps must be amounts with at most six decimal places.");
        return;
      }
    }

    if (guardDemoMode) {
      setSessions((current) => {
        if (action === "revoke") {
          return current.map((item) => (item.agentId === agentId.trim() ? { ...item, status: "revoked" } : item));
        }
        return [
          ...current.filter((item) => item.agentId !== agentId.trim()),
          {
            agentId: agentId.trim(),
            wallet: short(operator, 6, 4),
            perPaymentCap: maxPerPayment,
            totalCap: maxCumulative,
            spent: "0.00",
            status: "active",
          },
        ];
      });
    }

    const label =
      action === "revoke"
        ? `Session ${short(sessionKey ?? "", 8, 6)} revoked`
        : action === "recreate"
          ? `Session ${short(sessionKey ?? "", 8, 6)} recreated at a new epoch`
          : `Session ${short(sessionKey ?? "", 8, 6)} created`;

    void send(
      label,
      () =>
        writeContractAsync({
          address: guardAddress!,
          abi: payeeGuardAbi,
          functionName: action === "revoke" ? "revokeSession" : "createSession",
          args:
            action === "revoke"
              ? [agentIdBig, operatorAddress]
              : [agentIdBig, operatorAddress, caps![0], caps![1], caps![2], caps![3], caps![4]],
        }),
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
      () => writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: paused ? "unpause" : "pause" }),
    );
  }

  function submitDeposit(event: FormEvent) {
    event.preventDefault();
    let amount: bigint;
    try {
      amount = parseUnits(depositAmount, TUSD8_DECIMALS);
    } catch {
      say("bad", "Enter an amount with at most six decimal places.");
      return;
    }
    void send(
      `Deposit of ${depositAmount} tUSD8 submitted`,
      () => writeContractAsync({ address: guardAddress!, abi: payeeGuardAbi, functionName: "deposit", args: [amount] }),
    );
  }

  function submitWithdraw(event: FormEvent) {
    event.preventDefault();
    if (withdrawTo.trim() && !withdrawAddress) {
      say("bad", "Enter a valid destination address, or leave it empty to withdraw to the owner.");
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
      () =>
        writeContractAsync({
          address: guardAddress!,
          abi: payeeGuardAbi,
          functionName: withdrawAddress ? "withdrawTo" : "withdraw",
          args: withdrawAddress ? [withdrawAddress, amount] : [amount],
        }),
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
            Allow an agent's payee, bound a session and decide what a payment intent is allowed to do. Every reason code below is written in plain language.
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
            <p className="card-sub">The owner commits the name and metadata hashes once. The wallet must match the registry's current wallet for this agent id.</p>
            <form onSubmit={submitAllowlist} className="form-stack">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="allow-agent-id">Agent id</label>
                  <input id="allow-agent-id" className="num mono" inputMode="numeric" value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="1" autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="payee-name">Registered name</label>
                  <input id="payee-name" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Northwind Freight Ltd" autoComplete="off" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="payee-address">Payee wallet</label>
                <input id="payee-address" className="mono" value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor="payee-metadata">Registry metadata JSON</label>
                <textarea id="payee-metadata" value={metadataJson} onChange={(event) => setMetadataJson(event.target.value)} spellCheck={false} rows={7} />
                <p className="field-help">Only type, name, active, services and registrations are hashed. Refresh timestamps are ignored.</p>
              </div>

              <dl className="hash-readout">
                <div>
                  <dt>nameHash</dt>
                  <dd>{allowlistNameHash ? <code>{allowlistNameHash}</code> : <span className="empty-value">Enter a name to compute</span>}</dd>
                </div>
                <div>
                  <dt>metadataHash</dt>
                  <dd>{allowlistMetadataHash ? <code>{allowlistMetadataHash}</code> : <span className="empty-value">Enter valid metadata JSON</span>}</dd>
                </div>
              </dl>

              {needsConfirmation && (
                <div className="lookalike-warning" role="alert">
                  <AlertTriangle {...iconProps} />
                  <div>
                    <p className="warning-title">Confusable with an allowlisted payee</p>
                    <p className="warning-detail">
                      {lookalikes.join(", ")} has the same folded skeleton as this name. Type <strong>Confirm lookalike</strong> before allowing it.
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
                  Allow payee
                </button>
                <button type="button" className="btn ghost danger" disabled={isPending} onClick={revokePayee}>
                  Revoke payee
                </button>
                {allowlisted.length > 0 && <span className="quiet-meta">{allowlisted.length} added this session</span>}
              </div>
            </form>
          </section>

          <section className="card form-card" aria-labelledby="session-heading">
            <h2 id="session-heading">Agent sessions</h2>
            <p className="card-sub">A session is keyed by agent id and operator. Recreating it advances the epoch and invalidates older intents.</p>
            <div className="form-stack">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="agent-id">Agent id</label>
                  <input id="agent-id" className="num mono" inputMode="numeric" value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="1" autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="operator">Operator address</label>
                  <input id="operator" className="mono" value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
                </div>
              </div>
              <div className="form-row three">
                <div className="field">
                  <label htmlFor="per-cap">Max per payment</label>
                  <input id="per-cap" className="num" inputMode="decimal" value={maxPerPayment} onChange={(event) => setMaxPerPayment(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="total-cap">Max cumulative</label>
                  <input id="total-cap" className="num" inputMode="decimal" value={maxCumulative} onChange={(event) => setMaxCumulative(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="auto-approve">Auto-approve limit</label>
                  <input id="auto-approve" className="num" inputMode="decimal" value={autoApproveLimit} onChange={(event) => setAutoApproveLimit(event.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="valid-after">Valid after</label>
                  <input id="valid-after" type="datetime-local" value={validAfter} onChange={(event) => setValidAfter(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="expires-at">Expires at</label>
                  <input id="expires-at" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                </div>
              </div>
              <dl className="hash-readout">
                <div>
                  <dt>sessionKey(agentId, operator)</dt>
                  <dd>{sessionKey ? <code>{sessionKey}</code> : <span className="empty-value">Enter an agent id and operator</span>}</dd>
                </div>
              </dl>
              <div className="form-actions">
                <button type="button" className="btn" disabled={isPending} onClick={() => submitSession("create")}>
                  Create session
                </button>
                <button type="button" className="btn secondary" disabled={isPending} onClick={() => submitSession("recreate")}>
                  <RotateCw {...iconProps} /> Recreate session
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
            <p className="card-sub">Fund the vault, pause every agent and withdraw committed funds. Deposits need a tUSD8 approval to the vault first.</p>
            <div className="control-row">
              <div>
                <span className="control-label">Payments</span>
                <span className={`control-state ${paused ? "paused" : "active"}`}>
                  <span className={`dot ${paused ? "bad" : ""}`} aria-hidden="true" /> {paused ? "Paused" : "Running"}
                </span>
              </div>
              <button type="button" className="btn secondary" disabled={isPending} onClick={togglePause}>
                {paused ? <Play {...iconProps} /> : <Pause {...iconProps} />} {paused ? "Unpause payments" : "Pause payments"}
              </button>
            </div>
            <form onSubmit={submitDeposit} className="form-stack">
              <div className="field">
                <label htmlFor="deposit-amount">Deposit amount, tUSD8</label>
                <input id="deposit-amount" className="num" inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn secondary" disabled={isPending}>
                  Deposit
                </button>
              </div>
            </form>
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
