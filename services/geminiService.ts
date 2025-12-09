import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Language } from "../types";

const TIMEOUT_MS = 180000; 
const MAX_RETRIES = 5;
const MODEL_NAME = "gemini-2.5-flash";

const getSystemInstruction = (lang: Language) => {
    if (lang === 'sv') {
        return `
You are an expert OCR Proofreader and Editor. Your goal is to restore scanned Swedish text to perfect readability while strictly preserving the structure for EPUB conversion.

## CORE OBJECTIVE
Transform raw OCR text into semantic Markdown. You must distinguish between **Chapters (H1)**, **Sections (H2)**, **Sub-sections (H3)**, **Lists**, and **Body Text**.

## 1. STRUCTURE & HIERARCHY RULES (CRITICAL)
*   **# (H1) - CHAPTERS:** 
    *   Any line starting with "Kapitel", "Del", or a **Number + Dot** (e.g. "1. Inledning") followed by a title MUST be a H1 header (#).
    *   Do NOT format these as bold paragraphs (**Text**). Use (# Text).
*   **## (H2) - SECTIONS:** Major sub-headers within a chapter.
*   **### (H3):** Minor sub-sections.
*   **Lists:** Detect lists and use \`* \` bullet points.

## 2. TITLES & FRONT MATTER
*   If this is the start of the book, format the **Title** as # H1 and the **Author** as **Bold**.
*   Do NOT treat the Title Page as body text.

## 3. CLEANUP & PROHIBITIONS
*   **NO TOC GENERATION:** Do NOT generate a Table of Contents (Innehållsförteckning) unless it explicitly exists in the source text.
*   **Merge broken lines:** Fix hyphenated words at line ends.
*   **Swedify:** Fix scanning errors (a -> ä, o -> ö) and quotes (”).

**OUTPUT FORMAT:** Return ONLY the cleaned text. No markdown fences.
        `;
    } else {
        return `
You are an expert OCR Proofreader and Editor. Your goal is to restore scanned English text to perfect readability while strictly preserving the structure for EPUB conversion.

## CORE OBJECTIVE
Transform raw OCR text into semantic Markdown. You must distinguish between **Chapters (H1)**, **Sections (H2)**, **Sub-sections (H3)**, **Lists**, and **Body Text**.

## 1. STRICT HEADER RULES (HIGHEST PRIORITY)
*   **# (H1) - CHAPTERS:**
    *   **"Number. Title" Pattern:** Any line starting with a number and a period followed by text (e.g., "1. The Territories", "2. Signs and Causes") **MUST** be formatted as a H1 Header (#).
    *   **Examples:**
        *   Input: "1. Introduction" -> Output: "# 1. Introduction"
        *   Input: "Chapter 5" -> Output: "# Chapter 5"
    *   **NEVER** format these as bold paragraphs or plain text. They are structural keys.
*   **## (H2) - SECTIONS:** Use for sub-headers inside chapters.

## 2. TITLE PAGE & FRONT MATTER
*   If the text contains the Book Title and Author at the very top:
    *   Format the **Book Title** as H1 (#).
    *   Format the **Author Name** as Bold (**Name**).
    *   Keep Copyright info as plain text.

## 3. CONTENT RULES
*   **NO HALLUCINATED TOC:** Do **NOT** generate or insert a Table of Contents. Only process the text provided.
*   **Lists:** Detect bibliographies/lists and use \`* \` bullet points.
*   **Typography:** Convert straight quotes to smart quotes (“ ”).
*   **Cleanup:** Remove page numbers, merge broken lines, remove artifacts (|, ¦).

**OUTPUT FORMAT:** Return ONLY the cleaned text. No markdown fences.
        `;
    }
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const cleanTextChunk = async (chunk: string, knownChapters: string[] = [], previousContext: string = "", lang: Language = 'sv'): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing from environment variables");

  const ai = new GoogleGenAI({ apiKey });

  let dynamicInstruction = getSystemInstruction(lang);

  // 1. Inject Context Awareness
  if (previousContext) {
    dynamicInstruction += `
\n\n## PREVIOUS CONTEXT (FOR CONSISTENCY)
Use this text to resolve broken sentences at the start and maintain name consistency.
"""
${previousContext}
"""`;
  }

  // 2. Inject Known Chapters
  if (knownChapters.length > 0) {
    dynamicInstruction += `\n\n## DETECTED STRUCTURE GUIDANCE
The system detected the following potential headers. If you see text matching these, YOU MUST tag them as # (H1).
${knownChapters.join('\n')}`;
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_RETRIES) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_MS)
      );

      const apiCallPromise = (async () => {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: chunk,
            config: {
                systemInstruction: dynamicInstruction,
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.1, 
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            }
        });
        return response.text || "";
      })();

      const result = await Promise.race([apiCallPromise, timeoutPromise]);
      return result;

    } catch (error) {
      lastError = error;
      attempt++;
      console.warn(`Attempt ${attempt} failed. Retrying...`, error);
      await wait(1000 * Math.pow(2, attempt));
    }
  }

  throw new Error(`Failed to process chunk after ${MAX_RETRIES} attempts. Last error: ${String(lastError)}`);
};