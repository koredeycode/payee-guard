export interface MemoScan {
  detected: boolean;
  flags: string[];
}

const INSTRUCTION_PATTERN =
  /\b(?:system|admin|assistant|developer)\s*:|ignore (?:all )?(?:previous|prior) instructions|disregard (?:all )?(?:previous|prior) instructions|do not verify|bypass (?:the )?(?:policy|verification)/i;

/**
 * Memos are data. This scan only raises flags for the policy to consider; it never
 * changes the payee address or agent id extracted from the structured request.
 */
export function scanMemo(memo: string, trustedPayeeAddress?: string): MemoScan {
  const flags: string[] = [];
  if (INSTRUCTION_PATTERN.test(memo)) flags.push("PROMPT_INJECTION_IGNORED");
  const addresses = memo.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  const foreign = addresses.filter(
    (address) => address.toLowerCase() !== trustedPayeeAddress?.toLowerCase(),
  );
  if (foreign.length > 0) flags.push("MEMO_CONTAINS_UNTRUSTED_ADDRESS");
  return { detected: flags.length > 0, flags };
}
