import { ShieldCheck, TrendingUp, Umbrella } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DecisionLights as DecisionLightsType } from "@/lib/types"

const COLOR_STYLES = {
  green:  "bg-green-100 border-green-300 text-green-700",
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-700",
  red:    "bg-red-100 border-red-300 text-red-700",
}

const ICONS = {
  credit:      ShieldCheck,
  investment:  TrendingUp,
  underwriting: Umbrella,
}

const LABELS = {
  credit:      "授信",
  investment:  "投資",
  underwriting: "核保",
}

interface DecisionLightsProps {
  decision: DecisionLightsType
}

export function DecisionLights({ decision }: DecisionLightsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {(["credit", "investment", "underwriting"] as const).map((key) => {
        const Icon = ICONS[key]
        const d = decision[key]
        return (
          <div
            key={key}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border p-3",
              COLOR_STYLES[d.color]
            )}
          >
            <Icon className="size-6" />
            <span className="text-xs font-semibold">{LABELS[key]}</span>
            <span className="text-xs">{d.level}</span>
          </div>
        )
      })}
    </div>
  )
}
