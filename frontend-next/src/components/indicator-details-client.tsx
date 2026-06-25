"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, FileText, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { IndicatorBreakdownItem, ScoreBreakdown } from "@/lib/types"

const PdfViewerModal = dynamic(
  () => import("./pdf-viewer-modal").then((m) => m.PdfViewerModal),
  { ssr: false },
)

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const INDICATOR_LABELS: Record<string, string> = {
  ghg_scope1: "範疇一溫室氣體排放",
  ghg_scope2: "範疇二溫室氣體排放",
  ghg_scope3: "範疇三溫室氣體排放",
  carbon_intensity: "碳排放強度",
  electricity: "用電量",
  renewable_ratio: "再生能源佔比",
  water: "用水量",
  waste: "廢棄物產生量",
  injury_rate: "職災率（TRIR）",
  turnover: "員工離職率",
  female_ratio: "女性員工比例",
  female_mgmt_ratio: "女性管理層比例",
  training_hours: "年均培訓時數",
  independent_director_ratio: "獨立董事比例",
  female_director_ratio: "女性董事比例",
  has_sustainability_officer: "設有永續長",
  assurance: "第三方驗證",
  violations: "違規次數",
}

const DIM_CONFIG = {
  E: { label: "E", fullLabel: "環境 Environment", accent: "text-green-600" },
  S: { label: "S", fullLabel: "社會 Social",       accent: "text-blue-600" },
  G: { label: "G", fullLabel: "治理 Governance",   accent: "text-purple-600" },
} as const

interface ModalState {
  isOpen: boolean
  page: number
  bbox: [number, number, number, number][] | null
  label: string
  rawValue: string | null
  unit: string | null
}

const CLOSED: ModalState = { isOpen: false, page: 1, bbox: null, label: "", rawValue: null, unit: null }

function formatValue(item: IndicatorBreakdownItem): string {
  if (item.missing || item.raw_value == null) return "未揭露"
  if (typeof item.raw_value === "boolean") return item.raw_value ? "是" : "否"
  if (item.raw_value === 0) return "0"
  return Number(item.raw_value).toLocaleString()
}

function TrendIcon({ score }: { score: number | null }) {
  if (score == null) return <Minus className="size-3.5 text-muted-foreground" />
  if (score >= 0.7) return <ArrowUpRight className="size-3.5 text-green-600" />
  if (score >= 0.4) return <Minus className="size-3.5 text-amber-500" />
  return <ArrowDownRight className="size-3.5 text-red-600" />
}

interface Props {
  breakdown: ScoreBreakdown
  companyName: string
}

export function IndicatorDetailsClient({ breakdown, companyName }: Props) {
  const [modal, setModal] = useState<ModalState>(CLOSED)

  const pdfUrl = `${BASE_URL}/api/pdf/${encodeURIComponent(companyName)}`

  const dims = useMemo(() =>
    (["E", "S", "G"] as const).map((dim) => {
      const items = breakdown[dim] ?? []
      const missing = items.filter((i) => i.missing).length
      return { dim, items, missing }
    }),
  [breakdown])

  function openModal(item: IndicatorBreakdownItem) {
    if (!item.pdf_page || item.missing || item.raw_value === false) return
    setModal({
      isOpen: true,
      page: item.pdf_page,
      bbox: item.bbox,
      label: INDICATOR_LABELS[item.key] ?? item.key,
      rawValue: item.raw_value != null ? String(item.raw_value) : null,
      unit: item.unit,
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ESG 指標明細</CardTitle>
          <CardDescription>各維度量化指標、數值與報告書來源頁碼，點擊頁碼可開啟 PDF</CardDescription>
        </CardHeader>
        <CardContent>
          {/* @ts-expect-error shadcn Accordion type prop mismatch */}
          <Accordion type="multiple" defaultValue={["E", "S", "G"]} className="w-full">
            {dims.map(({ dim, items, missing }) => {
              const cfg = DIM_CONFIG[dim]
              const dimScore = items.reduce((s, i) => s + i.contribution, 0) * 100

              return (
                <AccordionItem key={dim} value={dim} className="border-b last:border-b-0">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex size-8 items-center justify-center rounded-md border bg-muted/50 text-sm font-bold",
                            cfg.accent,
                          )}
                        >
                          {cfg.label}
                        </span>
                        <div className="text-left">
                          <span className="text-sm font-medium">{cfg.fullLabel}</span>
                          <p className="text-xs text-muted-foreground">{items.length} 項指標</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {missing > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="size-3" />
                            {missing} 項未揭露
                          </Badge>
                        )}
                        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                          {dimScore.toFixed(1)}
                          <span className="text-xs font-normal">/100</span>
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent>
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="w-[40%]">指標名稱</TableHead>
                            <TableHead className="text-right">數值</TableHead>
                            <TableHead>單位</TableHead>
                            <TableHead className="w-12 text-center">評分</TableHead>
                            <TableHead className="text-right">來源頁碼</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => {
                            const label = INDICATOR_LABELS[item.key] ?? item.key
                            const canClick = !!item.pdf_page && !item.missing && item.raw_value !== false

                            return (
                              <TableRow
                                key={item.key}
                                className={cn(!item.missing ? "" : "bg-red-50/50")}
                              >
                                <TableCell className="font-medium">
                                  <span className="flex items-center gap-2">
                                    {label}
                                    {item.missing && (
                                      <Badge
                                        variant="outline"
                                        className="h-5 border-red-200 bg-red-50 px-1.5 text-[10px] text-red-600"
                                      >
                                        未揭露
                                      </Badge>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono tabular-nums",
                                    item.missing ? "text-muted-foreground" : "",
                                  )}
                                >
                                  {formatValue(item)}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.unit ?? "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <span className="inline-flex justify-center">
                                    <TrendIcon score={item.normalized} />
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  {canClick ? (
                                    <button
                                      type="button"
                                      onClick={() => openModal(item)}
                                      className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                                    >
                                      <FileText className="size-3" />
                                      p.{item.pdf_page}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </CardContent>
      </Card>

      <PdfViewerModal
        isOpen={modal.isOpen}
        onClose={() => setModal(CLOSED)}
        pdfUrl={pdfUrl}
        indicatorPage={modal.page}
        bbox={modal.bbox}
        indicatorLabel={modal.label}
        rawValue={modal.rawValue}
        unit={modal.unit}
      />
    </>
  )
}
