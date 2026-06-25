"use client"

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, MapPin } from "lucide-react"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()


interface PdfViewerModalProps {
  isOpen: boolean
  onClose: () => void
  pdfUrl: string
  indicatorPage: number
  bbox: [number, number, number, number][] | null  // list of bboxes，支援多個 highlight
  indicatorLabel: string
  rawValue: string | null
  unit: string | null
}

const ZOOM_STEPS = [0.6, 0.75, 1.0, 1.25, 1.5, 2.0]
const DEFAULT_ZOOM_IDX = 2
const BASE_WIDTH = 700

export function PdfViewerModal({
  isOpen,
  onClose,
  pdfUrl,
  indicatorPage,
  bbox,
  indicatorLabel,
  rawValue,
  unit,
}: PdfViewerModalProps) {
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(indicatorPage)
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX)
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number } | null>(null)
  const [baseWidth, setBaseWidth] = useState(700)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // modal 開啟時量測 scroll area 寬度，讓 PDF 頁面填滿 viewer，不留灰色空白
  useLayoutEffect(() => {
    if (isOpen && scrollAreaRef.current) {
      const w = scrollAreaRef.current.clientWidth - 32  // 扣除 p-4 (16px×2)
      setBaseWidth(Math.max(400, w))
    }
  }, [isOpen])

  // useMemo 確保 object reference 穩定，避免 react-pdf 誤判 options 變更而重載 PDF
  const pdfOptions = useMemo(() => ({
    cMapUrl: "/cmaps/",
    cMapPacked: true,
  }), [])

  const pageWidth = baseWidth * ZOOM_STEPS[zoomIdx]

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(indicatorPage)
      setCanvasDims(null)
    }
  }, [isOpen, indicatorPage])

  // reset canvas dims when page changes so stale bbox doesn't flash
  useEffect(() => {
    setCanvasDims(null)
  }, [currentPage])

  // 頁面渲染完成後，自動橫向捲動使 highlight 置中
  // 解決 A3 2-up 寬頁面（如中鋼）右側出現大片空白的問題
  useEffect(() => {
    if (!canvasDims || !bbox || !scrollAreaRef.current) return
    if (currentPage !== indicatorPage) return

    const scrollEl = scrollAreaRef.current
    // 用第一個 bbox 的水平中心做橫向自動捲動
    const b0 = bbox[0]
    const highlightCenterX = (b0[0] + b0[2]) / 2 * canvasDims.w
    const containerLeft    = containerRef.current?.offsetLeft ?? 0
    const viewportHalf     = scrollEl.clientWidth / 2
    scrollEl.scrollLeft    = containerLeft + highlightCenterX - viewportHalf
  }, [canvasDims, bbox, currentPage, indicatorPage])

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
  }, [])

  const onPageRenderSuccess = useCallback(() => {
    const canvas = containerRef.current?.querySelector("canvas")
    if (canvas) {
      setCanvasDims({ w: canvas.offsetWidth, h: canvas.offsetHeight })
    }
  }, [])

  const goToPrev = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), [])
  const goToNext = useCallback(() => setCurrentPage((p) => Math.min(numPages, p + 1)), [numPages])
  const zoomIn = useCallback(() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)), [])
  const zoomOut = useCallback(() => setZoomIdx((i) => Math.max(0, i - 1)), [])

  const showBbox = bbox && canvasDims && currentPage === indicatorPage

  // DEBUG — 確認 bbox 格式正確，可在 console 看到
  if (process.env.NODE_ENV === 'development' && bbox !== null) {
    console.log('[PdfViewer] bbox:', JSON.stringify(bbox), 'showBbox:', !!showBbox, 'canvasDims:', canvasDims)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <MapPin className="size-4 text-yellow-500" />
            <div>
              <div className="font-semibold text-gray-900">{indicatorLabel}</div>
              {rawValue != null && (
                <div className="text-xs text-gray-500">
                  數值：{rawValue}
                  {unit ? ` ${unit}` : ""} · 第 {indicatorPage} 頁
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* PDF Viewer */}
        <div ref={scrollAreaRef} className="flex-1 overflow-auto bg-gray-200 p-4">
          <div className="min-w-max">
            <div ref={containerRef} className="relative mx-auto shadow-xl">
              <Document
                file={pdfUrl}
                options={pdfOptions}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div
                    style={{ width: pageWidth, height: 900 }}
                    className="flex items-center justify-center rounded bg-white text-sm text-gray-400"
                  >
                    載入 PDF 中…
                  </div>
                }
                error={
                  <div
                    style={{ width: pageWidth, height: 900 }}
                    className="flex items-center justify-center rounded bg-white text-sm text-red-400"
                  >
                    PDF 載入失敗，請確認後端服務是否啟動
                  </div>
                }
              >
                <Page
                  pageNumber={currentPage}
                  width={pageWidth}
                  onRenderSuccess={onPageRenderSuccess}
                  loading={
                    <div
                      style={{ width: pageWidth, height: 900 }}
                      className="animate-pulse rounded bg-gray-300"
                    />
                  }
                />
              </Document>

              {/* bbox highlight overlays — 支援多個獨立框（如 source_text 含多個數值） */}
              {showBbox && (() => {
                const PAD_X = 4
                const PAD_Y = 3
                return bbox.map((b, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute bg-yellow-300/50"
                    style={{
                      left:   b[0] * canvasDims.w - PAD_X,
                      top:    b[1] * canvasDims.h - PAD_Y,
                      width:  (b[2] - b[0]) * canvasDims.w + PAD_X * 2,
                      height: (b[3] - b[1]) * canvasDims.h + PAD_Y * 2,
                    }}
                  />
                ))
              })()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-gray-50 px-5 py-2.5">
          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={zoomIdx === 0}
              className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
            >
              <ZoomOut className="size-4" />
            </button>
            <span className="w-12 text-center text-xs text-gray-500">
              {Math.round(ZOOM_STEPS[zoomIdx] * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
            >
              <ZoomIn className="size-4" />
            </button>
          </div>

          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrev}
              disabled={currentPage <= 1}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
            >
              <ChevronLeft className="size-5" />
            </button>
            <span className="min-w-[80px] text-center text-sm text-gray-600">
              {currentPage} / {numPages || "…"}
            </span>
            <button
              onClick={goToNext}
              disabled={currentPage >= numPages}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Jump back to indicator page */}
          {currentPage !== indicatorPage && numPages > 0 && (
            <button
              onClick={() => setCurrentPage(indicatorPage)}
              className="text-xs text-yellow-600 hover:underline"
            >
              跳回第 {indicatorPage} 頁
            </button>
          )}
          {currentPage === indicatorPage && <div className="w-24" />}
        </div>
      </div>
    </div>
  )
}
