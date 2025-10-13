const MAP_BUTTON_PLACEHOLDER = "__MAP_PLACEHOLDER__";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(input: string): string {
  const imageHtml: string[] = [];
  const mapBlocks: string[] = [];

  let working = input.replace(/\{\{map-buttons:([^}]+)\}\}/gi, (_, query) => {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (!trimmed) return "";
    const placeholder = `${MAP_BUTTON_PLACEHOLDER}${mapBlocks.length}__`;
    const encoded = encodeURIComponent(trimmed);
    const safeLabel = escapeHtml(trimmed);
    mapBlocks.push(
      `<div class="flex flex-wrap gap-3 pt-2">
        <a
          href="https://www.google.com/maps/search/?api=1&query=${encoded}"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
        >
          Google Maps · ${safeLabel}
        </a>
        <a
          href="https://maps.apple.com/?q=${encoded}"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow hover:bg-slate-100"
        >
          Apple Maps · ${safeLabel}
        </a>
      </div>`
        .replace(/\s{2,}/g, " ")
        .trim(),
    );
    return placeholder;
  });

  working = working.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const token = `__IMAGE_PLACEHOLDER_${imageHtml.length}__`;
    const trimmedSrc = typeof src === "string" ? src.trim() : "";
    if (!trimmedSrc) {
      return token;
    }
    const safeAlt = escapeHtml(alt ?? "");
    const safeSrc = escapeHtml(trimmedSrc);
    imageHtml.push(`<img src="${safeSrc}" alt="${safeAlt}" class="max-w-full rounded-md border" />`);
    return token;
  });

  let result = escapeHtml(working);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  imageHtml.forEach((html, index) => {
    const token = `__IMAGE_PLACEHOLDER_${index}__`;
    while (result.includes(token)) {
      result = result.replace(token, html);
    }
  });

  mapBlocks.forEach((html, index) => {
    const token = `${MAP_BUTTON_PLACEHOLDER}${index}__`;
    while (result.includes(token)) {
      result = result.replace(token, html);
    }
  });

  return result;
}

export function renderTournamentPageContent(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inUnordered = false;
  let inOrdered = false;

  const closeLists = () => {
    if (inUnordered) {
      html.push("</ul>");
      inUnordered = false;
    }
    if (inOrdered) {
      html.push("</ol>");
      inOrdered = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeLists();
      html.push("<p>&nbsp;</p>");
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      closeLists();
      const level = Math.min(6, trimmed.match(/^#+/)?.[0].length ?? 1);
      const text = trimmed.replace(/^#{1,6}\s*/, "");
      html.push(`<h${level}>${formatInlineMarkdown(text)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inUnordered) {
        closeLists();
        html.push("<ul>");
        inUnordered = true;
      }
      const text = trimmed.replace(/^[-*]\s+/, "");
      html.push(`<li>${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOrdered) {
        closeLists();
        html.push("<ol>");
        inOrdered = true;
      }
      const text = trimmed.replace(/^\d+\.\s+/, "");
      html.push(`<li>${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    closeLists();
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  closeLists();
  return html.join("");
}
