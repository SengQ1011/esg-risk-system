import Link from "next/link"
import { AlertTriangle, ArrowRight, Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { fetchCompanies } from "@/lib/api"
import type { CompanySummary } from "@/lib/types"

type Signal = "green" | "yellow" | "red"

function deriveSignal(score: number | null): Signal {
  if (score == null) return "yellow"
  return score >= 70 ? "green" : score >= 50 ? "yellow" : "red"
}

const signalConfig = {
  green:  { label: "低風險", dot: "bg-green-500", text: "text-green-600",  ring: "ring-green-500/30"  },
  yellow: { label: "中風險", dot: "bg-amber-500", text: "text-amber-500",  ring: "ring-amber-500/40"  },
  red:    { label: "高風險", dot: "bg-red-500",   text: "text-red-600",    ring: "ring-red-500/30"    },
} as const

const gradeColor: Record<string, string> = {
  A:   "text-green-700 bg-green-50 border-green-200",
  "B+": "text-emerald-700 bg-emerald-50 border-emerald-200",
  B:   "text-yellow-700 bg-yellow-50 border-yellow-200",
  "B-": "text-orange-700 bg-orange-50 border-orange-200",
  C:   "text-red-700 bg-red-50 border-red-200",
}

function CompanyCard({ c }: { c: CompanySummary }) {
  const s      = c.latest_score
  const signal = deriveSignal(s?.total_score ?? null)
  const cfg    = signalConfig[signal]
  const gCls   = gradeColor[s?.grade ?? ""] ?? "text-gray-700 bg-gray-50 border-gray-200"

  return (
    <Link href={`/company/${encodeURIComponent(c.name)}`} className="group block">
      <Card className="h-full transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20">
        <CardContent className="flex h-full flex-col gap-4 p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground group-hover:text-primary">
                  {c.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.ticker} · {c.industry}
                </p>
              </div>
            </div>
            {s?.grade && (
              <Badge variant="outline" className={cn("shrink-0 font-bold", gCls)}>
                {s.grade}
              </Badge>
            )}
          </div>

          {/* Score */}
          {s ? (
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tabular-nums">{s.total_score?.toFixed(1)}</span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.grade_label}</p>
              </div>

              {/* Signal */}
              <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 ring-1 ring-inset", cfg.ring)}>
                <span className="relative flex size-2.5">
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", cfg.dot)} />
                  <span className={cn("relative inline-flex size-2.5 rounded-full", cfg.dot)} />
                </span>
                <span className={cn("text-xs font-medium", cfg.text)}>{cfg.label}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">尚無評分資料</p>
          )}

          {/* E/S/G breakdown */}
          {s && (
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-center">
              {[
                { label: "E 環境", score: s.e_score, weight: "40%" },
                { label: "S 社會", score: s.s_score, weight: "30%" },
                { label: "G 治理", score: s.g_score, weight: "30%" },
              ].map(({ label, score, weight }) => (
                <div key={label}>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn(
                    "text-base font-bold tabular-nums",
                    score != null && score >= 70 ? "text-green-600"
                    : score != null && score >= 50 ? "text-amber-500"
                    : "text-red-600",
                  )}>
                    {score?.toFixed(1) ?? "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">{weight}</p>
                </div>
              ))}
            </div>
          )}

          {/* Footer link */}
          <div className="mt-auto flex items-center justify-end gap-1 text-xs text-muted-foreground group-hover:text-primary">
            查看完整評分卡 <ArrowRight className="size-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function HomePage() {
  let companies: CompanySummary[] = []
  let error: string | null = null

  try {
    const res = await fetchCompanies()
    companies = res.data
  } catch (e) {
    error = e instanceof Error ? e.message : "無法連線至後端 API"
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">公司 ESG 評分總覽</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          台灣上市公司 2023 年度永續報告書 · E 40% + S 30% + G 30% · 指標依 GRI/SASB 框架
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />
          {error} — 請確認後端 API 已啟動（uvicorn api.main:app --port 8000）
        </div>
      )}

      {/* Company cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {companies.length > 0
          ? companies.map((c) => <CompanyCard key={c.name} c={c} />)
          : !error && [0, 1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-lg" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-20" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </CardContent>
              </Card>
            ))
        }
      </div>

      {/* Method note */}
      <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">評分方法學：</span>
        指標正規化依 GRI/SASB，新聞事件扣分仿 TESG ERS（強度 × 時間衰減），
        權重設定檔外部可調（符合歐盟 2026 ESG 評級法規揭露方向）。
        分級門檻：A ≥ 80 · B+ ≥ 70 · B ≥ 60 · B- ≥ 50 · C &lt; 50。
      </div>
    </div>
  )
}
