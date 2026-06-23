"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"

interface ScoreBarChartProps {
  eScore: number
  sScore: number
  gScore: number
}

const DIMENSION_COLORS = {
  "E 環境": "#22c55e",
  "S 社會": "#3b82f6",
  "G 治理": "#a855f7",
}

export function ScoreBarChart({ eScore, sScore, gScore }: ScoreBarChartProps) {
  const data = [
    { name: "E 環境", score: eScore },
    { name: "S 社會", score: sScore },
    { name: "G 治理", score: gScore },
  ]

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}`, "分數"]} />
        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={DIMENSION_COLORS[entry.name as keyof typeof DIMENSION_COLORS]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
