import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AssistantMarkdownProps = {
  content: string;
};

/**
 * AI 回复的受限 Markdown 渲染器。
 * 原始 HTML 会被跳过，链接也不会继承页面权限，避免模型输出注入可执行节点。
 */
export function AssistantMarkdown({ content }: AssistantMarkdownProps) {
  return (
    <div className="conversation-assistant-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer noopener" target="_blank">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
