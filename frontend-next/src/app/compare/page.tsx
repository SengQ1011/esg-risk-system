import Link from "next/link"
import { AlertTriangle, BarChart3, Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { CompareRadarChart } from "@/components/compare-radar-chart"
import { fetchDashboard } from "@/lib/api"
import type { DashboardCompany } from "@/lib/types"

type Signal = "green" | "yellow" | "red"

function deriveSignal(score: number): Signal {
  return score >= 70 ? "green" : score >= 50 ? "yellow" : "red"
}

const signalConfig = {
  green:  { dot: "bg-green-500", ring: "ring-green-500/30",  text: "text-green-600",  label: "低風險" },
  yellow: { dot: "bg-amber-500", ring: "ring-amber-500/40",  text: "text-amber-500",  label: "中風險" },
  red:    { dot: "bg-red-500",   ring: "ring-red-500/30",    text: "text-red-600",    label: "高風險" },
} as const

const gradeColor: Record<string, string> = {
  A:    "text-green-700 bg-green-50 border-green-200",
  "B+": "text-emerald-700 bg-emerald-50 border-emerald-200",
  B:    "text-yellow-700 bg-yellow-50 border-yellow-200",
  "B-": "text-orange-700 bg-orange-50 border-orange-200",
  C:    "text-red-700 bg-red-50 border-red-200",
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct   = Math.min(100, (score / max) * 100)
  const color = score >= 70 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums">{score.toFixed(1)}</span>
    </div>
  )
}

function CompanyScoreCard({ c }: { c: DashboardCompany }) {
  const signal = deriveSignal(c.total_score)
  const cfg    = signalConfig[signal]
  const gCls   = gradeColor[c.grade] ?? "text-gray-700 bg-gray-50 border-gray-200"

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-4" />
            </div>
            <div className="min-w-0">
              <Link
                href={`/company/${encodeURIComponent(c.name)}`}
                className="truncate font-semibold text-foreground hover:text-primary"
              >
                {c.name}
              </Link>
              <p className="text-xs text-muted-foreground">{c.ticker}</p>
            </div>
          </div>
          <Badge variant="outline" className={cn("shrink-0 font-bold", gCls)}>{c.grade}</Badge>
        </div>

        {/* Total score + signal */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums">{c.total_score.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 ring-1 ring-inset", cfg.ring)}>
            <span className="relative flex size-2.5">
              <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", cfg.dot)} />
              <span className={cn("relative inline-flex size-2.5 rounded-full", cfg.dot)} />
            </span>
            <span className={cn("text-xs font-medium", cfg.text)}>{cfg.label}</span>
          </div>
        </div>

        {/* E/S/G bars */}
        <div className="flex flex-col gap-2">
          {[
            { label: "E 環境（40%）", score: c.e_score },
            { label: "S 社會（30%）", score: c.s_score },
            { label: "G 治理（30%）", score: c.g_score },
          ].map(({ label, score }) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{label}</span>
              </div>
              <ScoreBar score={score} />
            </div>
          ))}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-1.5">
          {c.greenwash_flag && (
            <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[11px]">
              漂綠爭議
            </Badge>
          )}
          {c.news_event_score >= 0.5 && (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[11px]">
              高風險新聞
            </Badge>
          )}
          {!c.greenwash_flag && c.news_event_score < 0.5 && (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-[11px]">
              無重大警示
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function ComparePage() {
  let data
  let error: string | null = null

  try {
    const res = await fetchDashboard()
    data = res.data
  } catch (e) {
    error = e instanceof Error ? e.message : "無法連線至後端 API"
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertTriangle className="size-4 shrink-0" />
        {error} — 請確認後端 API 已啟動
      </div>
    )
  }

  const { companies, radar_data } = data!
  const companyNames = companies.map((c: DashboardCompany) => c.name)

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">公司 ESG 比較</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {companyNames.join(' · ')} — 2023 年度永續報告書對比分析
        </p>
      </div>

      {/* Score cards */}
      <div className={cn(
        "grid grid-cols-1 gap-5",
        companies.length <= 2 ? "md:grid-cols-2" :
        companies.length === 4 ? "md:grid-cols-2 lg:grid-cols-4" :
        "md:grid-cols-3"
      )}>
        {companies.map((c: DashboardCompany) => (
          <CompanyScoreCard key={c.name} c={c} />
        ))}
      </div>

      {/* Radar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">E/S/G 三維雷達對比</CardTitle>
          <CardDescription>{companies.length} 家公司各維度評分視覺化比較（滿分 100）</CardDescription>
        </CardHeader>
        <CardContent>
          <CompareRadarChart data={radar_data} companies={companyNames} />
        </CardContent>
      </Card>

      {/* Comparison table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">詳細分數對照表</CardTitle>
          <CardDescription>各評分維度與風險指標橫向比較</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-3 font-medium">指標</th>
                  {companies.map((c: DashboardCompany) => (
                    <th key={c.name} className="pb-3 text-right font-medium">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "ESG 總分",      key: "total_score" as const, format: (v: number) => v.toFixed(1) },
                  { label: "E 環境（40%）", key: "e_score" as const,     format: (v: number) => v.toFixed(1) },
                  { label: "S 社會（30%）", key: "s_score" as const,     format: (v: number) => v.toFixed(1) },
                  { label: "G 治理（30%）", key: "g_score" as const,     format: (v: number) => v.toFixed(1) },
                ].map(({ label, key, format }) => (
                  <tr key={label} className="border-b last:border-0">
                    <td className="py-3 text-muted-foreground">{label}</td>
                    {companies.map((c: DashboardCompany) => {
                      const v = c[key]
                      const color = v >= 70 ? "text-green-600" : v >= 50 ? "text-amber-500" : "text-red-600"
                      return (
                        <td key={c.name} className={cn("py-3 text-right font-bold tabular-nums", color)}>
                          {format(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-b">
                  <td className="py-3 text-muted-foreground">新聞風險（ERS）</td>
                  {companies.map((c: DashboardCompany) => (
                    <td key={c.name} className="py-3 text-right tabular-nums text-muted-foreground">
                      {c.news_event_score.toFixed(2)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 text-muted-foreground">漂綠旗標</td>
                  {companies.map((c: DashboardCompany) => (
                    <td key={c.name} className="py-3 text-right">
                      {c.greenwash_flag
                        ? <span className="font-medium text-orange-600">是</span>
                        : <span className="text-muted-foreground">否</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">分級說明：</span>
        A ≥ 80（優良）· B+ ≥ 70（良好）· B ≥ 60（普通）· B- ≥ 50（待改善）· C &lt; 50（高風險）
        <br />
        <span className="font-semibold text-foreground">方法學：</span>
        指標正規化依 GRI/SASB，新聞扣分仿 TESG ERS，外部 YAML 權重設定可公開揭露。
      </div>
    </div>
  )
}
