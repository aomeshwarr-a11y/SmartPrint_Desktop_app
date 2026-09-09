interface StatusBadgeProps {
  status?: string;
  tone?: "success" | "warning" | "error" | "neutral";
}

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
  neutral: "bg-brand-100 text-brand-700",
};

const STATUS_TONE: Record<string, StatusBadgeProps["tone"]> = {
  completed: "success",
  ready: "success",
  printing: "warning",
  downloading: "warning",
  claimed: "warning",
  downloaded: "warning",
  queued: "neutral",
  failed: "error",
  cancelled: "error",
  offline: "error",
  error: "error",
  paperjam: "error",
  paperout: "warning",
  busy: "warning",
};

export default function StatusBadge({ status, tone }: StatusBadgeProps) {
  const displayStatus = status || "Unknown";
  const resolvedTone =
    tone ?? STATUS_TONE[displayStatus.toLowerCase()] ?? "neutral";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[resolvedTone]}`}
    >
      {displayStatus}
    </span>
  );
}