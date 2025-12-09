import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, Download, Play, RefreshCw, AlertCircle, CheckCircle2, FileType, List, ChevronDown, ChevronUp, Sparkles, Split, Activity, Globe, Terminal } from 'lucide-react';
import { AppStatus, ProcessingLog, Language } from './types';
import { readFileContent, chunkText, downloadTextFile, downloadWordDoc, preCleanText, postCleanText, detectChapters, cleanStructureList, getChangeStatistics, ChangeStats } from './utils/textProcessing';
import { cleanTextChunk } from './services/geminiService';
import { Button } from './components/Button';
import { DiffViewer } from './components/DiffViewer';

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<string>('ISO-8859-1'); 
  const [language, setLanguage] = useState<Language>('sv');
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [cleanedText, setCleanedText] = useState<string>('');
  const [originalText, setOriginalText] = useState<string>('');
  
  // Chapter Detection State
  const [chapters, setChapters] = useState<string[]>([]);
  const [showChapterEdit, setShowChapterEdit] = useState(false);
  const [chapterText, setChapterText] = useState('');

  // Granular Progress State
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>('');
  
  // Auto-scroll ref for terminal
  const terminalEndRef = useRef<HTMLDivElement>(null);
  
  // Statistics
  const [stats, setStats] = useState<ChangeStats | null>(null);

  // Scroll to bottom of terminal when text updates
  useEffect(() => {
    if (status === AppStatus.PROCESSING && terminalEndRef.current) {
        terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [cleanedText, status]);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return 'calculating...';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m === 0 && s === 0) return 'less than 1s';
    return `${m}m ${s}s`;
  };

  const addLog = (message: string, type: ProcessingLog['type'] = 'info') => {
    setLogs(prev => {
      const newLog = {
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        message,
        type
      };
      return [newLog, ...prev].slice(0, 15);
    });
  };

  const loadFileAndDetect = async (fileToLoad: File, enc: string) => {
    try {
      addLog(`Reading file to analyze structure (${language === 'sv' ? 'Swedish' : 'English'})...`, 'info');
      const text = await readFileContent(fileToLoad, enc);
      setOriginalText(text);
      
      const detected = detectChapters(text, language);
      setChapters(detected);
      setChapterText(detected.join('\n'));
      
      if (detected.length > 0) {
        addLog(`Detected ${detected.length} potential chapters.`, 'success');
        setShowChapterEdit(true);
      } else {
        addLog("No obvious chapters detected.", 'info');
      }
    } catch (err) {
      addLog(`Error reading file: ${err}`, 'error');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const newFile = e.target.files[0];
      setFile(newFile);
      setStatus(AppStatus.IDLE);
      setLogs([]);
      setCleanedText('');
      setOriginalText('');
      setStats(null);
      setProgress(0);
      setChapters([]);
      setEstimatedTimeRemaining('');
      setCurrentChunkIndex(0);
      setTotalChunks(0);
      
      // Immediately read and detect
      loadFileAndDetect(newFile, encoding);
    }
  };

  // Re-read file if encoding or language changes
  useEffect(() => {
    if (file && status === AppStatus.IDLE) {
       loadFileAndDetect(file, encoding);
    }
  }, [encoding, language]);

  const handleChapterTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChapterText(e.target.value);
    setChapters(e.target.value.split('\n').filter(line => line.trim().length > 0));
  };

  const handleAutoCleanChapters = () => {
    const cleaned = cleanStructureList(chapterText);
    setChapterText(cleaned);
    setChapters(cleaned.split('\n').filter(line => line.trim().length > 0));
    addLog("Structure list cleaned automatically!", 'success');
  };

  const startProcessing = async () => {
    if (!file || !originalText) return;

    setStatus(AppStatus.PROCESSING);
    setCleanedText('');
    setLogs([]);
    setStats(null);
    setEstimatedTimeRemaining('calculating...');
    setProgress(0);
    
    addLog(`Starting process for ${file.name} in ${language.toUpperCase()}...`);
    addLog(`Using ${chapters.length} defined chapters for structure context.`);

    try {
      // 1. Pre-Clean (Regex)
      addLog("Running pre-cleaning (removing artifacts)...", 'info');
      const preCleanedTextContent = preCleanText(originalText);

      // 2. Chunk Text
      const chunks = chunkText(preCleanedTextContent); 
      setTotalChunks(chunks.length);
      addLog(`Split text into ${chunks.length} chunks.`, 'info');

      // 3. Process Chunks (AI)
      let tempFullText = '';
      const startTime = Date.now();
      let previousContext = ''; 
      
      for (let i = 0; i < chunks.length; i++) {
        setCurrentChunkIndex(i + 1);
        const chunk = chunks[i];
        
        try {
          // AI Cleaning with Chapter Context AND Previous Context + LANGUAGE
          let processedChunk = await cleanTextChunk(chunk, chapters, previousContext, language);
          
          // Post-Clean (Regex on chunk level) - Pass language to avoid Swedish fixes on English text
          processedChunk = postCleanText(processedChunk, language);

          tempFullText += processedChunk;
          
          previousContext = processedChunk.slice(-500);

          setCleanedText(prev => prev + processedChunk);

          // Update Progress & Estimates
          const chunksCompleted = i + 1;
          const now = Date.now();
          const elapsedMs = now - startTime;
          const avgTimePerChunk = elapsedMs / chunksCompleted;
          const chunksRemaining = chunks.length - chunksCompleted;
          const estimatedMs = avgTimePerChunk * chunksRemaining;

          setEstimatedTimeRemaining(formatTime(estimatedMs / 1000));
          setProgress((chunksCompleted / chunks.length) * 100);

        } catch (err) {
            addLog(`Error processing chunk ${i + 1}: ${err}`, 'error');
            tempFullText += chunk; 
            previousContext = chunk.slice(-500); 
            setCleanedText(prev => prev + chunk);
        }
      }

      addLog("All chunks processed successfully!", 'success');
      
      // Calculate Final Stats
      addLog("Calculating quality statistics...", 'info');
      const computedStats = getChangeStatistics(originalText, tempFullText);
      setStats(computedStats);

      setStatus(AppStatus.COMPLETED);
      setEstimatedTimeRemaining(''); 

    } catch (error) {
      console.error(error);
      addLog(`Fatal error: ${String(error)}`, 'error');
      setStatus(AppStatus.ERROR);
    }
  };

  const handleDownloadTxt = () => {
    const filename = file ? `clean_${file.name}` : 'cleaned_book.txt';
    downloadTextFile(cleanedText, filename);
  };

  const handleDownloadWord = () => {
    const filename = file ? `clean_${file.name.replace('.txt', '')}.doc` : 'cleaned_book.doc';
    downloadWordDoc(cleanedText, filename);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center">
      <div className="w-full max-w-7xl space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <RefreshCw className="text-blue-600" />
            Gemini OCR Cleaner <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full ml-2">Turbo</span>
          </h1>
          <p className="text-slate-500 mt-2">
            Automated text cleaning for OCR scanned books. Hybrid approach using Regex (for artifacts) + Gemini 2.5 Flash (for semantics).
          </p>
        </div>

        {/* Configuration & Input */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="md:col-span-2 space-y-4">
            {/* Input Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="font-semibold text-lg text-slate-800">Input Source</h2>
              
              <div className="flex flex-col gap-4">
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors relative">
                  <input 
                    type="file" 
                    accept=".txt" 
                    onChange={handleFileChange}
                    className="hidden" 
                    id="file-upload"
                    disabled={status === AppStatus.PROCESSING}
                  />
                  <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center w-full h-full">
                    <Upload className="h-8 w-8 text-slate-400 mb-2" />
                    <span className="text-sm font-medium text-slate-700">
                      {file ? file.name : "Click to upload book.txt"}
                    </span>
                    <span className="text-xs text-slate-400 mt-1">Plain text files only</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   {/* Language Selector */}
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                        <Globe className="w-4 h-4" /> Language
                      </label>
                      <select 
                        value={language} 
                        onChange={(e) => setLanguage(e.target.value as Language)}
                        className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2 text-sm"
                        disabled={status === AppStatus.PROCESSING}
                      >
                        <option value="sv">Swedish (Svenska)</option>
                        <option value="en">English (Engelska)</option>
                      </select>
                  </div>

                  {/* Encoding Selector */}
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Encoding</label>
                      <select 
                        value={encoding} 
                        onChange={(e) => setEncoding(e.target.value)}
                        className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2 text-sm"
                        disabled={status === AppStatus.PROCESSING}
                      >
                        <option value="ISO-8859-1">Latin-1 (ISO-8859-1)</option>
                        <option value="UTF-8">UTF-8</option>
                        <option value="windows-1252">Windows-1252</option>
                      </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Structure / Chapters Card */}
            {file && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-2">
                 <div 
                   className="flex items-center justify-between cursor-pointer"
                   onClick={() => setShowChapterEdit(!showChapterEdit)}
                 >
                    <div className="flex items-center gap-2">
                       <List className="w-5 h-5 text-blue-600" />
                       <h2 className="font-semibold text-lg text-slate-800">
                          Structure Context 
                          <span className="ml-2 text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {chapters.length} detected
                          </span>
                       </h2>
                    </div>
                    {showChapterEdit ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                 </div>
                 
                 {showChapterEdit && (
                   <div className="mt-2 animate-in fade-in slide-in-from-top-2">
                     <div className="flex justify-between items-center mb-2">
                        <p className="text-xs text-slate-500">
                          Paste your Table of Contents here. It helps the AI detect headers.
                        </p>
                        <button 
                          onClick={handleAutoCleanChapters}
                          className="text-xs flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                          title="Removes page numbers and artifacts"
                        >
                          <Sparkles className="w-3 h-3" /> Auto-Clean List
                        </button>
                     </div>
                     <textarea
                       value={chapterText}
                       onChange={handleChapterTextChange}
                       className="w-full h-48 p-2 text-sm border border-slate-200 rounded-lg font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                       placeholder="Paste your raw Table of Contents here..."
                     />
                   </div>
                 )}
              </div>
            )}
          </div>

          {/* Status Panel */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col h-full max-h-[600px]">
            <h2 className="font-semibold text-lg text-slate-800 mb-4">Action & Status</h2>
            
            <Button 
                onClick={startProcessing} 
                disabled={!file || status === AppStatus.PROCESSING}
                isLoading={status === AppStatus.PROCESSING}
                className="w-full mb-6"
            >
                {status === AppStatus.PROCESSING ? 'Cleaning...' : 'Start Cleaning'}
                {!status.includes('PROCESSING') && <Play className="w-4 h-4 ml-2" />}
            </Button>

            {/* Quality Stats (Only on Complete) */}
            {status === AppStatus.COMPLETED && stats && (
               <div className={`mb-4 p-4 rounded-lg border flex flex-col gap-2 
                 ${stats.statusColor === 'green' ? 'bg-green-50 border-green-200' : 
                   stats.statusColor === 'yellow' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
                 }`}>
                  <div className="flex justify-between items-center">
                    <span className={`font-bold text-sm flex items-center gap-1
                      ${stats.statusColor === 'green' ? 'text-green-800' : 
                        stats.statusColor === 'yellow' ? 'text-amber-800' : 'text-red-800'
                      }`}>
                      <Activity className="w-4 h-4" /> Change Rate: {stats.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <p className={`text-xs 
                    ${stats.statusColor === 'green' ? 'text-green-700' : 
                      stats.statusColor === 'yellow' ? 'text-amber-700' : 'text-red-700'
                    }`}>
                    {stats.analysis}
                  </p>
               </div>
            )}

            {status !== AppStatus.IDLE && (
              <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
                
                {/* Granular Progress Info */}
                <div className="flex justify-between items-end text-xs font-medium text-slate-700">
                   <span>
                     {status === AppStatus.PROCESSING 
                       ? `Processing chunk ${currentChunkIndex} of ${totalChunks}`
                       : status === AppStatus.COMPLETED ? 'Complete' : 'Ready'
                     }
                   </span>
                   <span>{Math.round(progress)}%</span>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>

                {status === AppStatus.PROCESSING && (
                    <div className="flex justify-end">
                         <span className="text-xs text-slate-400 font-mono">
                           {estimatedTimeRemaining === 'calculating...' ? 'Estimating time...' : `Est. remaining: ${estimatedTimeRemaining}`}
                         </span>
                    </div>
                )}

                {/* Logs */}
                <div className="flex-1 overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50 text-xs font-mono space-y-1">
                  {logs.map(log => (
                    <div key={log.id} className={`
                      ${log.type === 'error' ? 'text-red-600' : 
                        log.type === 'success' ? 'text-green-600' : 'text-slate-600'}
                    `}>
                      <span className="opacity-50">[{log.timestamp.toLocaleTimeString()}]</span> {log.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {status === AppStatus.COMPLETED && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex gap-2">
                 <Button onClick={handleDownloadTxt} className="flex-1 text-xs" variant="secondary" title="Save as Text">
                    <Download className="w-4 h-4" /> .TXT
                 </Button>
                 <Button onClick={handleDownloadWord} className="flex-1 text-xs" variant="primary" title="Save as Word">
                    <FileType className="w-4 h-4" /> .DOC
                 </Button>
              </div>
            )}
          </div>
        </div>

        {/* Diff Viewer Section */}
        {status === AppStatus.COMPLETED && (originalText || cleanedText) && (
          <div className="h-[600px] flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <Split className="w-4 h-4 text-blue-500" /> 
              Verification (Original vs Cleaned)
            </h3>
            <DiffViewer original={originalText} cleaned={cleanedText} />
          </div>
        )}

        {/* Live Terminal Preview (Replaces Diff during processing to prevent lag) */}
        {status === AppStatus.PROCESSING && (
           <div className="h-[400px] flex flex-col space-y-2">
             <h3 className="font-semibold text-slate-700 flex items-center gap-2">
               <Terminal className="w-4 h-4 text-blue-500" /> 
               Live Stream (Fast Preview)
             </h3>
             <div className="flex-1 bg-slate-900 rounded-xl p-4 overflow-y-auto font-mono text-xs text-green-400 shadow-inner border border-slate-700">
                <div className="whitespace-pre-wrap leading-relaxed opacity-90">
                  {cleanedText}
                  <span ref={terminalEndRef} className="animate-pulse inline-block w-2 h-4 bg-green-500 ml-1 align-middle"></span>
                </div>
             </div>
           </div>
        )}

      </div>
    </div>
  );
}