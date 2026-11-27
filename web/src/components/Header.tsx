"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { iconProps } from "@/components/Icons";
import { networks, repoUrl } from "@/lib/env";
import { useNetwork } from "@/lib/network";

const links = [
  { href: "/demo", label: "Demo" },
  { href: "/console", label: "Console" },
  { href: "/receipts", label: "Receipts" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const pathname = usePathname();
  const { isConnected, chainId } = useAccount();
  const { net, select, switchingTo, switchError } = useNetwork();
  const wrongNetwork = isConnected && chainId !== net.chain.id && !switchingTo;

  return (
    <>
      <header className="topbar">
        <div className="shell">
          <Link href="/demo" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <ShieldCheck {...iconProps} />
            </span>
            <span className="brand-name">Payee Guard</span>
          </Link>
          <nav className="nav" aria-label="Main">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="topbar-end">
            <a className="gh-link" href={repoUrl} target="_blank" rel="noreferrer">
              Source
            </a>
            {networks.length > 1 && (
              <div className="net-switch" role="radiogroup" aria-label="Network">
                {networks.map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    role="radio"
                    aria-checked={n.key === net.key}
                    disabled={Boolean(switchingTo)}
                    title={`${n.chain.name} · chain ${n.chain.id}`}
                    onClick={() => select(n.key)}
                  >
                    <span className={`net-dot ${n.key}`} aria-hidden="true" />
                    {n.label}
                  </button>
                ))}
              </div>
            )}
            <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
          </div>
        </div>
      </header>
      {switchingTo && (
        <div className="banner info" role="status">
          <div className="shell">
            <span>
              Confirm the switch to {switchingTo.chain.name} in your wallet. If no window opened, check the wallet icon in your browser toolbar.
            </span>
          </div>
        </div>
      )}
      {switchError && !switchingTo && (
        <div className="banner" role="alert">
          <div className="shell">
            <span>{switchError}</span>
          </div>
        </div>
      )}
      {wrongNetwork && (
        <div className="banner" role="alert">
          <div className="shell">
            <span>
              Your wallet is on another network. This console reads chain {net.chain.id}.
            </span>
            <button type="button" className="btn small secondary" onClick={() => select(net.key)}>
              Switch network
            </button>
          </div>
        </div>
      )}
    </>
  );
}
