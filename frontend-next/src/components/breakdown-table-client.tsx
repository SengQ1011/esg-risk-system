"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { MapPin } from "lucide-react"
import type { IndicatorBreakdownItem } from "@/lib/types"

// pdfjs-dist references DOMMatrix at module scope — must be browser-only
const PdfViewerModal = dynamic(
  () => import("./pdf-viewer-modal").then((m) => m.PdfViewerModal),
  { ssr: false },
)

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const INDICATOR_LABELS: Record<string, string> = {
  ghg_scope1: "溫室氣體 Scope 1",
  ghg_scope2: "溫室氣體 Scope 2",
  ghg_scope3: "溫室氣體 Scope 3",
  carbon_intensity: "碳排放強度",
  electricity: "用電量",
  renewable_ratio: "再生能源佔比",
  water: "用水量",
  waste: "廢棄物產生量",
  injury_rate: "職災率 (TRIR)",
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

interface ModalState {
  isOpen: boolean
  page: number
  bbox: [number, number, number, number] | null
  label: string
  rawValue: string | null
  unit: string | null
}

const CLOSED_MODAL: ModalState = {
  isOpen: false,
  page: 1,
  bbox: null,
  label: "",
  rawValue: null,
  unit: null,
}

interface BreakdownTableClientProps {
  items: IndicatorBreakdownItem[]
  companyName: string
}

export function BreakdownTableClient({ items, companyName }: BreakdownTableClientProps) {
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL)

  const pdfUrl = `${BASE_URL}/api/pdf/${encodeURIComponent(companyName)}`

  const openModal = (item: IndicatorBreakdownItem) => {
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="pb-2 pr-3 font-medium">指標</th>
            <th className="pb-2 pr-3 text-right font-medium">原始值</th>
            <th className="pb-2 pr-3 text-right font-medium">正規化</th>
            <th className="pb-2 text-right font-medium">貢獻分</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const label = INDICATOR_LABELS[item.key] ?? item.key
            // false = 「沒有設立」，沒有頁面可指向；null/0 照正常邏輯
            const isBooleanFalse = item.raw_value === false
            const clickable = !!item.pdf_page && !item.missing && !isBooleanFalse

            return (
              <tr
                key={item.key}
                onClick={() => openModal(item)}
                className={[
                  "border-b last:border-0 transition-colors",
                  clickable
                    ? "cursor-pointer hover:bg-yellow-50"
                    : "cursor-default",
                ].join(" ")}
              >
                <td className="py-1.5 pr-3 text-gray-700">
                  <div className="flex items-center gap-1.5">
                    {label}
                    {item.missing && (
                      <span className="text-[10px] text-orange-500">(缺失)</span>
                    )}
                    {clickable && (
                      <MapPin className="size-3 shrink-0 text-yellow-500" />
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-500">
                  {item.raw_value != null
                    ? `${item.raw_value}${item.unit ? ` ${item.unit}` : ""}`
                    : "—"}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-500">
                  {item.normalized != null
                    ? `${(item.normalized * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td className="py-1.5 text-right font-medium text-gray-800">
                  {(item.contribution * 100).toFixed(2)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <PdfViewerModal
        isOpen={modal.isOpen}
        onClose={() => setModal(CLOSED_MODAL)}
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
