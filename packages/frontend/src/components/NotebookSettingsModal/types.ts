export interface NotebookSettingsNotebook {
  id: string
  title: string
  description: string | null
  ai_embedding_model?: string | null
  model_chat?: string | null
  model_summarization?: string | null
  model_ocr?: string | null
  system_prompt?: string | null
  [key: string]: unknown
}

export interface ProviderModels {
  connectionId: string
  connectionName: string
  models: string[]
}
