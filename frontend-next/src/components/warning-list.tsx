import { AlertTriangle, AlertCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Warning } from "@/lib/types"

const LEVEL_STYLES = {
  high:   { style: "bg-red-50 border-red-200 text-red-800",    Icon: AlertTriangle },
  medium: { style: "bg-yellow-50 border-yellow-200 text-yellow-800", Icon: AlertCircle },
  low:    { style: "bg-blue-50 border-blue-200 text-blue-800", Icon: Info },
}

interface WarningListProps {
  warnings: Warning[]
}

export function WarningList({ warnings }: WarningListProps) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        <Info className="size-4 shrink-0" />
        無重大警示事件
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {warnings.map((w, i) => {
        const level = w.level in LEVEL_STYLES ? w.level : "low"
        const { style, Icon } = LEVEL_STYLES[level as keyof typeof LEVEL_STYLES]
        return (
          <div key={i} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", style)}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span>{w.message}</span>
          </div>
        )
      })}
    </div>
  )
}
