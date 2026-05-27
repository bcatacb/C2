// Placeholder - full implementation in task 6.2
interface CSVUploadModalProps {
  onClose: () => void
  onImported: () => void
}

export function CSVUploadModal({ onClose, onImported }: CSVUploadModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Import CSV</h2>
        <p className="text-sm text-zinc-400 mb-4">CSV upload modal — full implementation coming soon.</p>
        <button
          onClick={onClose}
          className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-600"
        >
          Close
        </button>
      </div>
    </div>
  )
}
