import { links } from "@aevum-kit/aevum";
import { Ban, Check, CircleAlert, CircleCheck, CircleDot, ExternalLink, Minus, X } from "lucide-react";
import { iconProps } from "@/components/Icons";
import { SpoofDiff } from "@/components/guard/SpoofDiff";
import type { Scenario, TierStatus, Verdict } from "@/data/scenarios";
import { explainReason } from "@/lib/reasonCodes";
import { short } from "@/lib/order";

export const verdictLabels: Record<Verdict, string> = {
  allowed: "Allowed",
  rejected: "Rejected",
  "needs-approval": "Needs approval",
};

const verdictIcons = { allowed: CircleCheck, rejected: Ban, "needs-approval": CircleAlert };

const tierIcons: Record<TierStatus, typeof Check> = {
  verified: Check,
  checked: CircleDot,
  failed: X,
  "not-checked": Minus,
};

const outcomeIcons = { pass: Check, fail: X, note: Minus };

function TierRow({ tier }: { tier: Scenario["tiers"][number] }) {
  const Icon = tierIcons[tier.status];
  return (
    <li className="tier-row">
      <span className="tier-number">T{tier.tier}</span>
      <div className="tier-body">
        <div className="tier-title">{tier.title}</div>
        <p className="tier-detail">{tier.detail}</p>
      </div>
      <span className={`tier-state ${tier.status}`}>
        <Icon {...iconProps} />
        <span>{tier.status === "not-checked" ? "Not checked" : tier.status === "checked" ? "Checked" : tier.status === "verified" ? "Verified" : "Mismatch"}</span>
      </span>
    </li>
  );
}

export function VerdictCard({ scenario, position, total }: { scenario: Scenario; position: number; total: number }) {
  const VerdictIcon = verdictIcons[scenario.verdict];
  const explorer = `${links.explorer}/tx/${scenario.txHash}`;

  return (
    <article className="verdict-card" aria-live="polite">
      <header className="verdict-head">
        <div>
          <p className="kicker">
            Verdict {String(position).padStart(2, "0")} of {String(total).padStart(2, "0")} · {scenario.category}
          </p>
          <h2>{scenario.title}</h2>
          <p className="verdict-summary">{scenario.summary}</p>
        </div>
        <span className={`verdict-stamp ${scenario.verdict}`}>
          <VerdictIcon {...iconProps} />
          <span>{verdictLabels[scenario.verdict]}</span>
        </span>
      </header>

      <div className="reason-line">
        <code className="reason-code">{scenario.reasonCode}</code>
        <span>{scenario.reason}</span>
      </div>

      <div className="verdict-columns">
        <section aria-labelledby="tiers-heading">
          <h3 id="tiers-heading" className="section-title">
            Trust tiers
          </h3>
          <ul className="tier-list">
            {scenario.tiers.map((entry) => (
              <TierRow key={entry.tier} tier={entry} />
            ))}
          </ul>
        </section>
        <section aria-labelledby="evidence-heading">
          <h3 id="evidence-heading" className="section-title">
            Evidence
          </h3>
          <ul className="evidence-list">
            {scenario.evidence.map((item) => {
              const Icon = outcomeIcons[item.outcome];
              return (
                <li className="evidence-item" key={item.label}>
                  <span className={`evidence-icon ${item.outcome}`}>
                    <Icon {...iconProps} />
                  </span>
                  <div>
                    <span className="evidence-label">{item.label}</span>
                    <code className="evidence-value">{item.value}</code>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <SpoofDiff invoice={scenario.invoiceName} registry={scenario.registryName} />

      <div className="receipt-strip">
        <div>
          <span className="receipt-label">Requested amount</span>
          <span className="receipt-value num">{scenario.amount} tUSD8</span>
        </div>
        <div>
          <span className="receipt-label">Agent</span>
          <code className="receipt-value">{scenario.agentId}</code>
        </div>
        <div>
          <span className="receipt-label">Payee on file</span>
          <span className="receipt-value verified-underline">{scenario.registryName}</span>
        </div>
        <div>
          <span className="receipt-label">Transaction</span>
          <a className="receipt-link" href={explorer} target="_blank" rel="noreferrer">
            <code>{short(scenario.txHash, 10, 8)}</code>
            <ExternalLink {...iconProps} />
            <span className="sr-only">Opens the explorer (placeholder hash)</span>
          </a>
        </div>
      </div>
      <p className="fixture-note">
        Fixture receipt · {scenario.event} · {scenario.settledAt} · hash is a placeholder, not a settled transaction
      </p>

      <details className="why-accordion">
        <summary>Why this verdict?</summary>
        <div className="why-body">
          <p>{scenario.why}</p>
          <p className="why-rule">
            Reason code <code>{scenario.reasonCode}</code> means: {explainReason(scenario.reasonCode)}
          </p>
        </div>
      </details>
    </article>
  );
}
