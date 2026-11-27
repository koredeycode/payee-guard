import type { Metadata } from "next";
import { links } from "@aevum-kit/aevum";
import { ExternalLink } from "lucide-react";
import { iconProps } from "@/components/Icons";
import { ChainHealth } from "@/components/guard/ChainHealth";
import { verdictLabels } from "@/components/guard/VerdictCard";
import { scenarios } from "@/data/scenarios";
import { short } from "@/lib/order";

export const metadata: Metadata = { title: "Receipts" };

export default function ReceiptsPage() {
  return (
    <main className="shell guard-page">
      <header className="guard-head">
        <div>
          <p className="kicker">Settlement record</p>
          <h1>Receipts and events</h1>
          <p className="lede">One line per decision. Hashes below are placeholders until these fixtures are replaced with settled transactions.</p>
        </div>
      </header>

      <ChainHealth />

      <section className="card flush" aria-label="Receipts">
        <div className="table-wrap">
          <table className="data receipts-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Receipt</th>
                <th scope="col">Event</th>
                <th scope="col">Agent</th>
                <th scope="col" className="right">
                  Amount
                </th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.id}>
                  <td className="mono nowrap">{scenario.settledAt}</td>
                  <td>
                    <span className="receipt-name">{scenario.title}</span>
                    <span className={`receipt-verdict ${scenario.verdict}`}>
                      <span className="dot" aria-hidden="true" /> {verdictLabels[scenario.verdict]}
                    </span>
                  </td>
                  <td>
                    <code>{scenario.event}</code>
                  </td>
                  <td className="mono">{scenario.agentId}</td>
                  <td className="right num">{scenario.amount} tUSD8</td>
                  <td>
                    <a href={`${links.explorer}/tx/${scenario.txHash}`} target="_blank" rel="noreferrer" className="receipt-link">
                      <code>{short(scenario.txHash, 8, 6)}</code>
                      <ExternalLink {...iconProps} />
                      <span className="sr-only">Explorer link, placeholder hash</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="fixture-note">Explorer: explorer-test.qday.info · chain 44005 · all eight hashes are placeholders</p>
    </main>
  );
}
