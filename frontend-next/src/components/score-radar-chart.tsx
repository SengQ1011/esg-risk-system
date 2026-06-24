"use client"

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

interface RadarDataPoint {
  subject: string
  score: number
}

interface ScoreRadarChartProps {
  eScore: number
  sScore: number
  gScore: number
}

export function ScoreRadarChart({ eScore, sScore, gScore }: ScoreRadarChartProps) {
  const data: RadarDataPoint[] = [
    { subject: "E 環境", score: eScore },
    { subject: "S 社會", score: sScore },
    { subject: "G 治理", score: gScore },
  ]

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 13, fontWeight: 500 }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}`, "分數"]} />
        <Radar
          dataKey="score"
          fill="#22c55e"
          fillOpacity={0.25}
          stroke="#16a34a"
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
