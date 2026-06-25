"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { BarChart3, Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { CompareRadarChart, COMPANY_COLORS } from "@/components/compare-radar-chart"
import type { DashboardCompany, HistoryEntry, RadarDataPoint } from "@/lib/types"

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

interface DisplayData {
  name: string
  ticker: string
  total_score: number
  grade: string
  e_score: number
  s_score: number
  g_score: number
  greenwash_flag: boolean
  news_event_score: number
  report_year: number | null
}

function ScoreBar({ score }: { score: number }) {
  const pct   = Math.min(100, score)
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

function CompanyScoreCard({ data, color }: { data: DisplayData; color: string }) {
  const signal = deriveSignal(data.total_score)
  const cfg    = signalConfig[signal]
  const gCls   = gradeColor[data.grade] ?? "text-gray-700 bg-gray-50 border-gray-200"

  return (
    <Card className="flex flex-col" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: color }}
            >
              <Building2 className="size-4" />
            </div>
            <div className="min-w-0">
              <Link
                href={`/company/${encodeURIComponent(data.name)}`}
                className="truncate font-semibold text-foreground hover:text-primary"
              >
                {data.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {data.ticker}{data.report_year ? ` · ${data.report_year} 年` : ""}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={cn("shrink-0 font-bold", gCls)}>{data.grade}</Badge>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums">{data.total_score.toFixed(1)}</span>
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

        <div className="flex flex-col gap-2">
          {[
            { label: "E 環境（40%）", score: data.e_score },
            { label: "S 社會（30%）", score: data.s_score },
            { label: "G 治理（30%）", score: data.g_score },
          ].map(({ label, score }) => (
            <div key={label}>
              <div className="mb-1 text-xs text-muted-foreground">{label}</div>
              <ScoreBar score={score} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {data.greenwash_flag && (
            <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[11px]">
              漂綠爭議
            </Badge>
          )}
          {data.news_event_score >= 0.5 && (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[11px]">
              高風險新聞
            </Badge>
          )}
          {!data.greenwash_flag && data.news_event_score < 0.5 && (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-[11px]">
              無重大警示
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export interface CompareClientProps {
  companies: DashboardCompany[]
  allHistory: Record<string, HistoryEntry[]>
}

export function CompareClient({ companies, allHistory }: CompareClientProps) {
  const colorMap = useMemo(
    () => Object.fromEntries(companies.map((c, i) => [c.name, COMPANY_COLORS[i % COMPANY_COLORS.length]])),
    [companies]
  )

  const [checkedSet, setCheckedSet] = useState<Set<string>>(() => new Set(companies.map(c => c.name)))
  const [selectedScoreId, setSelectedScoreId] = useState<Record<string, number | undefined>>({})

  function toggleCompany(name: string) {
    setCheckedSet(prev => {
      const next = new Set(prev)
      if (next.has(name)) { next.delete(name) } else { next.add(name) }
      return next
    })
  }

  const selectedCompanies = useMemo(
    () => companies.filter(c => checkedSet.has(c.name)),
    [companies, checkedSet]
  )

  const displayDataMap = useMemo((): Record<string, DisplayData> => {
    return Object.fromEntries(
      selectedCompanies.map(c => {
        const scoreId = selectedScoreId[c.name]
        const history = allHistory[c.name] ?? []
        const entry = scoreId != null ? history.find(h => h.score_id === scoreId) : null
        const data: DisplayData = entry
          ? {
              name: c.name,
              ticker: c.ticker,
              total_score: entry.total_score,
              grade: entry.grade,
              e_score: entry.e_score,
              s_score: entry.s_score,
              g_score: entry.g_score,
              greenwash_flag: c.greenwash_flag,
              news_event_score: c.news_event_score,
              report_year: entry.report_year,
            }
          : {
              name: c.name,
              ticker: c.ticker,
              total_score: c.total_score,
              grade: c.grade,
              e_score: c.e_score,
              s_score: c.s_score,
              g_score: c.g_score,
              greenwash_flag: c.greenwash_flag,
              news_event_score: c.news_event_score,
              report_year: history[0]?.report_year ?? null,
            }
        return [c.name, data]
      })
    )
  }, [selectedCompanies, selectedScoreId, allHistory])

  const radarData = useMemo((): RadarDataPoint[] => [
    { subject: "E 環境", ...Object.fromEntries(selectedCompanies.map(c => [c.name, displayDataMap[c.name]?.e_score ?? 0])) },
    { subject: "S 社會", ...Object.fromEntries(selectedCompanies.map(c => [c.name, displayDataMap[c.name]?.s_score ?? 0])) },
    { subject: "G 治理", ...Object.fromEntries(selectedCompanies.map(c => [c.name, displayDataMap[c.name]?.g_score ?? 0])) },
  ], [selectedCompanies, displayDataMap])

  const gridCols =
    selectedCompanies.length <= 2 ? "md:grid-cols-2" :
    selectedCompanies.length === 4 ? "md:grid-cols-2 lg:grid-cols-4" :
    "md:grid-cols-3"

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">公司 ESG 比較</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {companies.map(c => c.name).join(" · ")} — 永續報告書對比分析
        </p>
      </div>

      {/* Company filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">篩選顯示公司與資料版本</CardTitle>
          <CardDescription className="text-xs">
            點擊切換顯示；有多筆評分紀錄的公司可在右側下拉選擇版本
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {companies.map(c => {
              const color     = colorMap[c.name]
              const isChecked = checkedSet.has(c.name)
              const history   = allHistory[c.name] ?? []
              const curId     = selectedScoreId[c.name]

              return (
                <div
                  key={c.name}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all",
                    isChecked ? "bg-white shadow-sm" : "opacity-40 bg-muted"
                  )}
                  style={isChecked ? { borderColor: color } : {}}
                >
                  <button
                    type="button"
                    onClick={() => toggleCompany(c.name)}
                    className="flex items-center gap-1.5 text-sm font-medium"
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0 transition-colors"
                      style={{ backgroundColor: isChecked ? color : "#94a3b8" }}
                    />
                    {c.name}
                  </button>

                  {isChecked && history.length > 1 && (
                    <select
                      value={curId ?? ""}
                      onChange={e => {
                        const val = e.target.value
                        setSelectedScoreId(prev => ({
                          ...prev,
                          [c.name]: val ? Number(val) : undefined,
                        }))
                      }}
                      onClick={e => e.stopPropagation()}
                      className="border-none bg-transparent text-xs text-muted-foreground focus:outline-none cursor-pointer"
                    >
                      <option value="">最新</option>
                      {history.map(h => (
                        <option key={h.score_id} value={h.score_id}>
                          {h.report_year
                            ? `${h.report_year} 年`
                            : h.timestamp?.slice(0, 10) ?? `#${h.score_id}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {selectedCompanies.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          請至少選擇一家公司以顯示比較結果
        </div>
      ) : (
        <>
          {/* Score cards */}
          <div className={cn("grid grid-cols-1 gap-5", gridCols)}>
            {selectedCompanies.map(c => (
              <CompanyScoreCard
                key={c.name}
                data={displayDataMap[c.name]}
                color={colorMap[c.name]}
              />
            ))}
          </div>

          {/* Radar chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">E/S/G 三維雷達對比</CardTitle>
              <CardDescription>
                {selectedCompanies.length} 家公司各維度評分視覺化比較（滿分 100）
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompareRadarChart
                data={radarData}
                companies={selectedCompanies.map(c => c.name)}
                colors={colorMap}
              />
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
                      {selectedCompanies.map(c => (
                        <th
                          key={c.name}
                          className="pb-3 text-right font-semibold"
                          style={{ color: colorMap[c.name] }}
                        >
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        { label: "ESG 總分",      key: "total_score" },
                        { label: "E 環境（40%）", key: "e_score" },
                        { label: "S 社會（30%）", key: "s_score" },
                        { label: "G 治理（30%）", key: "g_score" },
                      ] as { label: string; key: keyof DisplayData }[]
                    ).map(({ label, key }) => (
                      <tr key={label} className="border-b last:border-0">
                        <td className="py-3 text-muted-foreground">{label}</td>
                        {selectedCompanies.map(c => {
                          const v = displayDataMap[c.name][key] as number
                          const color = v >= 70 ? "text-green-600" : v >= 50 ? "text-amber-500" : "text-red-600"
                          return (
                            <td key={c.name} className={cn("py-3 text-right font-bold tabular-nums", color)}>
                              {v.toFixed(1)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    <tr className="border-b">
                      <td className="py-3 text-muted-foreground">新聞風險（ERS）</td>
                      {selectedCompanies.map(c => (
                        <td key={c.name} className="py-3 text-right tabular-nums text-muted-foreground">
                          {displayDataMap[c.name].news_event_score.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-3 text-muted-foreground">漂綠旗標</td>
                      {selectedCompanies.map(c => (
                        <td key={c.name} className="py-3 text-right">
                          {displayDataMap[c.name].greenwash_flag
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
        </>
      )}

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
