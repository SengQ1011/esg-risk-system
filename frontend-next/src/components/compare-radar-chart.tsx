"use client"

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import type { RadarDataPoint } from "@/lib/types"

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b"]

interface CompareRadarChartProps {
  data: RadarDataPoint[]
  companies: string[]
}

export function CompareRadarChart({ data, companies }: CompareRadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 13, fontWeight: 500 }}
        />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}`, ""]} />
        <Legend />
        {companies.map((name, i) => (
          <Radar
            key={name}
            name={name}
            dataKey={name}
            fill={COLORS[i % COLORS.length]}
            fillOpacity={0.18}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  )
}
