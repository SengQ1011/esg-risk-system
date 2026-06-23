import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const GRADE_STYLES: Record<string, string> = {
  A:   "text-green-700 bg-green-100 border-green-200",
  "B+":"text-emerald-700 bg-emerald-100 border-emerald-200",
  B:   "text-yellow-700 bg-yellow-100 border-yellow-200",
  "B-":"text-orange-700 bg-orange-100 border-orange-200",
  C:   "text-red-700 bg-red-100 border-red-200",
}

export function getGradeStyle(grade: string | null) {
  return GRADE_STYLES[grade ?? ""] ?? "text-gray-700 bg-gray-100 border-gray-200"
}

interface GradeBadgeProps {
  grade: string | null
  className?: string
  size?: "sm" | "lg"
}

export function GradeBadge({ grade, className, size = "sm" }: GradeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        getGradeStyle(grade),
        size === "lg" && "text-2xl font-bold px-4 py-1",
        className
      )}
    >
      {grade ?? "—"}
    </Badge>
  )
}
