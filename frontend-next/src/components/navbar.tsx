import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <div className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">ESG RiskLens</span>
            <span className="block text-xs text-muted-foreground">企業永續風險評分平台</span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              公司列表
            </Link>
            <Link
              href="/compare"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              三家比較
            </Link>
          </nav>
          <Badge variant="outline" className="hidden font-normal sm:inline-flex">
            評估方法論 v2.0
          </Badge>
        </div>
      </div>
    </header>
  )
}
