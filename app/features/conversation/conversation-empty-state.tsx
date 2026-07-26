/**
 * 渲染空白草稿的唯一提示；工具能力留在输入框中，避免首屏重复解释。
 */
export function ConversationEmptyState() {
  return (
    <div className="conversation-empty-prompt">
      <h2>从一个问题开始</h2>
      <p>发送首条消息后才会创建对话。可添加文档、图片、音频，或按住麦克风录音。</p>
    </div>
  );
}
