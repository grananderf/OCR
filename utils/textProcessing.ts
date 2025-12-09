import { diffWords } from 'diff';
import { Language } from '../types';

export const readFileContent = (file: File, encoding: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file content'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, encoding);
  });
};

export const detectChapters = (text: string, lang: Language = 'sv'): string[] => {
  const chapters: string[] = [];
  const lines = text.split('\n');
  
  // Regex for common headers based on language
  // SV: Kapitel, Del, Avdelning, Bok
  // EN: Chapter, Part, Section, Book OR "1. Title" format
  const keywordPattern = lang === 'sv' 
    ? /^(?:kapitel|del|avdelning|bok)\s+\d+.*$/i
    : /^(?:chapter|part|section|book)\s+\d+.*$|^\d+\.\s+[A-Z].*$/m;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length > 80) continue; 

    // Check 1: Explicit Keyword + Number OR "1. Title" format
    if (keywordPattern.test(trimmed)) {
        chapters.push(trimmed);
        continue;
    }

    // Check 2: All Caps logic
    // We ignore lines that look like page numbers or purely symbols
    if (
        trimmed.length >= 3 && 
        trimmed === trimmed.toUpperCase() && 
        /[A-ZÅÄÖ]/.test(trimmed) &&
        !trimmed.endsWith('.')
    ) {
        chapters.push(trimmed);
        continue;
    }
  }
  return [...new Set(chapters)];
};

export const cleanStructureList = (text: string): string => {
  return text.split('\n').map(line => {
    let clean = line.trim();
    if (!clean) return '';

    // 1. Remove leading bullets/dashes often found in TOCs
    clean = clean.replace(/^[-•*]\s*/, '');

    // 2. Fix specific OCR typos
    clean = clean.replace(/\b01ch\b/gi, 'och');

    // 3. Remove trailing page numbers safely (requires dots or multiple spaces)
    clean = clean.replace(/(?:\.{2,}|…|\s{2,})\d+$/, '');

    return clean;
  }).filter(l => l.length > 0).join('\n');
};

export const preCleanText = (text: string): string => {
  let cleaned = text;
  // 1. Fix "Intra-word artifacts"
  cleaned = cleaned.replace(/(?<=[a-zA-ZåäöÅÄÖ])\.(?=[a-zA-ZåäöÅÄÖ])/g, '');
  // 2. Remove common OCR garbage
  cleaned = cleaned.replace(/[♦¦|]/g, '');
  return cleaned;
};

