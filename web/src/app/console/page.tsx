import type { Metadata } from "next";
import { ConsoleView } from "@/components/guard/ConsoleView";

export const metadata: Metadata = { title: "Owner console" };

export default function ConsolePage() {
  return <ConsoleView />;
}
