import { AlertTriangle, Check, Minus } from "lucide-react";
import { iconProps } from "@/components/Icons";
import { compareNames, confusableReference, describeUnit, type CharUnit, type DiffState } from "@/lib/confusables";

function Character({
  unit,
  side,
  state,
}: {
  unit?: CharUnit;
  side: "Invoice" | "Registry";
  state: DiffState;
}) {
  if (!unit) {
    return (
      <span className="char missing" aria-label={`${side}: no character at this position`}>
        <Minus {...iconProps} />
      </span>
    );
  }

  const description = describeUnit(unit, side);
  const classes = ["char", state === "confusable" ? "confusable" : "", state === "different" ? "different" : "", unit.kind === "plain" ? "" : "folded"]
    .filter(Boolean)
    .join(" ");

  if (unit.kind === "plain") {
    return (
      <span className={classes} aria-label={description}>
        {unit.raw}
      </span>
    );
  }

  return (
    <button type="button" className={classes} aria-label={description} title={description}>
      {unit.raw}
    </button>
  );
}

function HiddenMarks({ units, side }: { units: CharUnit[]; side: "Invoice" | "Registry" }) {
  if (units.length === 0) return <span className="control-slot" aria-hidden="true" />;
  return (
    <span className="control-slot">
      {units.map((unit) => (
        <button
          key={`${side}-${unit.codepoint}-${unit.index}`}
          type="button"
          className={`control-mark ${side === "Registry" ? "registry" : ""}`}
          aria-label={describeUnit(unit, side)}
          title={describeUnit(unit, side)}
        >
          <span aria-hidden="true">␣</span>
        </button>
      ))}
    </span>
  );
}

export function SpoofDiff({ invoice, registry }: { invoice: string; registry: string }) {
  const diff = compareNames(invoice, registry);
  const flagged = diff.confusableCount > 0;

  return (
    <section className="diff-panel" aria-label="Character-level name comparison">
      <header className="diff-head">
        <div>
          <p className="kicker">Character check</p>
          <h3>Invoice says / Registry says</h3>
        </div>
        <span className={`diff-state ${flagged ? "flagged" : "clear"}`}>
          {flagged ? <AlertTriangle {...iconProps} /> : <Check {...iconProps} />}
          <span>{flagged ? `${diff.confusableCount} characters need a closer look` : "Every character is identical"}</span>
        </span>
      </header>

      <div className="diff-body">
        <div className="diff-gutter" aria-hidden="true">
          <span title="Invoice">I</span>
          <span title="Registry">R</span>
        </div>
        <div className="diff-scroll" tabIndex={0} role="group" aria-label="Aligned characters, scroll horizontally to see the whole name">
          <div className="diff-columns">
            {diff.columns.map((column) => (
              <div className={`diff-col ${column.state}`} key={column.key}>
                <div className="diff-controls">
                  <HiddenMarks units={column.invoiceHidden} side="Invoice" />
                  <HiddenMarks units={column.registryHidden} side="Registry" />
                </div>
                <Character unit={column.invoice} side="Invoice" state={column.state} />
                <Character unit={column.registry} side="Registry" state={column.state} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="diff-key">
        <span>
          <span className="key-line plain" aria-hidden="true" /> Exact
        </span>
        <span>
          <span className="key-line confusable" aria-hidden="true" /> Confusable
        </span>
        <span>
          <span className="key-line hidden" aria-hidden="true" /> Invisible control
        </span>
      </div>

      <div className="skeleton-row">
        <div className="skeleton-item">
          <span className="skeleton-label">Invoice skeleton</span>
          <code className={diff.skeletonMatches ? "verified-underline" : ""}>{diff.invoiceSkeleton}</code>
        </div>
        <div className="skeleton-item">
          <span className="skeleton-label">Registry skeleton</span>
          <code className={diff.skeletonMatches ? "verified-underline" : ""}>{diff.registrySkeleton}</code>
        </div>
        <span className={`skeleton-state ${diff.skeletonMatches ? "clear" : "flagged"}`}>
          {diff.skeletonMatches ? "Identical skeleton" : "Different skeleton"}
        </span>
      </div>

      <details className="confusable-ref" open>
        <summary>Characters the check folds</summary>
        <ul>
          {confusableReference.map((item) => (
            <li key={item.note}>
              <code className="ref-pair">
                <span>{item.sample === "\u200B" || item.sample === "\u202E" ? "invisible" : item.sample}</span>
                <span aria-hidden="true">→</span>
                <span>{item.normal}</span>
              </code>
              <span className="ref-note">{item.note}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
