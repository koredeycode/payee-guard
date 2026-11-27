import { AlertTriangle, ArrowUpRight, Check, X, type LucideProps } from "lucide-react";

/** One icon set, one size, one stroke across the whole app. */
export const iconProps = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

export const CheckIcon = (props: LucideProps) => <Check {...iconProps} {...props} />;
export const WarnIcon = (props: LucideProps) => <AlertTriangle {...iconProps} {...props} />;
export const CrossIcon = (props: LucideProps) => <X {...iconProps} {...props} />;
export const GitHubIcon = (props: LucideProps) => <ArrowUpRight {...iconProps} {...props} />;