export const postCleanText = (text: string, lang: Language = 'sv'): string => {
  let cleaned = text;

  // STEP 1: STUTTERING / DUPLICATION FIXES
  cleaned = cleaned.replace(/(\w+)\s*\.\s*(\w+)/g, (match, p1, p2) => {
      if (p1.toLowerCase().endsWith(p2.toLowerCase())) {
          return p1;
      }
      return match;
  });

  cleaned = cleaned.replace(/(\w+)\s*\.\s*(\1\w*)/gi, '$2');

  // STEP 2: LANGUAGE SPECIFIC FIXES
  if (lang === 'sv') {
      const replacements: Record<string, string> = {
          'evalverade': 'evolverade',
          'tillhande': 'tillhörande',
          'skenankar': 'skentankar',
          'ertagen': 'övertagen',
          'varseblivningsrören': 'varseblivningsmönstren',
          'skån': 'mån', 
          'gungande beställningen': 'gungande böneställningen',
          'lyssnartill': 'lyssnar till',
      };

      for (const [key, value] of Object.entries(replacements)) {
          const regex = new RegExp(`\\b${key}\\b`, 'gi');
          cleaned = cleaned.replace(regex, value);
      }
      
      // Phrase fixes (Swedish)
      cleaned = cleaned.replace(/\bförser ge\b/gi, 'försöker ge');
      
      // Swedish quotes (Right double quote for everything typically)
      cleaned = cleaned.replace(/["'']+(?=[a-zA-ZåäöÅÄÖ])/g, '”'); 
      cleaned = cleaned.replace(/(?<=[a-zA-ZåäöÅÄÖ])["'']+/g, '”');
  } else {
      // ENGLISH FIXES
      // Fix specific English OCR artifacts if needed
      
      // English Smart Quotes
      // Opening quote (followed by letter)
      cleaned = cleaned.replace(/(^|\s)["'](?=[a-zA-Z])/g, '$1“');
      // Closing quote (after letter or punctuation)
      cleaned = cleaned.replace(/(?<=[a-zA-Z.,!?])["'](?=\s|[.,!?]|$)/g, '”');
  }

  // STEP 3: CLEANUP ARTIFACTS
  
  // Aggressive removal of dot-in-word
  cleaned = cleaned.replace(/(?<=[a-zA-ZåäöÅÄÖ])\.(?=[a-zA-ZåäöÅÄÖ])/g, '');

  // Aggressive removal of standalone page numbers
  cleaned = cleaned.replace(/^\s*-?\s*\d+\s*-?\s*$/gm, '');
  
  // Remove Tab characters
  cleaned = cleaned.replace(/\t/g, '');
  
  // Remove Soft Hyphens
  cleaned = cleaned.replace(/[\u00AD\u200B]/g, '');
  
  // Normalize double spaces
  cleaned = cleaned.replace(/  +/g, ' ');
  
  // Normalize massive line breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned;
};

export const chunkText = (text: string, size: number = 1500): string[] => {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (index + size >= text.length) {
      chunks.push(text.slice(index));
      break;
    }
    let end = index + size;
    const lastParagraphBreak = text.lastIndexOf('\n\n', end);
    const lastPeriod = text.lastIndexOf('.', end);
    const lastNewLine = text.lastIndexOf('\n', end);
    
    if (lastParagraphBreak > index + (size * 0.5)) {
        end = lastParagraphBreak + 2; 
    } else if (lastPeriod > index + (size * 0.7)) {
        end = lastPeriod + 1;
    } else if (lastNewLine > index + (size * 0.7)) {
        end = lastNewLine + 1;
    }
    chunks.push(text.slice(index, end));
    index = end;
  }
  return chunks;
};

export interface ChangeStats {
  percentage: number;
  added: number;
  removed: number;
  analysis: string;
  statusColor: 'green' | 'yellow' | 'red';
}

export const getChangeStatistics = (original: string, cleaned: string): ChangeStats => {
  const changes = diffWords(original, cleaned);
  
  let addedLen = 0;
  let removedLen = 0;
  let totalLen = 0;

  changes.forEach(part => {
    if (part.added) {
      addedLen += part.value.length;
    } else if (part.removed) {
      removedLen += part.value.length;
      totalLen += part.value.length;
    } else {
      totalLen += part.value.length;
    }
  });

  const percentage = totalLen > 0 ? ((addedLen + removedLen) / totalLen) * 100 : 0;
  
  let analysis = "";
  let statusColor: 'green' | 'yellow' | 'red' = 'green';

  if (percentage < 1) {
    analysis = "Very low change rate. The source text was already clean, or the AI was too conservative.";
    statusColor = 'green';
  } else if (percentage < 12) {
    analysis = "Healthy optimization range. Normal for OCR cleaning (hyphens, line breaks, and headers fixed).";
    statusColor = 'green';
  } else if (percentage < 25) {
    analysis = "Moderate restructuring. The AI likely merged many broken paragraphs or fixed significant formatting issues. Verify headers.";
    statusColor = 'yellow';
  } else {
    analysis = "HIGH ALERT: Massive text alteration detected. The AI might be hallucinating, summarizing, or deleting sections. Check the Diff Viewer carefully.";
    statusColor = 'red';
  }

  return {
    percentage,
    added: addedLen,
    removed: removedLen,
    analysis,
    statusColor
  };
};

export const downloadTextFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadWordDoc = (content: string, filename: string) => {
  const header = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Export</title>
      <style>
        body { 
          font-family: 'Times New Roman', serif; 
          font-size: 12pt; 
          line-height: 1.5; 
          color: #000000;
        }
        h1 { font-size: 24pt; font-weight: bold; page-break-before: always; margin-bottom: 24pt; color: #2E2E2E; }
        h2 { font-size: 18pt; font-weight: bold; margin-top: 24pt; margin-bottom: 12pt; page-break-after: avoid; color: #444444; }
        h3 { font-size: 14pt; font-weight: bold; margin-top: 18pt; margin-bottom: 6pt; page-break-after: avoid; font-style: italic; color: #555555; }
        p { margin-bottom: 12pt; margin-top: 0; text-indent: 0; text-align: justify; }
        
        .title-page { text-align: center; margin-top: 200pt; margin-bottom: 200pt; page-break-after: always; }
        .title-page h1 { page-break-before: auto; font-size: 32pt; }
        .title-page p { text-align: center; font-style: italic; }
        
        /* List Styling */
        ul { margin-bottom: 12pt; }
        li { margin-bottom: 6pt; }
        
        /* Front Matter */
        .copyright { font-size: 10pt; color: #666; font-style: italic; text-align: center; margin-top: 50pt; }
      </style>
    </head>
    <body>
  `;

  let bodyContent = '';
  const lines = content.split('\n');
  let inList = false;
  let isFirstContent = true;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
        // Empty line closes list
        if (inList) {
            bodyContent += '</ul>\n';
            inList = false;
        }
        continue;
    }

    // 1. Detect Headers (More robust regex)
    const h1Match = line.match(/^#\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);
    
    // 2. Detect Lists
    const listMatch = line.match(/^[-*•]\s+(.+)/);

    // Title Page Logic: If the very first content is H1, we wrap it in a special div
    if (isFirstContent && h1Match) {
       bodyContent += `<div class="title-page">\n<h1>${h1Match[1]}</h1>\n`;
       // Check if next lines are author/metadata (simple check: short lines)
       let j = i + 1;
       while (j < lines.length && j < i + 5) {
         const nextLine = lines[j].trim();
         if (!nextLine) { j++; continue; }
         if (nextLine.length < 100 && !nextLine.startsWith('#')) {
             bodyContent += `<p>${nextLine}</p>\n`;
             i = j; // Advance main loop
         } else {
             break;
         }
         j++;
       }
       bodyContent += `</div>\n`;
       isFirstContent = false;
       continue;
    }
    isFirstContent = false;

    if (h1Match) {
      if (inList) { bodyContent += '</ul>\n'; inList = false; }
      bodyContent += `<h1>${h1Match[1]}</h1>\n`;
    } 
    else if (h2Match) {
      if (inList) { bodyContent += '</ul>\n'; inList = false; }
      bodyContent += `<h2>${h2Match[1]}</h2>\n`;
    } 
    else if (h3Match) {
      if (inList) { bodyContent += '</ul>\n'; inList = false; }
      bodyContent += `<h3>${h3Match[1]}</h3>\n`;
    } 
    else if (listMatch) {
      if (!inList) {
          bodyContent += '<ul>\n';
          inList = true;
      }
      bodyContent += `<li>${listMatch[1]}</li>\n`;
    }
    else {
      if (inList) { bodyContent += '</ul>\n'; inList = false; }
      // Check for copyright keyword to add class
      if (line.toLowerCase().includes('copyright') || line.toLowerCase().includes('all rights reserved')) {
          bodyContent += `<p class="copyright">${line}</p>\n`;
      } else {
          bodyContent += `<p>${line}</p>\n`;
      }
    }
  }
  
  if (inList) { bodyContent += '</ul>\n'; }

  const footer = "</body></html>";
  const sourceHTML = header + bodyContent + footer;

  const blob = new Blob(['\ufeff', sourceHTML], { 
    type: 'application/msword' 
  });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename; 
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};