import type { Metadata } from "next"
import { JobProgressClient } from "./job-progress-client"

export const metadata: Metadata = {
  title: "分析進度 — ESG 風險評分系統",
}

interface PageProps {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ company?: string }>
}

export default async function JobPage({ params, searchParams }: PageProps) {
  const { jobId }    = await params
  const { company }  = await searchParams
  const companyName  = company ? decodeURIComponent(company) : ""

  return <JobProgressClient jobId={jobId} initialCompanyName={companyName} />
}
