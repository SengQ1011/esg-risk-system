"use client"

import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts"
import { AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

const chartConfig = {
  score: { label: "得分", color: "hsl(142.1 76.2% 36.3%)" },
}

interface Props {
  eScore: number
  sScore: number
  gScore: number
  eMissing?: number
  sMissing?: number
  gMissing?: number
}

export function EsgRadarChartClient({
  eScore, sScore, gScore,
  eMissing = 0, sMissing = 0, gMissing = 0,
}: Props) {
  const dimensions = [
    { key: "E", fullLabel: "環境 Environment", score: eScore, missing: eMissing },
    { key: "S", fullLabel: "社會 Social",       score: sScore, missing: sMissing },
    { key: "G", fullLabel: "治理 Governance",   score: gScore, missing: gMissing },
  ]

  const radarData = dimensions.map((d) => ({
    dimension: d.fullLabel.split(" ")[0],
    score: Math.round(d.score),
    fullMark: 100,
  }))

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">ESG 三維度評分</CardTitle>
        <CardDescription>E / S / G 各維度標準化得分（滿分 100）</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-h-[260px]">
          <RadarChart data={radarData}>
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <PolarGrid className="stroke-border" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fontSize: 13, fill: "var(--muted-foreground)" }}
            />
            <Radar
              dataKey="score"
              fill="var(--color-score)"
              fillOpacity={0.25}
              stroke="var(--color-score)"
              strokeWidth={2}
              dot={{ r: 4, fillOpacity: 1, fill: "var(--color-score)" }}
            />
          </RadarChart>
        </ChartContainer>

        <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-4">
          {dimensions.map((d) => (
            <div key={d.key} className="flex flex-col items-center gap-1 text-center">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {d.fullLabel.split(" ")[0]}
                </span>
                {d.missing > 0 && (
                  <Badge
                    variant="destructive"
                    className="h-4 gap-0.5 px-1 text-[10px] font-medium leading-none"
                  >
                    <AlertTriangle className="size-2.5" />
                    {d.missing}
                  </Badge>
                )}
              </div>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums leading-none",
                  d.score >= 75 ? "text-green-600"
                  : d.score >= 60 ? "text-amber-500"
                  : "text-red-600",
                )}
              >
                {d.score.toFixed(1)}
              </span>
              {d.missing > 0 && (
                <span className="text-[11px] leading-tight text-red-600">
                  {d.missing} 項未揭露
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
