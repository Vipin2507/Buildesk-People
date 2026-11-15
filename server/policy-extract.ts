import mammoth from "mammoth";
import type { PolicyRenderStatus } from "../src/types.ts";
import { contentTypeForName } from "./policies-store.ts";

export type ExtractResult = {
  ok: boolean;
  content: string;
  contentHtml: string | null;
  renderStatus: PolicyRenderStatus;
  message: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Light sanitize: keep document structure tags only. */
export function sanitizePolicyHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
  // Drop unknown tags while keeping inner text for safety-critical ones.
  out = out.replace(/<\/?(?!\/?(?:p|br|strong|em|b|i|u|ul|ol|li|h[1-6]|table|thead|tbody|tr|th|td|a|span|div)\b)[^>]+>/gi, "");
  return out.trim();
}

export async function extractPolicyDocument(bytes: Buffer, fileName: string): Promise<ExtractResult> {
  const lower = fileName.toLowerCase();
  const type = contentTypeForName(fileName);

  if (lower.endsWith(".txt") || type.startsWith("text/plain")) {
    const text = bytes.toString("utf8").trim();
    if (!text) {
      return { ok: false, content: "", contentHtml: null, renderStatus: "unavailable", message: "Text file was empty." };
    }
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("");
    return { ok: true, content: text, contentHtml: escaped, renderStatus: "ready", message: "Text extracted." };
  }

  if (lower.endsWith(".docx") || type.includes("wordprocessingml")) {
    try {
      const result = await mammoth.convertToHtml({ buffer: bytes }, {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1:fresh",
        ],
      });
      const html = sanitizePolicyHtml(result.value || "");
      const text = stripHtml(html);
      if (!text || text.length < 40) {
        return {
          ok: false,
          content: text,
          contentHtml: html || null,
          renderStatus: "unavailable",
          message: "DOCX extraction produced little or no readable text. Keep Needs review and use the original file.",
        };
      }
      const partial = result.messages.some((item) => item.type === "warning");
      return {
        ok: true,
        content: text,
        contentHtml: html,
        renderStatus: partial ? "partial" : "ready",
        message: partial ? "DOCX extracted with warnings; review formatting before publish." : "DOCX extracted for in-app reading.",
      };
    } catch (error) {
      return {
        ok: false,
        content: "",
        contentHtml: null,
        renderStatus: "unavailable",
        message: error instanceof Error ? error.message : "DOCX extraction failed.",
      };
    }
  }

  if (lower.endsWith(".pdf") || type === "application/pdf") {
    return {
      ok: false,
      content: "",
      contentHtml: null,
      renderStatus: "unavailable",
      message: "PDF in-app text extraction is not configured. Employees can download the original after publish; paste text or convert to DOCX for in-app reading.",
    };
  }

  if (lower.endsWith(".doc")) {
    return {
      ok: false,
      content: "",
      contentHtml: null,
      renderStatus: "unavailable",
      message: "Legacy .doc is not supported for in-app extraction. Save as .docx or paste the policy text.",
    };
  }

  return {
    ok: false,
    content: "",
    contentHtml: null,
    renderStatus: "unavailable",
    message: "Unsupported document type for in-app rendering.",
  };
}
