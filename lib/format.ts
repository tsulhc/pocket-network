const UPOKT_PER_POKT = 1_000_000;

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDecimal(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

export function formatUpokt(upokt: bigint, maximumFractionDigits = 2): string {
  const sign = upokt < 0n ? "-" : "";
  const absolute = upokt < 0n ? -upokt : upokt;
  const whole = absolute / BigInt(UPOKT_PER_POKT);
  const fraction = absolute % BigInt(UPOKT_PER_POKT);
  const fractionString = fraction.toString().padStart(6, "0").slice(0, maximumFractionDigits);
  const wholeFormatted = new Intl.NumberFormat("en-US").format(Number(whole));

  if (maximumFractionDigits === 0 || Number(fractionString) === 0) {
    return `${sign}${wholeFormatted} POKT`;
  }

  return `${sign}${wholeFormatted}.${fractionString} POKT`;
}

export function formatCompactUpokt(upokt: bigint, maximumFractionDigits = 1): string {
  const value = Number(upokt) / UPOKT_PER_POKT;
  return `${formatCompactNumberWithDigits(value, maximumFractionDigits)} POKT`;
}

export function formatCompactNumberWithDigits(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits
  }).format(value);
}

export function formatRelativeRange(window: string): string {
  switch (window) {
    case "24h":
      return "last 24 hours";
    case "7d":
      return "last 7 days";
    case "30d":
      return "last 30 days";
    case "365d":
      return "last 365 days";
    default:
      return window;
  }
}

export function truncateAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return `${formatDecimal(value, maximumFractionDigits)}%`;
}

export function formatUsd(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

export function formatCompactUsd(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits
  }).format(value);
}
