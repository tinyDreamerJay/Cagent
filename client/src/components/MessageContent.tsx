import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export function MessageContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre: ({ children }) => <pre className="md-pre">{children}</pre>,
        code: ({ className, children, ...props }) => {
          const isInline = !className
          return isInline
            ? <code className="md-inline-code">{children}</code>
            : <code className={className} {...props}>{children}</code>
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
