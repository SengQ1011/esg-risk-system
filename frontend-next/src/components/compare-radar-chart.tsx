"use client"

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import type { RadarDataPoint } from "@/lib/types"

export const COMPANY_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
]

interface CompareRadarChartProps {
  data: RadarDataPoint[]
  companies: string[]
  colors?: Record<string, string>
}

export function CompareRadarChart({ data, companies, colors }: CompareRadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 13, fontWeight: 500 }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}`, ""]} />
        <Legend />
        {companies.map((name, i) => {
          const color = colors?.[name] ?? COMPANY_COLORS[i % COMPANY_COLORS.length]
          return (
            <Radar
              key={name}
              name={name}
              dataKey={name}
              fill={color}
              fillOpacity={0.18}
              stroke={color}
              strokeWidth={2}
            />
          )
        })}
      </RadarChart>
    </ResponsiveContainer>
  )
}
