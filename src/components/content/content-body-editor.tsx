import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import {
  Bold,
  Copy,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
} from 'lucide-react'
import { useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import {
  CHANNEL_TEXT_LIMITS,
  countCharacters,
  hasMarkdownFormatting,
  isMarkdownChannel,
  stripMarkdown,
} from '@/lib/post-text'
import { cn } from '@/lib/utils'

type ContentBodyEditorProps = {
  /** Id of the visible label element ("Texto"). */
  labelId: string
  channel: Channel
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}

/**
 * The item's text, edited the way its channel publishes it (`@/lib/post-text`):
 * a rich-text editor that writes Markdown for the blog; plain text with a
 * character count, a Markdown warning and a copy button for social networks.
 * Switching channel keeps the text; a social channel then offers to strip
 * the formatting.
 */
export function ContentBodyEditor(props: ContentBodyEditorProps) {
  return isMarkdownChannel(props.channel) ? (
    <MarkdownEditor {...props} />
  ) : (
    <PlainPostEditor {...props} />
  )
}

function PlainPostEditor({
  labelId,
  channel,
  value,
  onChange,
  onBlur,
}: ContentBodyEditorProps) {
  const limit = CHANNEL_TEXT_LIMITS[channel]
  const count = countCharacters(value)
  const over = limit !== null && count > limit
  const formatted = hasMarkdownFormatting(value)

  return (
    <div className="grid gap-2">
      <Textarea
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-meta`}
        placeholder={`O texto do post, como vai aparecer no ${CHANNEL_LABELS[channel]}.`}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={over || undefined}
        className="min-h-56 text-[0.9375rem] leading-relaxed"
      />
      <div
        id={`${labelId}-meta`}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"
      >
        {limit !== null ? (
          <span
            className={cn(
              'tabular-nums',
              over ? 'text-destructive font-medium' : 'text-muted-foreground',
            )}
          >
            {count.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}
            {over
              ? ` · ${(count - limit).toLocaleString('pt-BR')} acima do limite do ${CHANNEL_LABELS[channel]}`
              : ''}
          </span>
        ) : null}
        {formatted ? (
          <span className="text-status-draft flex items-center gap-2">
            O {CHANNEL_LABELS[channel]} não mostra formatação: os símbolos vão
            aparecer no post.
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onChange(stripMarkdown(value))}
            >
              <RemoveFormatting data-icon="inline-start" />
              Remover formatação
            </Button>
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!value.trim()}
          onClick={() => void copyText(value)}
        >
          <Copy data-icon="inline-start" />
          Copiar texto
        </Button>
      </div>
    </div>
  )
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Texto copiado.')
  } catch {
    toast.error('Não foi possível copiar. Selecione o texto e copie à mão.')
  }
}

function MarkdownEditor({ labelId, value, onChange, onBlur }: ContentBodyEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Markdown has no underline.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Markdown,
      Placeholder.configure({ placeholder: 'Escreva o post do blog…' }),
    ],
    content: value,
    contentType: 'markdown',
    // The editor page renders in the browser only, but be explicit.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        class:
          'zora-prose min-h-72 px-4 py-3 text-[0.9375rem] leading-relaxed outline-none',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
    onBlur: () => onBlur?.(),
  })

  return (
    <div className="border-input bg-input/30 focus-within:border-ring focus-within:ring-ring/50 overflow-hidden rounded-lg border transition-colors focus-within:ring-3">
      {editor ? <Toolbar editor={editor} /> : <div className="h-10 border-b" />}
      <EditorContent editor={editor} />
    </div>
  )
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      link: current.isActive('link'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
    }),
  })

  const items: Array<{
    key: keyof typeof state
    label: string
    icon: Icon
    run: () => void
  }> = [
    {
      key: 'h2',
      label: 'Título',
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      label: 'Subtítulo',
      icon: Heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bold',
      label: 'Negrito (Ctrl B)',
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Itálico (Ctrl I)',
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'bulletList',
      label: 'Lista',
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      label: 'Lista numerada',
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'blockquote',
      label: 'Citação',
      icon: Quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatação"
      className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
    >
      {items.map(({ key, label, icon: ItemIcon, run }) => (
        <Toggle
          key={key}
          size="sm"
          aria-label={label}
          title={label}
          pressed={state[key]}
          onPressedChange={run}
          // Keep the selection in the editor while clicking.
          onMouseDown={(event) => event.preventDefault()}
        >
          <ItemIcon />
        </Toggle>
      ))}
      <LinkButton editor={editor} active={state.link} />
    </div>
  )
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  function apply() {
    const href = url.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Toggle
          size="sm"
          aria-label="Link"
          title="Link"
          pressed={active}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Link2 />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            // This form sits inside the item form: do not submit that one.
            event.preventDefault()
            event.stopPropagation()
            apply()
          }}
        >
          <Input
            type="url"
            aria-label="Endereço do link"
            placeholder="https://"
            value={url}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" size="sm">
            {url.trim() ? 'Aplicar' : 'Remover'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
