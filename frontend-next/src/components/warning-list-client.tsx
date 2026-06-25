"use client"

import { AlertTriangle, ExternalLink, Leaf, Newspaper, ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { GreenwashDetail, NewsEvent, Warning } from "@/lib/types"

const riskSeverityConfig = {
  high:   { label: "高", cls: "bg-red-50 text-red-700 ring-red-200",      bar: "bg-red-500" },
  medium: { label: "中", cls: "bg-amber-50 text-amber-700 ring-amber-200", bar: "bg-amber-500" },
  low:    { label: "低", cls: "bg-muted text-muted-foreground ring-border", bar: "bg-muted-foreground/40" },
} as const

interface Props {
  warnings: Warning[]
  reasoning: string | null
  newsEvents: NewsEvent[]
  greenwashDetails: GreenwashDetail[]
}

function NewsCard({ e, isPositive = false }: { e: NewsEvent; isPositive?: boolean }) {
  const bar = isPositive
    ? "bg-emerald-500"
    : e.severity === "critical" || e.severity === "high"
      ? riskSeverityConfig.high.bar
      : riskSeverityConfig.medium.bar

  const badgeCls = isPositive
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : e.severity === "critical" || e.severity === "high"
      ? riskSeverityConfig.high.cls
      : riskSeverityConfig.medium.cls

  const badgeLabel = isPositive ? "正面" : e.severity === "critical" || e.severity === "high" ? "風險高" : "風險中"

  return (
    <div className="relative flex gap-3 rounded-lg border bg-card p-3">
      <span className={cn("absolute inset-y-2 left-0 w-1 rounded-full", bar)} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {isPositive ? <ThumbsUp className="size-4" /> : <Newspaper className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("h-5 px-1.5 text-[11px] font-medium ring-1 ring-inset", badgeCls)}>
            {badgeLabel}
          </Badge>
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">{e.category}</Badge>
        </div>
        <p className="mt-1.5 text-pretty text-sm font-medium leading-snug">{e.title}</p>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{e.date}</span>
          {e.url && (
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              查看來源 <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ScrollableList({ children, count }: { children: React.ReactNode; count: number }) {
  const hasMany = count > 3
  return (
    <div className={cn("relative", hasMany && "overflow-hidden")}>
      <div className={cn("space-y-2.5", hasMany && "max-h-[380px] overflow-y-auto pb-8 scrollbar-thin")}>
        {children}
      </div>
      {hasMany && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent" />
      )}
    </div>
  )
}

export function WarningListClient({ warnings, reasoning, newsEvents, greenwashDetails }: Props) {
  const riskItems = newsEvents.filter(
    (e) => e.severity === "critical" || e.severity === "high" || e.severity === "medium"
  )
  const positiveItems = newsEvents.filter((e) => e.severity === "positive")
  const highCount = warnings.filter((w) => w.level === "high").length
  const riskTotal = warnings.length + riskItems.length + greenwashDetails.length

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-red-600" />
            <CardTitle className="text-base">事件清單</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {highCount > 0 && (
              <Badge variant="destructive" className="tabular-nums">{highCount} 項高風險</Badge>
            )}
          </div>
        </div>
        <CardDescription>負面新聞、漂綠爭議與正面 ESG 事件追蹤</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <Tabs defaultValue="risk">
          <TabsList className="mb-3 w-full">
            <TabsTrigger value="risk" className="flex-1 gap-1.5">
              風險警示
              {riskTotal > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{riskTotal}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="positive" className="flex-1 gap-1.5">
              正面事件
              {positiveItems.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{positiveItems.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="risk" className="mt-0">
            {riskTotal === 0 ? (
              <p className="text-sm text-muted-foreground">目前無重大風險警示</p>
            ) : (
              <ScrollableList count={riskTotal}>
                {riskItems.map((e, i) => (
                  <NewsCard key={`risk-${i}`} e={e} />
                ))}
                {greenwashDetails.map((g, i) => (
                  <div key={`gw-${i}`} className="relative flex gap-3 rounded-lg border bg-card p-3">
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-orange-500" />
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Leaf className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="h-5 border-orange-200 bg-orange-50 px-1.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-200">
                          漂綠爭議
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-pretty text-sm font-medium leading-snug">{g.description}</p>
                      {g.claim_quote && (
                        <p className="mt-1 border-l-2 border-orange-300 pl-2 text-xs italic text-muted-foreground">
                          「{g.claim_quote}」
                        </p>
                      )}
                      {g.source_page && (
                        <p className="mt-1 text-xs text-muted-foreground">報告書第 {g.source_page} 頁</p>
                      )}
                    </div>
                  </div>
                ))}
                {reasoning && (
                  <p className="pt-1 text-xs text-muted-foreground">{reasoning}</p>
                )}
              </ScrollableList>
            )}
          </TabsContent>

          <TabsContent value="positive" className="mt-0">
            {positiveItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前無正面 ESG 事件</p>
            ) : (
              <ScrollableList count={positiveItems.length}>
                {positiveItems.map((e, i) => (
                  <NewsCard key={`pos-${i}`} e={e} isPositive />
                ))}
              </ScrollableList>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
