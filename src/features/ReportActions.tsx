import { useState } from 'react'
import { Check, FileJson, FileSpreadsheet, Printer } from 'lucide-react'
import type { AppData } from '../domain/model'
import type { AnalyticsFilters } from '../domain/analytics'
import { downloadFile } from '../lib/storage'
import { buildReport, printReport, reportFileName, reportToCSV, reportToJSON } from '../lib/reports'
import './report.css'

export interface ReportActionsProps {
  data: AppData
  sessionId?: string
  scopeLabel?: string
  filters?: AnalyticsFilters
  rankBy?: 'wins' | 'rate' | 'rating' | 'performance' | 'credit'
}

export function ReportActions({
  data,
  sessionId,
  scopeLabel,
  filters,
  rankBy,
}: ReportActionsProps) {
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  const exportReport = (format: 'pdf' | 'json' | 'csv') => {
    setFeedback('')
    setFailed(false)
    try {
      const report = buildReport(data, { sessionId, scopeLabel, filters, rankBy })
      if (format === 'pdf') {
        if (!printReport(report)) {
          setFailed(true)
          setFeedback('Allow popups for RallySync to open the printable report, then try again.')
          return
        }
        setFeedback('Printable report opened. Choose Save as PDF in the print dialog.')
      } else {
        downloadFile(
          reportFileName(report, format),
          format === 'json' ? reportToJSON(report) : reportToCSV(report),
          format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
        )
        setFeedback(
          `${format.toUpperCase()} report download started. It includes this view’s selected scope.`,
        )
      }
    } catch (caught) {
      setFailed(true)
      setFeedback(
        caught instanceof Error
          ? caught.message
          : 'The report could not be prepared. Your history has not changed.',
      )
    }
  }
  return (
    <div
      className="report-tools"
      aria-label={scopeLabel ? `Export ${scopeLabel}` : 'Export results'}
    >
      <div className="report-actions">
        <button
          className="report-button primary"
          onClick={() => exportReport('pdf')}
          title="Open a printable report, then choose Save as PDF"
        >
          <Printer size={16} /> Save PDF
        </button>
        <button
          className="report-button"
          onClick={() => exportReport('json')}
          title="Download structured analysis for this scope"
        >
          <FileJson size={16} /> JSON
        </button>
        <button
          className="report-button"
          onClick={() => exportReport('csv')}
          title="Download spreadsheet results for this scope"
        >
          <FileSpreadsheet size={16} /> CSV
        </button>
      </div>
      {feedback && (
        <p
          className={`report-feedback ${failed ? 'error' : ''}`}
          role={failed ? 'alert' : 'status'}
        >
          {!failed && <Check size={14} />}
          <span>{feedback}</span>
        </p>
      )}
    </div>
  )
}

export default ReportActions
