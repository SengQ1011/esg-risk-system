import type {
  CompaniesResponse,
  CompanyDetailResponse,
  DashboardResponse,
  HistoryResponse,
  AnalyzeResponse,
} from "./types"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchCompanies(): Promise<CompaniesResponse> {
  return apiFetch<CompaniesResponse>("/api/companies")
}

export interface PdfCandidate {
  url: string
  label: string
  local: boolean
}

export interface SearchPdfResult {
  candidates: PdfCandidate[]
  hint: string
}

export async function searchCompanyPdf(
  company: string,
  year: number,
  ticker = "",
): Promise<SearchPdfResult> {
  const params = new URLSearchParams({ company, year: String(year), ticker })
  const res = await apiFetch<{ status: string; data: SearchPdfResult }>(
    `/api/search-pdf?${params}`,
  )
  return res.data
}

export async function fetchCompanyDetail(name: string): Promise<CompanyDetailResponse> {
  return apiFetch<CompanyDetailResponse>(`/api/company/${encodeURIComponent(name)}`)
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/api/dashboard")
}

export async function fetchHistory(name: string): Promise<HistoryResponse> {
  return apiFetch<HistoryResponse>(`/api/company/${encodeURIComponent(name)}/history`)
}

/** POST /api/company/analyze — multipart/form-data */
export async function analyzeCompany(
  companyName: string,
  file?: File,
  reportUrl?: string,
  year: number = 2023,
): Promise<AnalyzeResponse> {
  const form = new FormData()
  if (companyName) form.append("company_name", companyName)
  form.append("year", String(year))
  if (file) form.append("pdf_file", file)
  if (reportUrl) form.append("report_url", reportUrl)

  const res = await fetch(`${BASE_URL}/api/company/analyze`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  const json = await res.json()
  return json.data as AnalyzeResponse
}

/** localStorage key for PiP active jobs (JSON array of PipJob) */
export const PIP_KEY = "esg_active_job"

export interface PipJob {
  jobId: string
  companyName: string
}

export function getPipJobs(): PipJob[] {
  try {
    const raw = localStorage.getItem(PIP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // backward compat: single object → wrap in array
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

export function addPipJob(job: PipJob): void {
  const jobs = getPipJobs().filter(j => j.jobId !== job.jobId)
  localStorage.setItem(PIP_KEY, JSON.stringify([...jobs, job]))
}

export function removePipJob(jobId: string): void {
  const jobs = getPipJobs().filter(j => j.jobId !== jobId)
  if (jobs.length === 0) {
    localStorage.removeItem(PIP_KEY)
  } else {
    localStorage.setItem(PIP_KEY, JSON.stringify(jobs))
  }
}

/** DELETE /api/job/{jobId} — cancel analysis */
export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/job/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

/** DELETE /api/company/{name} */
export async function deleteCompany(name: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/company/${encodeURIComponent(name)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

/** GET /api/job/{jobId} — polling fallback */
export async function fetchJobStatus(jobId: string) {
  const res = await fetch(`${BASE_URL}/api/job/${jobId}`, { cache: "no-store" })
  if (!res.ok) return null
  const json = await res.json()
  return json.data as {
    job_id: string
    company_name: string
    status: string       // pending | running | done | error
    current_step: string
    progress: number
    error_message: string | null
  }
}

/** WebSocket URL：http → ws，https → wss */
export function getWsUrl(path: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}${path}`
}
