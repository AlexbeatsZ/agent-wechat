import { escapeHtml, formatBytes, state } from "../state.js";
export function renderModals() {
    const el = document.querySelector('[data-region="modals"]');
    if (!el)
        return;
    el.innerHTML = `
    ${state.filesOpen ? `<div class="modal"><div class="modal-panel"><header><h3>服务器文件</h3><button type="button" data-action="close-files">关闭</button></header><div class="server-files">${state.serverFiles.map((file) => `<a class="server-file" href="/api/files/${encodeURIComponent(file.id)}/download"><strong>${escapeHtml(file.filename)}</strong><span>${formatBytes(file.size)} ${escapeHtml(file.contentType)} ${new Date(file.modifiedAt).toLocaleString()}</span><small>${escapeHtml(file.sourcePathHint)}</small></a>`).join("")}</div></div></div>` : ""}
    ${state.previewImageUrl ? `<div class="modal image-preview-modal" data-action="close-preview"><div class="image-preview-panel"><img src="${state.previewImageUrl}" alt="大图预览"></div></div>` : ""}
  `;
}
