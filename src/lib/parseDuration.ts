export function parseDuration(input: string): number | null {
  // Normalise comma decimal separator (e.g. "1,5" → "1.5")
  const trimmed = input.trim().replace(/,/g, ".");
  if (!trimmed) return null;

  // Try "Xh Ym" or "XhYm" format (with optional m/min suffix)
  const hm = trimmed.match(/^(\d+)\s*h\s*(\d+)(?:\s*m(?:in)?)?$/i);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);

  // Try "Xh" format (supports decimals)
  const hOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 60);

  // Try "Xm" or "Xmin" format (supports decimals)
  const mOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/i);
  if (mOnly) return Math.round(parseFloat(mOnly[1]));

  // A plain whole number is minutes; a plain decimal is hours. "45" meant 45
  // hours when every plain number was hours, and entries of 30h and 45h went
  // in that way, typed as minutes. Nobody writes "1.5" meaning a minute and a
  // half, so the decimal keeps its old meaning.
  if (/^\d+$/.test(trimmed)) {
    const mins = parseInt(trimmed, 10);
    return mins > 0 ? mins : null;
  }
  if (/^\d*\.\d+$/.test(trimmed)) {
    const hours = parseFloat(trimmed);
    return hours > 0 ? Math.round(hours * 60) : null;
  }

  return null;
}
