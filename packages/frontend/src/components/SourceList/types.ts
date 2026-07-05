import type { IngestProgressItem } from '../../hooks/useIngestPipeline'

export interface Source {
  id: string
  fileName: string
  type: string
  status: 'pending' | 'processing' | 'ready' | 'error'
  updatedAt: string
  size?: number
}

export interface SourceListProps {
  sources: Source[]
  notebookId?: string
  onDelete?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onEdit?: (id: string) => void | Promise<void>
  onCreateSource?: (type: 'text' | 'markdown') => void | Promise<void>
  onReorder?: (sourceIds: string[]) => void | Promise<void>
  onFilesSelected?: (files: File[]) => void | Promise<void>
  uploadProgress?: IngestProgressItem[]
  onClearErrors?: () => void
}
