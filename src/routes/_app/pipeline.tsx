import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'

// Placeholder. The pipeline board is built on the data layer in
// src/lib/content.queries.ts (see AGENTS.md).
export const Route = createFileRoute('/_app/pipeline')({
  head: () => ({ meta: [{ title: 'Pipeline · Zora' }] }),
  component: PipelinePage,
})

function PipelinePage() {
  return (
    <PageHeader
      title="Pipeline"
      description="The status board will appear here."
    />
  )
}
