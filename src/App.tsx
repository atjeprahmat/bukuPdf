import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as pdfjs from "pdfjs-dist";
import ReactMarkdown from "react-markdown";
import {
  Upload,
  FileText,
  Search,
  MessageSquare,
  Sparkles,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Loader2,
  ZoomIn,
  ZoomOut,
  Check,
  FileUp,
  Info,
  X,
  ArrowRight,
  RefreshCw,
  Send
} from "lucide-react";
import {
  getAllDocuments,
  saveDocument,
  deleteDocument,
  PDFDocument,
  ChatMessage
} from "./db";

// Configure PDF.js Worker using unpkg matching the version installed in package.json
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version || "6.1.200"}/build/pdf.worker.min.mjs`;

export default function App() {
  // State variables
  const [docs, setDocs] = useState<PDFDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<"summary" | "chat">("summary");
  
  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFocused, setSearchFocused] = useState<boolean>(false);
  
  // Loader and progress states
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  const [isSendingChat, setIsSendingChat] = useState<boolean>(false);
  
  // Chat input
  const [chatInput, setChatInput] = useState<string>("");
  
  // Customization/view state
  const [zoom, setZoom] = useState<number>(100); // % of default font size
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const pageViewerRef = useRef<HTMLDivElement>(null);

  // Active document helper
  const selectedDoc = useMemo(() => {
    return docs.find(d => d.id === selectedDocId) || null;
  }, [docs, selectedDocId]);

  // Load documents from IndexedDB on startup
  useEffect(() => {
    loadDocs();
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedDoc?.chatHistory, activeTab]);

  // Handle auto-summarization if a doc is selected but has no summary
  useEffect(() => {
    if (selectedDoc && !selectedDoc.summary && !isGeneratingSummary) {
      triggerSummarize(selectedDoc);
    }
    // Reset page and search when switching documents
    if (selectedDoc) {
      setCurrentPage(1);
      setSearchQuery("");
    }
  }, [selectedDocId]);

  // Load all documents from DB
  const loadDocs = async () => {
    try {
      const allDocs = await getAllDocuments();
      setDocs(allDocs);
      if (allDocs.length > 0 && !selectedDocId) {
        setSelectedDocId(allDocs[0].id);
      }
    } catch (err) {
      showToast("Gagal memuat dokumen dari database lokal.", "error");
    }
  };

  // Helper to trigger toast notifications
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Extract text from uploaded PDF
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      showToast("Format file tidak didukung. Mohon unggah file PDF.", "error");
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress("Mempersiapkan dokumen...");

      const arrayBuffer = await file.arrayBuffer();
      setUploadProgress("Membaca struktur PDF...");
      
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      
      // Hook into password/loading progress if necessary
      loadingTask.onProgress = (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          setUploadProgress(`Mengunduh data: ${percent}%`);
        }
      };

      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;
      const pagesText: string[] = [];

      for (let i = 1; i <= totalPages; i++) {
        setUploadProgress(`Mengekstrak teks halaman ${i} dari ${totalPages}...`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str || "")
          .join(" ");
        pagesText.push(pageText);
      }

      setUploadProgress("Menyimpan dokumen ke database lokal...");

      const newDoc: PDFDocument = {
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ""),
        fileSize: file.size,
        totalPages,
        pages: pagesText,
        chatHistory: [],
        uploadedAt: new Date().toISOString()
      };

      await saveDocument(newDoc);
      setDocs(prev => [newDoc, ...prev]);
      setSelectedDocId(newDoc.id);
      showToast(`Berhasil mengunggah "${newDoc.title}"`, "success");
    } catch (err: any) {
      console.error(err);
      showToast(`Gagal membaca PDF: ${err.message || "Pastikan file tidak terkunci password."}`, "error");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Ask AI to generate document summary
  const triggerSummarize = async (doc: PDFDocument) => {
    if (!doc || isGeneratingSummary) return;

    try {
      setIsGeneratingSummary(true);
      showToast("Sedang merangkum dokumen secara otomatis dengan AI...", "info");

      // Join pages to form full text context
      const fullText = doc.pages.join("\n\n");

      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, title: doc.title })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gagal merangkum dokumen.");
      }

      const data = await response.json();
      
      const updatedDoc = {
        ...doc,
        summary: data.summary
      };

      await saveDocument(updatedDoc);
      setDocs(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
      showToast("Ringkasan dokumen berhasil dibuat!", "success");
    } catch (err: any) {
      console.error(err);
      showToast(`Gagal merangkum: ${err.message}`, "error");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Ask AI questions about the book
  const handleSendChat = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault();
    
    const messageToSend = customMsg || chatInput;
    if (!messageToSend.trim() || !selectedDoc || isSendingChat) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageToSend,
      timestamp: new Date().toISOString()
    };

    // Optimistic UI update
    const updatedHistory = [...selectedDoc.chatHistory, userMsg];
    const docWithOptimisticChat = { ...selectedDoc, chatHistory: updatedHistory };
    setDocs(prev => prev.map(d => d.id === selectedDoc.id ? docWithOptimisticChat : d));
    setChatInput("");
    setIsSendingChat(true);

    try {
      const fullText = selectedDoc.pages.join("\n\n");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullText,
          history: selectedDoc.chatHistory, // send previous exchanges
          message: messageToSend,
          title: selectedDoc.title
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gagal memproses pesan.");
      }

      const data = await response.json();

      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "model",
        content: data.reply,
        timestamp: new Date().toISOString()
      };

      const docWithFinalChat = {
        ...selectedDoc,
        chatHistory: [...updatedHistory, aiMsg]
      };

      await saveDocument(docWithFinalChat);
      setDocs(prev => prev.map(d => d.id === selectedDoc.id ? docWithFinalChat : d));
    } catch (err: any) {
      console.error(err);
      showToast(`Asisten AI Error: ${err.message}`, "error");
      
      // Remove the optimistic user message if it failed
      const docWithResetChat = {
        ...selectedDoc,
        chatHistory: selectedDoc.chatHistory
      };
      setDocs(prev => prev.map(d => d.id === selectedDoc.id ? docWithResetChat : d));
    } finally {
      setIsSendingChat(false);
    }
  };

  // Delete document
  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Apakah Anda yakin ingin menghapus dokumen ini dari database lokal?")) {
      return;
    }

    try {
      await deleteDocument(id);
      const remainingDocs = docs.filter(d => d.id !== id);
      setDocs(remainingDocs);
      if (selectedDocId === id) {
        setSelectedDocId(remainingDocs.length > 0 ? remainingDocs[0].id : null);
      }
      showToast("Dokumen berhasil dihapus.", "success");
    } catch (err) {
      showToast("Gagal menghapus dokumen.", "error");
    }
  };

  // Clean chat history
  const handleClearChat = async () => {
    if (!selectedDoc) return;
    if (!window.confirm("Hapus semua riwayat percakapan untuk buku ini?")) return;

    const clearedDoc = { ...selectedDoc, chatHistory: [] };
    try {
      await saveDocument(clearedDoc);
      setDocs(prev => prev.map(d => d.id === selectedDoc.id ? clearedDoc : d));
      showToast("Riwayat percakapan dibersihkan.", "success");
    } catch (err) {
      showToast("Gagal membersihkan riwayat percakapan.", "error");
    }
  };

  // Full-text search inside the active document
  const searchResults = useMemo(() => {
    const results: { pageNumber: number; snippet: string; index: number }[] = [];
    const query = searchQuery.trim().toLowerCase();
    
    if (query.length < 2 || !selectedDoc) return results;

    selectedDoc.pages.forEach((pageText, idx) => {
      const pageNum = idx + 1;
      let index = pageText.toLowerCase().indexOf(query);
      
      while (index !== -1) {
        // Extract a snippet around the match
        const start = Math.max(0, index - 45);
        const end = Math.min(pageText.length, index + query.length + 55);
        let snippet = pageText.substring(start, end);
        
        if (start > 0) snippet = "..." + snippet;
        if (end < pageText.length) snippet = snippet + "...";

        results.push({
          pageNumber: pageNum,
          snippet: snippet,
          index: index
        });

        if (results.length >= 100) break; // limit to prevent freezing
        index = pageText.toLowerCase().indexOf(query, index + 1);
      }
    });

    return results;
  }, [searchQuery, selectedDoc]);

  // Format bytes into readable filesize
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Helper to escape special regex chars for highlight
  const escapeRegExp = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Text Highlighting Component
  const HighlightedText = ({ text, highlight }: { text: string; highlight: string }) => {
    if (!highlight.trim()) return <span className="whitespace-pre-wrap">{text}</span>;
    
    const parts = text.split(new RegExp(`(${escapeRegExp(highlight)})`, "gi"));
    return (
      <span className="whitespace-pre-wrap">
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className="bg-indigo-100 text-indigo-950 rounded px-0.5 font-semibold border border-indigo-200">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      {/* Toast Notification Bar */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm max-w-md backdrop-blur-md"
            style={{
              backgroundColor:
                toast.type === "success"
                  ? "rgba(240, 24DF, 255, 0.95)" // soft blue/indigo tint
                  : toast.type === "error"
                  ? "rgba(254, 242, 242, 0.95)"
                  : "rgba(245, 243, 255, 0.95)", // soft violet/indigo
              borderColor:
                toast.type === "success"
                  ? "#6366F1"
                  : toast.type === "error"
                  ? "#EF4444"
                  : "#818CF8",
              color:
                toast.type === "success"
                  ? "#1E1B4B"
                  : toast.type === "error"
                  ? "#991B1B"
                  : "#312E81"
            }}
          >
            {toast.type === "success" && <Check className="w-4 h-4 text-indigo-600 flex-shrink-0" />}
            {toast.type === "error" && <X className="w-4 h-4 text-red-600 flex-shrink-0" />}
            {toast.type === "info" && <Loader2 className="w-4 h-4 text-indigo-600 animate-spin flex-shrink-0" />}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold shadow-sm">
            L
          </div>
          <div>
            <h1 className="text-md font-semibold tracking-tight text-slate-900">
              Lumina PDF <span className="text-slate-400 font-normal">AI</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-medium">Asisten Analisis Buku • Gemini AI</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-100">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-600" />
            <span>AI Terintegrasi Aktif</span>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium text-sm rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mengekstrak...</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Unggah PDF</span>
              </>
            )}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf"
            className="hidden"
          />
        </div>
      </header>

      {/* App Workspace Body */}
      <main className="flex flex-1 overflow-hidden">
        
        {/* LEFT COLUMN: Document Library Sidebar */}
        <aside className="w-80 border-r border-slate-200 bg-white flex flex-col flex-shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex-shrink-0 bg-slate-50/50">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Perpustakaan Saya</h2>
            <p className="text-xs text-slate-500">Semua file disimpan dengan aman secara lokal di browser Anda.</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isUploading && (
              <div className="p-4 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/30 flex flex-col items-center text-center">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2.5" />
                <p className="text-sm font-semibold text-indigo-800">Sedang Memproses PDF</p>
                <p className="text-xs text-indigo-600 mt-1">{uploadProgress}</p>
              </div>
            )}

            {docs.length === 0 && !isUploading ? (
              <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 text-center flex flex-col items-center justify-center h-48 bg-slate-50/50">
                <FileUp className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-600">Perpustakaan Kosong</p>
                <p className="text-xs text-slate-400 mt-1">Unggah dokumen PDF pertama Anda untuk memulai analisis AI.</p>
              </div>
            ) : (
              docs.map((doc) => {
                const isSelected = doc.id === selectedDocId;
                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`group relative p-3.5 rounded-xl cursor-pointer border transition-all ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200/80 shadow-sm font-medium"
                        : "bg-white hover:bg-slate-50 border-slate-150 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${isSelected ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 pr-6">
                        <p className="text-sm font-semibold truncate text-slate-900 group-hover:text-indigo-900">
                          {doc.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-400 font-medium">
                          <span>{doc.totalPages} Halaman</span>
                          <span>•</span>
                          <span>{formatBytes(doc.fileSize)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => handleDeleteDoc(doc.id, e)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50/80 transition-all"
                      title="Hapus Dokumen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* CENTER COLUMN: Document Viewer */}
        <section className="flex-1 flex flex-col bg-slate-100 overflow-hidden border-r border-slate-200">
          {selectedDoc ? (
            <>
              {/* Document Header & Navigation */}
              <div className="bg-white border-b border-slate-200 px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <h2 className="text-md font-bold text-slate-900 truncate" title={selectedDoc.title}>
                    {selectedDoc.title}
                  </h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Halaman {currentPage} dari {selectedDoc.totalPages}</p>
                </div>

                {/* Page Controls & Font zoom */}
                <div className="flex items-center flex-wrap gap-3">
                  <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40 transition-all cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-2 text-xs font-semibold text-slate-700 min-w-14 text-center">
                      {currentPage} / {selectedDoc.totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(selectedDoc.totalPages, p + 1))}
                      disabled={currentPage === selectedDoc.totalPages}
                      className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40 transition-all cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button
                      onClick={() => setZoom(z => Math.max(80, z - 10))}
                      className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 transition-all cursor-pointer"
                      title="Perkecil teks"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2.5 text-[10px] font-bold text-slate-500 min-w-10 text-center">
                      {zoom}%
                    </span>
                    <button
                      onClick={() => setZoom(z => Math.min(180, z + 10))}
                      className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 transition-all cursor-pointer"
                      title="Perbesar teks"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Inside Search */}
              <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center gap-3 relative flex-shrink-0 shadow-sm z-10">
                <div className="relative flex-1">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${searchFocused ? "text-indigo-600" : "text-slate-400"}`} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 200)} // delay to allow clicks on results
                    placeholder="Ketik kata kunci untuk mencari cepat isi PDF..."
                    className="w-full pl-9 pr-8 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm transition-all outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {searchQuery.trim().length >= 2 && (
                  <div className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100/60 flex-shrink-0">
                    {searchResults.length} temuan
                  </div>
                )}

                {/* Instant Dropdown Search Results */}
                {searchFocused && searchQuery.trim().length >= 2 && (
                  <div className="absolute left-6 right-6 top-full mt-1 bg-white border border-slate-200 shadow-xl rounded-xl max-h-60 overflow-y-auto z-50 p-2 divide-y divide-slate-50">
                    {searchResults.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Tidak ditemukan hasil pencarian untuk "{searchQuery}"
                      </div>
                    ) : (
                      searchResults.map((res, i) => (
                        <button
                           key={i}
                           onClick={() => {
                             setCurrentPage(res.pageNumber);
                             pageViewerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                           }}
                           className="w-full text-left p-2 hover:bg-slate-50 rounded-lg transition-colors flex items-start gap-3 group"
                        >
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 mt-0.5">
                            Hal {res.pageNumber}
                          </span>
                          <span className="text-xs text-slate-600 group-hover:text-slate-900 line-clamp-2 leading-relaxed flex-1">
                            <HighlightedText text={res.snippet} highlight={searchQuery} />
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-600 self-center transition-colors" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Page Viewer Sheet Container */}
              <div
                ref={pageViewerRef}
                className="flex-1 overflow-y-auto p-8 flex justify-center items-start"
              >
                <div
                  className="bg-white border border-slate-200/60 shadow-md hover:shadow-lg rounded-xl p-10 max-w-2xl w-full min-h-[700px] transition-shadow duration-300 relative select-text"
                  style={{ fontSize: `${(zoom / 100) * 15}px` }}
                >
                  {/* Decorative page layout features */}
                  <div className="absolute top-4 left-6 text-[10px] font-semibold text-slate-400 uppercase tracking-widest pointer-events-none">
                    {selectedDoc.title}
                  </div>
                  <div className="absolute top-4 right-6 text-[10px] font-semibold text-slate-400 pointer-events-none">
                    Halaman {currentPage} dari {selectedDoc.totalPages}
                  </div>

                  <div className="mt-6 text-slate-800 leading-relaxed font-serif break-words">
                    {selectedDoc.pages[currentPage - 1] ? (
                      <HighlightedText
                        text={selectedDoc.pages[currentPage - 1]}
                        highlight={searchQuery}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 py-24 text-center">
                        <Info className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="text-sm font-medium">Halaman Kosong</p>
                        <p className="text-xs mt-1">Halaman ini tidak mengandung teks yang dapat dibaca.</p>
                      </div>
                    )}
                  </div>

                  {/* Footer page design indicator */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-300 pointer-events-none select-none">
                    {currentPage}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-50">
              <div className="w-20 h-20 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-6 shadow-sm">
                <BookOpen className="w-10 h-10 animate-pulse text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Selamat datang di Lumina PDF AI</h3>
              <p className="text-sm text-slate-500 max-w-sm mt-2 leading-relaxed">
                Mulai baca dan analisis buku atau berkas PDF Anda. Unggah dokumen PDF baru dari tombol di atas untuk memulai.
              </p>
              
              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-xl">
                <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col items-center shadow-sm">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                    <FileUp className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 mb-1">1. Unggah PDF</p>
                  <p className="text-[11px] text-slate-400">PDF diekstrak langsung secara aman di browser.</p>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col items-center shadow-sm">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 mb-1">2. Ringkasan Otomatis</p>
                  <p className="text-[11px] text-slate-400">Dapatkan bab penting dan gagasan utama langsung.</p>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col items-center shadow-sm">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 mb-1">3. Tanya Jawab AI</p>
                  <p className="text-[11px] text-slate-400">Diskusikan isi dokumen interaktif dengan Gemini.</p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: AI Copilot Panel */}
        <section className="w-96 border-l border-slate-200 bg-white flex flex-col flex-shrink-0 overflow-hidden">
          
          {/* Tab Selection Row */}
          <div className="flex border-b border-slate-100 p-2 flex-shrink-0 bg-slate-50/40">
            <button
              onClick={() => setActiveTab("summary")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === "summary"
                  ? "bg-white text-indigo-950 shadow-sm border border-slate-200 font-semibold"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ringkasan AI</span>
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === "chat"
                  ? "bg-white text-indigo-950 shadow-sm border border-slate-200 font-semibold"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
              <span>Tanya Jawab AI</span>
            </button>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 overflow-y-auto">
            {selectedDoc ? (
              <AnimatePresence mode="wait">
                
                {/* SUMMARY TAB */}
                {activeTab === "summary" && (
                  <motion.div
                    key="summary-tab"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="p-5 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                        <span>Ringkasan Buku Otomatis</span>
                      </div>
                      
                      <button
                        onClick={() => triggerSummarize(selectedDoc)}
                        disabled={isGeneratingSummary}
                        className="text-xs flex items-center gap-1.5 text-slate-500 hover:text-indigo-700 bg-slate-100 hover:bg-indigo-50 px-2 py-1 rounded-md transition-all disabled:opacity-50"
                        title="Buat ulang ringkasan"
                      >
                        <RefreshCw className={`w-3 h-3 ${isGeneratingSummary ? "animate-spin text-indigo-600" : ""}`} />
                        <span>Generasi Ulang</span>
                      </button>
                    </div>

                    {isGeneratingSummary ? (
                      <div className="py-24 text-center flex flex-col items-center justify-center bg-slate-50/50 rounded-2xl border border-slate-150">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                        <p className="text-sm font-semibold text-slate-800">Sedang Merangkum Teks...</p>
                        <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed px-6">
                          AI Gemini sedang membaca, menganalisis, dan menyusun intisari penting dari buku Anda. Mohon tunggu.
                        </p>
                      </div>
                    ) : selectedDoc.summary ? (
                      <div className="prose prose-sm max-w-none text-slate-700 space-y-3 leading-relaxed text-sm">
                        <ReactMarkdown>{selectedDoc.summary}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="py-24 text-center flex flex-col items-center justify-center bg-slate-50/50 rounded-2xl border border-slate-150">
                        <Sparkles className="w-8 h-8 text-slate-300 mb-3" />
                        <p className="text-sm font-medium text-slate-600">Ringkasan belum tersedia</p>
                        <button
                          onClick={() => triggerSummarize(selectedDoc)}
                          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow"
                        >
                          Mulai Rangkum AI
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* CHAT TAB */}
                {activeTab === "chat" && (
                  <motion.div
                    key="chat-tab"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="h-full flex flex-col overflow-hidden"
                  >
                    
                    {/* Chat top info / controls */}
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-slate-50/40">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Asisten Dokumen ({selectedDoc.chatHistory.length} pesan)
                      </span>
                      {selectedDoc.chatHistory.length > 0 && (
                        <button
                          onClick={handleClearChat}
                          className="text-[10px] font-bold text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                        >
                          Hapus Riwayat
                        </button>
                      )}
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                      {/* Initial Welcoming message */}
                      <div className="flex gap-2 bg-white border border-slate-100 p-3.5 rounded-2xl max-w-[85%] self-start shadow-sm">
                        <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">Pembaca PDF AI</p>
                          <p className="text-xs text-slate-600 leading-relaxed mt-1">
                            Halo! Saya siap membantu Anda menganalisis isi buku atau dokumen ini. Apa yang ingin Anda tanyakan atau ringkas?
                          </p>
                        </div>
                      </div>

                      {/* Document Grounded Chat History */}
                      {selectedDoc.chatHistory.map((msg) => {
                        const isUser = msg.role === "user";
                        return (
                          <div
                            key={msg.id}
                            className={`flex gap-2.5 p-3.5 rounded-2xl max-w-[85%] shadow-sm ${
                              isUser
                                ? "bg-indigo-600 text-white ml-auto flex-row-reverse"
                                : "bg-white border border-slate-150 mr-auto"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                isUser ? "bg-indigo-500 text-white" : "bg-indigo-50 text-indigo-600"
                              }`}
                            >
                              {isUser ? <FileText className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-[10px] font-bold ${isUser ? "text-indigo-150" : "text-slate-900"}`}>
                                {isUser ? "Anda" : "Asisten AI"}
                              </p>
                              <div className={`prose prose-sm break-words text-xs leading-relaxed mt-1 ${isUser ? "text-white" : "text-slate-700"}`}>
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {isSendingChat && (
                        <div className="flex gap-2 bg-white border border-slate-150 p-3.5 rounded-2xl max-w-[85%] self-start mr-auto shadow-sm">
                          <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-900">Asisten AI</p>
                            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                              <span>Membaca PDF & merespons...</span>
                            </p>
                          </div>
                        </div>
                      )}

                      <div ref={chatBottomRef} />
                    </div>

                    {/* Quick Question Chips / Recommendation */}
                    <div className="p-2 border-t border-slate-100 flex gap-1.5 overflow-x-auto flex-shrink-0 bg-white scrollbar-none">
                      <button
                        onClick={() => handleSendChat(undefined, "Tuliskan 3 poin kunci terpenting dari buku ini beserta penjelasannya.")}
                        className="text-[10px] font-semibold bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-800 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
                      >
                        Poin Kunci
                      </button>
                      <button
                        onClick={() => handleSendChat(undefined, `Jelaskan apa isi utama dari halaman ${currentPage} pada dokumen ini.`)}
                        className="text-[10px] font-semibold bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-800 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
                      >
                        Jelaskan Hal. {currentPage}
                      </button>
                      <button
                        onClick={() => handleSendChat(undefined, "Buatkan ringkasan ringkas dalam 5 kalimat beserta implikasi utamanya.")}
                        className="text-[10px] font-semibold bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-800 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
                      >
                        Analisis 5 Kalimat
                      </button>
                    </div>

                    {/* Chat Input Area */}
                    <form
                      onSubmit={(e) => handleSendChat(e)}
                      className="p-3 border-t border-slate-150 bg-white flex items-center gap-2 flex-shrink-0"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        disabled={isSendingChat}
                        placeholder="Tanya asisten AI tentang isi PDF ini..."
                        className="flex-1 py-2 px-3 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs border border-slate-200 focus:border-indigo-500 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={isSendingChat || !chatInput.trim()}
                        className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-lg transition-all cursor-pointer"
                        title="Kirim Pesan"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <div className="py-24 text-center text-slate-400 p-5 flex flex-col items-center justify-center">
                <Sparkles className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs font-semibold text-slate-500">Asisten AI Siap Membantu</p>
                <p className="text-[11px] text-slate-400 max-w-xs mt-1 leading-relaxed">
                  Pilih dokumen dari perpustakaan di samping kiri untuk mengaktifkan ringkasan instan dan obrolan AI yang interaktif.
                </p>
              </div>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}
