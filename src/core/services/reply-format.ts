function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeModelInputText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shouldReformat(text: string): boolean {
  const newlineCount = (text.match(/\n/g) ?? []).length;
  if (newlineCount >= 8) {
    return false;
  }

  return text.length >= 120 || /[━─]{6,}|[①②③④⑤⑥⑦⑧]|[「」『』]/.test(text);
}

export function normalizeAssistantReply(characterName: string, input: string): string {
  let text = normalizeModelInputText(input);
  if (!text) {
    return text;
  }

  const prefixPattern = new RegExp(`^${escapeRegExp(characterName)}\\s*[:：]\\s*`);
  text = text.replace(prefixPattern, "");

  if (!shouldReformat(text)) {
    return text;
  }

  text = text
    .replace(/\s*([━─]{6,})\s*/g, "\n$1\n")
    .replace(/\s*(📍)/g, "\n$1")
    .replace(/\s*(🎯)/g, "\n$1")
    .replace(/\s*(✅)/g, "\n$1")
    .replace(/\s*([①②③④⑤⑥⑦⑧])/g, "\n$1")
    .replace(/([。！？…」』])\s+(?=[「『（A-Za-z0-9\u4e00-\u9fff])/g, "$1\n\n")
    .replace(/([:：])\s+(?=[「『])/g, "$1\n\n")
    .replace(/([」』）])\s+(?=[「『])/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n");

  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
