"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { VerdictCard, verdictLabels } from "@/components/guard/VerdictCard";
import { scenarios } from "@/data/scenarios";

export default function DemoPage() {
  // Open on the lookalike so the character check is visible without a click.
  const [selectedId, setSelectedId] = useState("lookalike-spoof");
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, scenarios.findIndex((scenario) => scenario.id === selectedId));
  const selected = scenarios[index];

  function onCardKey(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    const last = scenarios.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = position === last ? 0 : position + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = position === 0 ? last : position - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    setSelectedId(scenarios[next].id);
    cards.current[next]?.focus();
  }

  return (
    <main className="shell guard-page">
      <header className="guard-head">
        <div>
          <p className="kicker">Judge mode · read-only</p>
          <h1>Confirmation of Payee, shown in eight verdicts</h1>
          <p className="lede">
            An owner verifies a payee once and the contract commits the identity snapshot. A scoped agent pays within caps. Lookalikes and injected instructions are refused with a reason.
          </p>
        </div>
        <p className="mode-note">
          <span className="dot" aria-hidden="true" /> No wallet, contract or env vars needed
        </p>
      </header>

      <section aria-labelledby="scenarios-heading">
        <div className="section-bar">
          <h2 id="scenarios-heading" className="section-title">
            Scenarios
          </h2>
          <span className="quiet-meta num">08 cases · use arrow keys to move</span>
        </div>
        <div className="scenario-grid">
          {scenarios.map((scenario, position) => (
            <button
              key={scenario.id}
              ref={(node) => {
                cards.current[position] = node;
              }}
              type="button"
              className={`scenario-card ${scenario.id === selected.id ? "selected" : ""}`}
              aria-pressed={scenario.id === selected.id}
              aria-label={`${scenario.title}: ${verdictLabels[scenario.verdict]}. ${scenario.summary}`}
              onClick={() => setSelectedId(scenario.id)}
              onKeyDown={(event) => onCardKey(event, position)}
            >
              <span className="scenario-top">
                <span className="scenario-index num">{String(position + 1).padStart(2, "0")}</span>
                <span className={`scenario-verdict ${scenario.verdict}`}>
                  <span className="dot" aria-hidden="true" />
                  {verdictLabels[scenario.verdict]}
                </span>
              </span>
              <span className="scenario-title">{scenario.title}</span>
            </button>
          ))}
        </div>
      </section>

      <VerdictCard scenario={selected} position={index + 1} total={scenarios.length} />
    </main>
  );
}
