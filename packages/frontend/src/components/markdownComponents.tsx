import type { ReactMarkdownProps } from 'react-markdown'
import 'highlight.js/styles/github-dark.css'

// Shared component mapping for ReactMarkdown across the app.
// Use with the rich plugin set: remark-gfm + rehype-highlight + rehype-raw.

function Heading1({ children }: ReactMarkdownProps) {
  return (
    <h1 className='text-2xl font-bold text-base-content mb-4 mt-6 border-b border-base-300 pb-2'>
      {children}
    </h1>
  )
}

function Heading2({ children }: ReactMarkdownProps) {
  return <h2 className='text-xl font-semibold text-base-content mt-6 mb-3'>{children}</h2>
}

function Heading3({ children }: ReactMarkdownProps) {
  return <h3 className='text-lg font-semibold text-base-content/90 mt-4 mb-2'>{children}</h3>
}

function Heading4({ children }: ReactMarkdownProps) {
  return <h4 className='text-base font-semibold text-base-content/90 mt-3 mb-2'>{children}</h4>
}

function Heading5({ children }: ReactMarkdownProps) {
  return <h5 className='text-sm font-semibold text-base-content/90 mt-2 mb-1'>{children}</h5>
}

function Heading6({ children }: ReactMarkdownProps) {
  return <h6 className='text-sm font-semibold text-base-content/90 mt-2 mb-1'>{children}</h6>
}

function Paragraph({ children }: ReactMarkdownProps) {
  return <p className='mb-4 leading-relaxed'>{children}</p>
}

function UnorderedList({ children }: ReactMarkdownProps) {
  return <ul className='list-disc list-inside mb-4 space-y-1 pl-2'>{children}</ul>
}

function OrderedList({ children }: ReactMarkdownProps) {
  return <ol className='list-decimal list-inside mb-4 space-y-1 pl-2'>{children}</ol>
}

function ListItem({ children }: ReactMarkdownProps) {
  return <li className='text-base-content/80'>{children}</li>
}

function Blockquote({ children }: ReactMarkdownProps) {
  return (
    <blockquote className='border-l-4 border-primary/40 pl-4 py-1 my-4 bg-base-300/20 rounded-r text-base-content/70 italic'>
      {children}
    </blockquote>
  )
}

function Table({ children }: ReactMarkdownProps) {
  return <table className='w-full mb-4 border-collapse text-sm'>{children}</table>
}

function TableHead({ children }: ReactMarkdownProps) {
  return <thead className='bg-base-300/40'>{children}</thead>
}

function TableHeaderCell({ children }: ReactMarkdownProps) {
  return <th className='border border-base-300 px-3 py-2 text-left font-semibold'>{children}</th>
}

function TableCell({ children }: ReactMarkdownProps) {
  return <td className='border border-base-300 px-3 py-2'>{children}</td>
}

function TableRow({ children }: ReactMarkdownProps) {
  return <tr className='even:bg-base-300/10'>{children}</tr>
}

function ThematicBreak() {
  return <hr className='border-0 border-t border-base-300 my-6' />
}

function InlineCode({ children }: ReactMarkdownProps) {
  return (
    <code className='px-1.5 py-0.5 rounded bg-base-300/60 text-base-content text-sm font-mono'>
      {children}
    </code>
  )
}

function CodeBlock({ children }: ReactMarkdownProps) {
  return (
    <pre className='p-3 rounded-lg bg-base-300/40 border border-base-300 overflow-auto mb-4 text-sm'>
      <code className='font-mono text-sm'>{children}</code>
    </pre>
  )
}

function Strong({ children }: ReactMarkdownProps) {
  return <strong className='font-semibold text-base-content'>{children}</strong>
}

function Emphasis({ children }: ReactMarkdownProps) {
  return <em className='italic'>{children}</em>
}

function Strikethrough({ children }: ReactMarkdownProps) {
  return <del className='line-through text-base-content/60'>{children}</del>
}

function Anchor({ children, href }: ReactMarkdownProps & { href?: string }) {
  return (
    <a
      href={href}
      className='text-primary hover:text-primary/80 underline'
      target='_blank'
      rel='noreferrer'
    >
      {children}
    </a>
  )
}

function Image({ src, alt }: ReactMarkdownProps & { src?: string; alt?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className='max-w-full rounded-lg border border-base-300 my-2'
      loading='lazy'
    />
  )
}

function TaskCheckbox({ checked }: ReactMarkdownProps & { checked?: boolean }) {
  return (
    <input
      type='checkbox'
      checked={checked}
      readOnly
      className='mr-2 accent-primary align-middle'
    />
  )
}

export const markdownComponents = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  p: Paragraph,
  ul: UnorderedList,
  ol: OrderedList,
  li: ListItem,
  blockquote: Blockquote,
  table: Table,
  thead: TableHead,
  th: TableHeaderCell,
  td: TableCell,
  tr: TableRow,
  hr: ThematicBreak,
  code: InlineCode,
  pre: CodeBlock,
  strong: Strong,
  em: Emphasis,
  del: Strikethrough,
  a: Anchor,
  img: Image,
  input: TaskCheckbox,
}
