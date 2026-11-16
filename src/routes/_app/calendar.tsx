import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'

// Placeholder. The calendar UI is built on the data layer in
// src/lib/content.queries.ts (see AGENTS.md).
export const Route = createFileRoute('/_app/calendar')({
  head: () => ({ meta: [{ title: 'Calendar · Zora' }] }),
  component: CalendarPage,
})

function CalendarPage() {
  return (
    <PageHeader
      title="Calendar"
      description="The content calendar will appear here."
    />
  )
}
