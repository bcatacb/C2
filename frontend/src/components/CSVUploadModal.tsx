import { useState, useRef, useCallback } from 'react'
import { post } from '../lib/api'
import { Upload, X, FileText, CheckCircle, AlertCircle } from 'lucide-react'

interface CSVUploadModalProps {
  onClose: () => void
  onImported?: () => void
}

interface ParsedRow {
  username: string
  tags?: string
  notes?: string
}

interface ImportResult {
  imported: number
  duplicates: number
  errors: { row: number; username: string; reason: string }[]
  total: number
}

type ModalState = 'idle' | 'preview' | 'importing' | 'result'

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return []

  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i])
    rows.push({
      username: fields[0] || '',
      tags: fields[1] || '',
      notes: fields[2] || '',
    })
  }
  return rows
}

const MAX_ROWS = 10_000

export function CSVUploadModal({ onClose, onImported }: CSVUploadModalProps) {
  const [state, setState] = useState<ModalState>('idle')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Please select a .csv file')
      return
    }

    setError('')
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)

      if (parsed.length > MAX_ROWS) {
        setError(`File contains ${parsed.length.toLocaleString()} rows. Maximum allowed is ${MAX_ROWS.toLocaleString()}.`)
        return
      }

      setRows(parsed)
      setState('preview')
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleImport = async () => {
    setState('importing')
    try {
      const importResult = await post<ImportResult>('/leads/import', { rows })
      setResult(importResult)
      setState('result')
      if (importResult.imported > 0) {
        onImported?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setState('preview')
    }
  }

  const previewRows = rows.slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Import Leads from CSV</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {/* Idle state - drop zone */}
          {state === 'idle' && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors ${
                  dragOver
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <Upload size={36} className="mb-3 text-zinc-500" />
                <p className="text-sm text-zinc-300">
                  Drag & drop a CSV file here, or{' '}
                  <span className="text-blue-400 underline">click to browse</span>
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Expected format: username, tags, notes (max {MAX_ROWS.toLocaleString()} rows)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileInput}
                className="hidden"
              />
              {error && (
                <div className="mt-3 flex items-center gap-2 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Preview state */}
          {state === 'preview' && (
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
                <FileText size={16} className="text-zinc-400" />
                <span>{fileName}</span>
                <span className="text-zinc-500">— {rows.length.toLocaleString()} rows</span>
              </div>

              <div className="overflow-x-auto rounded border border-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-800/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400">Username</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400">Tags</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-zinc-800/50">
                        <td className="px-3 py-1.5 text-white">{row.username}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{row.tags}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{row.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length > 10 && (
                <p className="mt-2 text-xs text-zinc-500">
                  Showing first 10 of {rows.length.toLocaleString()} rows
                </p>
              )}

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Importing state */}
          {state === 'importing' && (
            <div className="flex flex-col items-center py-10">
              <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
              <p className="text-sm text-zinc-300">Importing {rows.length.toLocaleString()} leads...</p>
            </div>
          )}

          {/* Result state */}
          {state === 'result' && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle size={20} />
                <span className="font-medium">Import Complete</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded border border-zinc-800 bg-zinc-800/50 p-3 text-center">
                  <p className="text-2xl font-semibold text-green-400">{result.imported}</p>
                  <p className="text-xs text-zinc-400">Imported</p>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-800/50 p-3 text-center">
                  <p className="text-2xl font-semibold text-yellow-400">{result.duplicates}</p>
                  <p className="text-xs text-zinc-400">Duplicates</p>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-800/50 p-3 text-center">
                  <p className="text-2xl font-semibold text-red-400">{result.errors.length}</p>
                  <p className="text-xs text-zinc-400">Errors</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded border border-zinc-800 bg-zinc-800/30 p-3">
                  <p className="mb-1 text-xs font-medium text-zinc-400">Error details:</p>
                  {result.errors.slice(0, 10).map((err, i) => (
                    <p key={i} className="text-xs text-red-400">
                      Row {err.row}: {err.username || '(empty)'} — {err.reason}
                    </p>
                  ))}
                  {result.errors.length > 10 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      ...and {result.errors.length - 10} more errors
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          {state === 'preview' && (
            <>
              <button
                onClick={() => {
                  setState('idle')
                  setRows([])
                  setFileName('')
                  setError('')
                }}
                className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Import {rows.length.toLocaleString()} Leads
              </button>
            </>
          )}
          {state === 'result' && (
            <button
              onClick={onClose}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Done
            </button>
          )}
          {state === 'idle' && (
            <button
              onClick={onClose}
              className="rounded bg-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
