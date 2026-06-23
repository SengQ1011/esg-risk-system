import Link from "next/link"
import { AlertTriangle, BarChart3 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GradeBadge } from "@/components/grade-badge"
import { CompareRadarChart } from "@/components/compare-radar-chart"
import { fetchDashboard } from "@/lib/api"
import type { DashboardCompany } from "@/lib/types"

function ScoreCell({ score }: { score: number }) {
  const color =
    score >= 70 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-600"
  return <span className={`font-bold ${color}`}>{score.toFixed(1)}</span>
}

function CompanyCol({ c }: { c: DashboardCompany }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Link
        href={`/company/${encodeURIComponent(c.name)}`}
        className="text-base font-bold text-gray-900 hover:text-green-700"
      >
        {c.name}
      </Link>
      <span className="text-xs text-gray-400">{c.ticker} · {c.industry}</span>
      <GradeBadge grade={c.grade} />
      <div className="mt-1 text-2xl font-extrabold text-gray-900">
        {c.total_score.toFixed(1)}
      </div>
      <div className="text-xs text-gray-400">/ 100</div>
    </div>
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
  const companyNames = companies.map((c) => c.name)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="size-6 text-green-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">三家公司 ESG 對比</h1>
          <p className="text-sm text-gray-500">台達電 · 中鋼 · 南山人壽 — 2023 年永續報告書</p>
        </div>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-3 gap-4">
        {companies.map((c) => (
          <Card key={c.name}>
            <CardContent className="pt-5">
              <CompanyCol c={c} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Radar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">E/S/G 三維雷達比較</CardTitle>
        </CardHeader>
        <CardContent>
          <CompareRadarChart data={radar_data} companies={companyNames} />
        </CardContent>
      </Card>

      {/* Comparison Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">詳細分數對照表</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">指標</th>
                {companies.map((c) => (
                  <th key={c.name} className="pb-2 text-right font-medium">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-gray-600">ESG 總分</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right">
                    <ScoreCell score={c.total_score} />
                  </td>
                ))}
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">E 環境 (40%)</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right">
                    <ScoreCell score={c.e_score} />
                  </td>
                ))}
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">S 社會 (30%)</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right">
                    <ScoreCell score={c.s_score} />
                  </td>
                ))}
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">G 治理 (30%)</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right">
                    <ScoreCell score={c.g_score} />
                  </td>
                ))}
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">新聞風險 (ERS)</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right text-gray-500">
                    {c.news_event_score.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 text-gray-600">漂綠旗標</td>
                {companies.map((c) => (
                  <td key={c.name} className="py-2 text-right">
                    {c.greenwash_flag ? (
                      <span className="text-orange-600 font-medium">是</span>
                    ) : (
                      <span className="text-gray-400">否</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="rounded-lg border bg-white p-4 text-xs text-gray-400">
        <span className="font-semibold text-gray-600">分級說明：</span>
        A ≥ 80（優良）· B+ ≥ 70（良好）· B ≥ 60（普通）· B- ≥ 50（待改善）· C &lt; 50（高風險）
        <br />
        <span className="font-semibold text-gray-600">方法學：</span>
        指標正規化依 GRI/SASB，新聞扣分仿 TESG ERS（事件強度 × 時間衰減），外部 YAML 權重可公開揭露。
      </div>
    </div>
  )
}
