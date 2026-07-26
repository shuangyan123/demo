/**
 * 渲染空白草稿的唯一提示；工具能力留在输入框中，避免首屏重复解释。
 */
export function ConversationEmptyState() {
  return (
    <div className="conversation-empty-prompt">
      <h2>从一个问题开始</h2>
    </div>
  );
}
