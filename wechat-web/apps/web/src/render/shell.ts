let mounted = false;

export function mountShellOnce(root: HTMLElement): void {
  if (mounted) return;
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="status-line" data-region="status"></div>
        <div data-region="login"></div>
        <div class="toolbar">
          <button type="button" data-action="server-files">服务器文件</button>
          <button type="button" data-action="refresh">刷新</button>
        </div>
        <div data-region="error"></div>
        <div class="chat-list" data-region="chats"></div>
      </aside>
      <main class="conversation">
        <header data-region="conversation-header"></header>
        <div class="messages-wrap">
          <div class="messages" data-region="messages"></div>
          <button type="button" class="new-message-button" data-action="bottom" hidden>新消息</button>
        </div>
        <footer class="composer" data-region="composer">
          <div class="readonly-note" data-region="readonly" hidden></div>
          <textarea id="composer-input" placeholder="输入消息"></textarea>
          <div class="composer-status" data-region="composer-status"></div>
          <div class="composer-actions">
            <button type="button" data-action="pick-image">图片</button>
            <button type="button" data-action="pick-file">文件</button>
            <button type="button" id="send-btn" data-action="send">发送</button>
          </div>
          <input id="file-input" type="file" hidden>
          <input id="image-input" type="file" accept="image/*" hidden>
        </footer>
      </main>
    </div>
    <div data-region="modals"></div>
  `;
  mounted = true;
}
