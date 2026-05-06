
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { LOADING_MESSAGES } from './constants';
import { generateDualMoodboards, visualizeFloorPlan, analyzeFloorPlan } from './services/geminiService';
import { AppTab, GenerationState, FurnitureChoice, ChatMessage } from './types';

const INITIAL_STATE_FACTORY = (): GenerationState => ({
  isGenerating: false,
  isGeneratingMoodboard: false,
  isDetectingFurniture: false,
  error: null,
  originalImage: null,
  resultImage: null,
  projectTitle: '',
  pinterestLink: '',
  moodboardSourceImages: [],
  moodboardResultImages: [],
  progressMessage: LOADING_MESSAGES[0],
  detectedFurniture: [],
  refinementChat: [],
  currentAnnotation: null,
  floorPlanDescription: null,
  lastGeneratedMode: '2D'
});

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<AppTab>('plattegrond');
  const [state, setState] = useState<GenerationState>(INITIAL_STATE_FACTORY());
  
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const moodboardInputRef = useRef<HTMLInputElement>(null);

  const [showOriginal, setShowOriginal] = useState<boolean>(true);
  const [moodboardViewIndex, setMoodboardViewIndex] = useState<number>(0);

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isFurnitureModalOpen, setIsFurnitureModalOpen] = useState(false);
  const [currentFurnitureIndex, setCurrentFurnitureIndex] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [recipientEmail, setRecipientEmail] = useState('');

  useEffect(() => {
    if (isDrawingMode && canvasRef.current && imageRef.current) {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      
      const setDimensions = () => {
        canvas.width = img.naturalWidth || img.clientWidth;
        canvas.height = img.naturalHeight || img.clientHeight;
      };

      if (img.complete) {
        setDimensions();
      } else {
        img.onload = setDimensions;
      }
    }
  }, [isDrawingMode, state.resultImage]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let interval: number | undefined;
    if (state.isGenerating || state.isGeneratingMoodboard || state.isDetectingFurniture) {
      let index = 0;
      interval = window.setInterval(() => {
        index = (index + 1) % LOADING_MESSAGES.length;
        setState(prev => ({ ...prev, progressMessage: LOADING_MESSAGES[index] }));
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [state.isGenerating, state.isGeneratingMoodboard, state.isDetectingFurniture]);

  const handleReset = () => {
    if (window.confirm("Weet je zeker dat je alle gegevens wilt wissen en opnieuw wilt beginnen?")) {
      setState(INITIAL_STATE_FACTORY());
      setShowOriginal(true);
      setMoodboardViewIndex(0);
      setActiveTab('plattegrond');
      if (floorPlanInputRef.current) floorPlanInputRef.current.value = '';
      if (moodboardInputRef.current) moodboardInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'floorplan' | 'moodboard' | 'furniture-ref') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (type === 'floorplan') {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setState(prev => ({ ...prev, originalImage: base64, resultImage: null, error: null, detectedFurniture: [], floorPlanDescription: null }));
        setShowOriginal(true);
      };
      reader.readAsDataURL(files[0]);
    } else if (type === 'moodboard') {
      const readers = Array.from(files).map((file: File) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(images => {
        setState(prev => ({
          ...prev,
          moodboardSourceImages: [...prev.moodboardSourceImages, ...images].slice(0, 6),
          moodboardResultImages: [],
          error: null
        }));
      });
    }
  };

  const handleAnalyze = async () => {
    if (!state.originalImage) return;
    setState(prev => ({ ...prev, isDetectingFurniture: true, error: null }));
    try {
      const analysis = await analyzeFloorPlan(state.originalImage);
      setState(prev => ({ 
        ...prev, 
        isDetectingFurniture: false, 
        detectedFurniture: analysis.items,
        floorPlanDescription: analysis.description
      }));
    } catch (err: any) {
      setState(prev => ({ ...prev, isDetectingFurniture: false, error: "Analyse mislukt." }));
    }
  };

  const updateFurnitureChoice = (index: number, updates: Partial<FurnitureChoice>) => {
    setState(prev => {
      const newFurniture = [...prev.detectedFurniture];
      newFurniture[index] = { ...newFurniture[index], ...updates };
      return { ...prev, detectedFurniture: newFurniture };
    });
  };

  const handleFurnitureRefUpload = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      updateFurnitureChoice(index, { referenceImage: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async (mode: '2D' | '2.5D' = '2D', customPrompt?: string, additionalChatMsg?: ChatMessage) => {
    if (!state.originalImage) {
      setState(prev => ({ ...prev, error: "Upload eerst een plattegrond." }));
      return;
    }
    
    const prompt = customPrompt || (
      state.moodboardResultImages.length > 0 
        ? `Visualiseer deze plattegrond exact zoals getekend, maar met de materialen en kleuren van het moodboard en de specifieke meubelkeuzes.`
        : `Visualiseer deze plattegrond exact zoals getekend, met realistische en neutrale materialen en kleuren, en de specifieke meubelkeuzes.`
    );

    setState(prev => ({ ...prev, isGenerating: true, error: null, lastGeneratedMode: mode }));
    try {
      const moodboardToUse = state.moodboardResultImages[1] || state.moodboardResultImages[0];
      const currentChat = additionalChatMsg ? [...state.refinementChat, additionalChatMsg] : state.refinementChat;
      
      const result = await visualizeFloorPlan(
        state.originalImage, 
        prompt, 
        moodboardToUse,
        state.detectedFurniture,
        currentChat,
        state.currentAnnotation,
        state.floorPlanDescription,
        mode
      );
      setState(prev => ({ ...prev, isGenerating: false, resultImage: result, currentAnnotation: null }));
      setShowOriginal(false);
      setIsDrawingMode(false);
    } catch (err: any) {
      setState(prev => ({ ...prev, isGenerating: false, error: err.message || 'Er is iets fout gegaan.' }));
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingMode) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const isTouch = e.type.startsWith('touch');
    const clientX = isTouch ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = isTouch ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    
    // Calculate scaling factors
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3 * scaleX; // Adjust line width based on scale
    ctx.lineCap = 'round';
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !isDrawingMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const isTouch = e.type.startsWith('touch');
    const clientX = isTouch ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = isTouch ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;

    // Calculate scaling factors
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    setState(prev => ({ ...prev, currentAnnotation: canvas.toDataURL() }));
  };

  const clearAnnotation = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState(prev => ({ ...prev, currentAnnotation: null }));
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !state.resultImage) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setState(prev => ({
      ...prev,
      refinementChat: [...prev.refinementChat, userMsg]
    }));
    setChatInput('');
    
    await handleGenerate(state.lastGeneratedMode, `Verfijn de visualisatie op basis van de volgende instructie: ${userMsg.text}`, userMsg);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginCode === '5061') {
      setIsAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Onjuiste toegangscode.');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans selection:bg-indigo-100 selection:text-indigo-900">
        <div className="bg-white p-10 rounded-[2.5rem] shadow-xl max-w-md w-full border border-slate-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-indigo-200">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Studio Whoon</h1>
            <p className="text-sm text-slate-500 mt-3 font-medium">Voer de toegangscode in om door te gaan</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <input
                type="password"
                inputMode="numeric"
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                placeholder="Toegangscode"
                className="w-full px-4 py-5 bg-slate-50 border-2 border-slate-100 rounded-2xl text-center text-3xl tracking-[0.5em] font-black focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                autoFocus
              />
            </div>
            {loginError && (
              <p className="text-red-500 text-sm text-center font-bold bg-red-50 py-2 rounded-xl">{loginError}</p>
            )}
            <button
              type="submit"
              className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-200 transition-all hover:-translate-y-0.5"
            >
              Inloggen
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleGenerateMoodboard = async () => {
    if (state.moodboardSourceImages.length === 0) {
      setState(prev => ({ ...prev, error: "Upload eerst inspiratiebeelden." }));
      return;
    }
    setState(prev => ({ ...prev, isGeneratingMoodboard: true, error: null }));
    try {
      const results = await generateDualMoodboards(state.moodboardSourceImages);
      setState(prev => ({ ...prev, isGeneratingMoodboard: false, moodboardResultImages: results }));
      setMoodboardViewIndex(1);
    } catch (err: any) {
      setState(prev => ({ ...prev, isGeneratingMoodboard: false, error: 'Moodboard kon niet worden gegenereerd.' }));
    }
  };

  const createPDFInstance = async () => {
    // High-resolution settings for jsPDF
    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
      compress: false // Disable compression for maximum quality
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20; // More generous margin for luxury feel
    const contentWidth = pageWidth - (margin * 2);

    const drawFooter = () => {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(180, 180, 180);
      pdf.text("STUDIO WHOON OISTERWIJK  |  HEUSDENSEBAAN 65  |  WWW.WHOON.COM", pageWidth / 2, pageHeight - 10, { align: "center", charSpace: 0.5 });
    };

    const drawHeaderLabel = (label: string) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(180, 180, 180);
      pdf.text(label.toUpperCase(), margin, margin, { charSpace: 1 });
      
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.1);
      pdf.line(margin, margin + 2, pageWidth - margin, margin + 2);
    };

    // PAGE 1: COVER
    pdf.setFont("times", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text("INTERIEURONTWERP PORTFOLIO", pageWidth / 2, margin + 5, { align: "center", charSpace: 2 });

    if (state.projectTitle) {
      pdf.setFont("times", "italic");
      pdf.setFontSize(54);
      pdf.setTextColor(30, 30, 30);
      pdf.text(state.projectTitle, pageWidth / 2, margin + 40, { align: "center" });
      
      pdf.setDrawColor(30, 30, 30);
      pdf.setLineWidth(0.3);
      pdf.line(pageWidth / 2 - 15, margin + 48, pageWidth / 2 + 15, margin + 48);
    }

    const mainMoodboard = state.moodboardResultImages[1] || state.moodboardResultImages[0];
    if (mainMoodboard) {
      const imgY = margin + 65;
      const imgH = 130;
      const imgW = (imgH * 16) / 9;
      const xOffset = (pageWidth - imgW) / 2;
      
      // Add a subtle shadow/border effect for the image
      pdf.setDrawColor(245, 245, 245);
      pdf.setLineWidth(0.5);
      pdf.rect(Math.max(xOffset, margin) - 0.5, imgY - 0.5, Math.min(imgW, contentWidth) + 1, imgH + 1);
      
      pdf.addImage(mainMoodboard, 'PNG', Math.max(xOffset, margin), imgY, Math.min(imgW, contentWidth), imgH, undefined, 'FAST');
      
      pdf.setFont("times", "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(40, 40, 40);
      pdf.text("DESIGN CONCEPT & SFEER", margin, imgY + imgH + 25);
      
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      const dateStr = new Date().toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric' });
      pdf.text(`GEGENEREERD OP ${dateStr.toUpperCase()}`, margin, imgY + imgH + 32, { charSpace: 0.5 });
    }
    drawFooter();

    // PAGE 2: MATERIALEN
    if (state.moodboardResultImages[0]) {
      pdf.addPage();
      drawHeaderLabel("Kleur & Textuur");
      
      pdf.setFont("times", "bold");
      pdf.setFontSize(36);
      pdf.setTextColor(30, 30, 30);
      pdf.text("Materialen", margin, margin + 25);
      
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text("Een zorgvuldig samengestelde selectie van materialen en kleuren die de basis vormen voor uw nieuwe interieur.", margin, margin + 33, { maxWidth: contentWidth - 40 });
      
      const matImgY = margin + 50;
      const matImgH = 180;
      const matImgW = contentWidth;
      pdf.addImage(state.moodboardResultImages[0], 'PNG', margin, matImgY, matImgW, matImgH, undefined, 'FAST');
      
      drawFooter();
    }

    // PAGE 3: VISUALISATIE
    if (state.resultImage) {
      pdf.addPage();
      drawHeaderLabel("Visualisatie");
      
      pdf.setFont("times", "bold");
      pdf.setFontSize(36);
      pdf.setTextColor(30, 30, 30);
      pdf.text("Ontwerp", margin, margin + 25);
      
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text("De vertaling van het moodboard naar uw persoonlijke plattegrond, met oog voor detail en sfeer.", margin, margin + 33);
      
      const planW = contentWidth;
      const planH = (planW * 3) / 4; 
      const planY = (pageHeight / 2) - (planH / 2) + 10;
      
      pdf.setDrawColor(245, 245, 245);
      pdf.rect(margin - 1, planY - 1, planW + 2, planH + 2);
      pdf.addImage(state.resultImage, 'PNG', margin, planY, planW, planH, undefined, 'FAST');
      
      drawFooter();
    }

    // PAGE 4: PINTEREST & QR
    if (state.pinterestLink) {
      pdf.addPage();
      drawHeaderLabel("Inspiratie");
      
      const centerX = pageWidth / 2;
      
      pdf.setFont("times", "italic");
      pdf.setFontSize(42);
      pdf.setTextColor(30, 30, 30);
      pdf.text("Pinterest Board", centerX, margin + 50, { align: "center" });
      
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.2);
      pdf.line(centerX - 20, margin + 60, centerX + 20, margin + 60);

      const qrSize = 70;
      const qrY = pageHeight / 2 - qrSize / 2;
      
      try {
        const qrDataUrl = await QRCode.toDataURL(state.pinterestLink, { 
          margin: 2, 
          width: 500,
          color: {
            dark: '#1e1e1e',
            light: '#ffffff'
          }
        });
        
        // Draw a light frame for QR
        pdf.setDrawColor(240, 240, 240);
        pdf.rect(centerX - qrSize / 2 - 2, qrY - 2, qrSize + 4, qrSize + 4);
        pdf.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, qrY, qrSize, qrSize, undefined, 'FAST');
      } catch (err) {
        console.error("QR generation failed", err);
      }
      
      pdf.setTextColor(120, 120, 120);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text("Scan de QR-code om uw persoonlijke Pinterest bord te bekijken", centerX, qrY + qrSize + 20, { align: "center", charSpace: 0.2 });
      
      pdf.setTextColor(79, 70, 229);
      pdf.setFontSize(11);
      pdf.text(state.pinterestLink, centerX, qrY + qrSize + 30, { align: "center" });
      
      drawFooter();
    }

    return pdf;
  };

  const generatePDF = async () => {
    const pdf = await createPDFInstance();
    const fileName = state.projectTitle ? `Whoon_Advies_${state.projectTitle.replace(/\s+/g, '_')}.pdf` : "Whoon_Interieuradvies.pdf";
    pdf.save(fileName);
  };

  const handleShareEmail = async () => {
    if (!recipientEmail) {
      alert("Vul alstublieft een e-mailadres in.");
      return;
    }
    const subject = encodeURIComponent(`Interieurontwerp: ${state.projectTitle || 'Studio Whoon'}`);
    const body = encodeURIComponent(`Hier is uw ontwerp!\n\nProject: ${state.projectTitle}\n\nU kunt uw portfolio downloaden via de app.`);
    window.location.href = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
    setIsShareModalOpen(false);
  };

  const handleDirectShare = async () => {
    const pdf = await createPDFInstance();
    const pdfBlob = pdf.output('blob');
    const file = new File([pdfBlob], "Whoon_Interieurontwerp.pdf", { type: 'application/pdf' });
    if (navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Mijn Whoon Interieurontwerp', text: 'Hier is uw ontwerp!' });
      } catch (err) { console.error('Sharing failed', err); }
    } else {
      const url = URL.createObjectURL(pdfBlob);
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const buttonBaseClass = "transition-all duration-300 transform hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg focus:outline-none";

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm no-print">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-xl shadow-indigo-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            </div>
            <div>
              <h1 className="font-black text-2xl text-slate-900 tracking-tighter leading-none">Studio Whoon</h1>
              <p className="text-xs text-slate-500 font-bold mt-1.5 uppercase tracking-widest">Design en visualisatie</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex bg-slate-100 p-1.5 rounded-[1.25rem] border border-slate-200">
              <button onClick={() => setActiveTab('plattegrond')} className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest ${buttonBaseClass} ${activeTab === 'plattegrond' ? 'bg-white shadow-lg text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Plattegrond</button>
              <button onClick={() => setActiveTab('moodboard')} className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest ${buttonBaseClass} ${activeTab === 'moodboard' ? 'bg-white shadow-lg text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Moodboard</button>
            </div>
            <button onClick={handleReset} className={`flex items-center gap-2 px-6 py-2.5 text-[10px] font-black uppercase text-rose-500 hover:bg-rose-50 rounded-xl border border-rose-100 shadow-sm group ${buttonBaseClass}`}>
              <svg className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Begin opnieuw
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-10">
        <aside className="lg:col-span-4 space-y-8 no-print overflow-y-auto max-h-[calc(100vh-160px)] pr-2 custom-scrollbar">
          <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">PROJECT DETAILS</h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">Projectnaam</label>
                <input type="text" placeholder="bijv. Landhuis Bosch" value={state.projectTitle} onChange={(e) => setState(prev => ({...prev, projectTitle: e.target.value}))} className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">Pinterest bord link</label>
                <input type="url" placeholder="https://pinterest.com/jouw-bord" value={state.pinterestLink} onChange={(e) => setState(prev => ({...prev, pinterestLink: e.target.value}))} className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" />
              </div>
            </div>
          </section>

          {activeTab === 'plattegrond' ? (
            <>
              <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
                <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">1. BESTAND</h2>
                <div className="relative group">
                  <input ref={floorPlanInputRef} type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'floorplan')} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  <div className={`border-2 border-dashed rounded-3xl p-10 transition-all duration-300 text-center ${state.originalImage ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 hover:border-indigo-300 bg-slate-50'}`}>
                    <svg className={`w-12 h-12 mx-auto mb-4 ${state.originalImage ? 'text-indigo-500 scale-110' : 'text-slate-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <p className="text-sm font-black text-slate-800">{state.originalImage ? 'Bestand geladen' : 'Upload Plattegrond'}</p>
                  </div>
                </div>
                {state.originalImage && !state.resultImage && (
                  <button onClick={handleAnalyze} disabled={state.isDetectingFurniture} className={`w-full mt-4 py-4 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-indigo-100 text-indigo-600 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2`}>
                    {state.isDetectingFurniture ? <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : "Analyseer Plattegrond (Optioneel)"}
                  </button>
                )}
              </section>

              {state.floorPlanDescription && !state.resultImage && (
                <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">2. ANALYSE & MEUBELS</h2>
                  <div className="mb-6 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                    <p className="text-xs text-indigo-900 leading-relaxed font-medium">{state.floorPlanDescription}</p>
                  </div>
                  {state.detectedFurniture.length > 0 && (
                    <div className="space-y-2">
                      {Array.from(new Set(state.detectedFurniture.map(f => f.type))).map(type => {
                        const count = state.detectedFurniture.filter(f => f.type === type).length;
                        return (
                          <div key={type} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-xs font-black uppercase text-slate-700">{type}</span>
                            <span className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg text-[10px] font-black">{count}x</span>
                          </div>
                        );
                      })}
                      <button onClick={() => { setCurrentFurnitureIndex(0); setIsFurnitureModalOpen(true); }} className="w-full mt-2 py-3 text-[10px] font-black uppercase text-indigo-600 hover:underline">Meubels Aanpassen</button>
                    </div>
                  )}
                </section>
              )}

              <div className="space-y-3">
                {state.moodboardResultImages.length === 0 && (
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start gap-3 shadow-sm">
                    <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-[10px] font-black text-amber-700 leading-relaxed uppercase tracking-wider">Tip: Je hebt geen moodboard gemaakt. De visualisatie krijgt standaard neutrale kleuren.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={() => handleGenerate('2D')} disabled={!state.originalImage || state.isGenerating} className={`w-full py-4 rounded-2xl font-black text-white shadow-lg flex items-center justify-center gap-3 ${buttonBaseClass} ${(!state.originalImage || state.isGenerating) ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                    {state.isGenerating && state.lastGeneratedMode === '2D' ? <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <span className="text-xs uppercase tracking-widest">2D Genereren</span>}
                  </button>
                  <button onClick={() => handleGenerate('2.5D')} disabled={!state.originalImage || state.isGenerating} className={`w-full py-4 rounded-2xl font-black text-white shadow-lg flex items-center justify-center gap-3 ${buttonBaseClass} ${(!state.originalImage || state.isGenerating) ? 'bg-slate-300 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-200'}`}>
                    {state.isGenerating && state.lastGeneratedMode === '2.5D' ? <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <span className="text-xs uppercase tracking-widest">2.5D Genereren</span>}
                  </button>
                </div>
              </div>

              {state.resultImage && (
                <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">VERFIJN ONTWERP</h2>
                  <div className="space-y-4">
                    <div className="max-h-48 overflow-y-auto space-y-3 mb-4 custom-scrollbar">
                      {state.refinementChat.map((msg, i) => (
                        <div key={i} className={`p-3 rounded-2xl text-xs ${msg.role === 'user' ? 'bg-indigo-50 text-indigo-900 ml-4' : 'bg-slate-50 text-slate-600 mr-4'}`}>
                          <p className="font-black uppercase text-[8px] mb-1 opacity-50">{msg.role === 'user' ? 'Jij' : 'Studio Whoon'}</p>
                          {msg.text}
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleChatSubmit} className="relative">
                      {state.currentAnnotation && (
                        <div className="absolute -top-16 left-0 right-0 p-2 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between animate-in slide-in-from-bottom-2">
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-white shadow-sm bg-white">
                              <img src={state.currentAnnotation} className="w-full h-full object-contain" />
                            </div>
                            <span className="text-[10px] font-black text-indigo-600 uppercase">Gebied geselecteerd</span>
                          </div>
                          <button type="button" onClick={clearAnnotation} className="text-indigo-400 hover:text-indigo-600 p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                      )}
                      <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={isDrawingMode ? "Vertel wat je hier wilt wijzigen..." : "bijv. De bank toch groen..."} className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all pr-12" />
                      <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-600 hover:scale-110 transition-transform"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg></button>
                    </form>
                  </div>
                </section>
              )}
              {state.error && <p className="text-rose-500 text-[10px] font-black text-center px-4 uppercase tracking-widest leading-relaxed bg-rose-50 p-4 rounded-2xl border border-rose-100">{state.error}</p>}
            </>
          ) : (
            <>
              <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">MOODBOARD INSPIRATIE</h2>
                <div className="relative group mb-6">
                  <input ref={moodboardInputRef} type="file" multiple accept="image/*" onChange={(e) => handleFileUpload(e, 'moodboard')} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  <div className={`border-2 border-dashed rounded-3xl p-8 transition-all duration-300 text-center ${state.moodboardSourceImages.length > 0 ? 'border-pink-200 bg-pink-50/20' : 'border-slate-100 bg-slate-50 hover:border-pink-200'}`}>
                    <svg className="w-10 h-10 mx-auto mb-3 text-slate-300 group-hover:text-pink-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    <p className="text-xs font-black text-slate-700">Upload Inspiratiebeelden</p>
                  </div>
                </div>
                {state.moodboardSourceImages.length > 0 && <div className="grid grid-cols-3 gap-3">{state.moodboardSourceImages.map((img, i) => <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-slate-100 shadow-sm transition-transform hover:scale-105"><img src={img} className="w-full h-full object-cover" /></div>)}</div>}
              </section>
              <button onClick={handleGenerateMoodboard} disabled={state.moodboardSourceImages.length === 0 || state.isGeneratingMoodboard} className={`w-full py-6 rounded-[2rem] font-black text-white shadow-2xl ${buttonBaseClass} ${state.moodboardSourceImages.length === 0 || state.isGeneratingMoodboard ? 'bg-slate-300 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-700 shadow-pink-100'}`}>
                {state.isGeneratingMoodboard ? <svg className="animate-spin h-6 w-6 text-white mx-auto" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <span className="text-sm uppercase tracking-widest">Moodboards Creëren</span>}
              </button>
            </>
          )}
        </aside>

        <section className="lg:col-span-8 space-y-8">
          <div className="bg-white rounded-[3.5rem] p-6 border border-slate-200 shadow-2xl flex flex-col h-full min-h-[700px] relative overflow-hidden">
            {(state.isGenerating || state.isGeneratingMoodboard) && (
              <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-2xl flex items-center justify-center p-10 text-center">
                <div className="max-w-sm">
                  <div className="w-24 h-24 bg-indigo-600 rounded-[2.5rem] mx-auto mb-10 flex items-center justify-center shadow-2xl animate-bounce"><svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg></div>
                  <h3 className="text-3xl font-black mb-4">Studio Whoon</h3>
                  <p className="text-indigo-600 font-black text-sm uppercase tracking-widest animate-pulse">{state.progressMessage}</p>
                </div>
              </div>
            )}
            <div className="flex-1 flex flex-col relative">
              {activeTab === 'plattegrond' ? (
                <>
                  <div className="flex-1 flex items-center justify-center p-4">
                    {!state.originalImage ? <div className="text-center"><p className="font-black text-slate-200 text-2xl uppercase tracking-[0.2em] mb-4">Plattegrond Nodig</p><div className="w-32 h-1 bg-slate-100 mx-auto rounded-full"></div></div> : (
                      <div className="relative group max-w-full max-h-full">
                        {showOriginal ? <img src={state.originalImage} className="max-w-full max-h-full object-contain rounded-3xl shadow-xl transition-all duration-700" /> : (
                          <div className="relative">
                            <img ref={imageRef} src={state.resultImage || state.originalImage} className="max-w-full max-h-full object-contain rounded-3xl shadow-xl animate-in fade-in zoom-in duration-500" />
                            {state.resultImage && (
                              <canvas
                                ref={canvasRef}
                                className={`absolute inset-0 w-full h-full cursor-crosshair z-20 ${isDrawingMode ? 'pointer-events-auto' : 'pointer-events-none'}`}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {state.originalImage && (
                    <div className="p-6 bg-slate-50/60 rounded-[2.5rem] flex items-center justify-between border border-white mt-auto">
                      <div className="flex bg-white p-1 rounded-2xl shadow-sm">
                        <button onClick={() => setShowOriginal(true)} className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase ${buttonBaseClass} ${showOriginal ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Origineel</button>
                        <button disabled={!state.resultImage} onClick={() => setShowOriginal(false)} className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase ${buttonBaseClass} ${(!showOriginal && state.resultImage) ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 disabled:opacity-30'}`}>Visualisatie</button>
                      </div>
                      <div className="flex gap-4">
                        {state.resultImage && !showOriginal && (
                          <div className="flex gap-2">
                            {isDrawingMode && (
                              <button onClick={clearAnnotation} className={`px-4 py-3 bg-white text-rose-500 border border-rose-100 rounded-2xl text-[10px] font-black uppercase shadow-sm ${buttonBaseClass}`}>
                                Wissen
                              </button>
                            )}
                            <button onClick={() => setIsDrawingMode(!isDrawingMode)} className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase flex items-center gap-3 ${buttonBaseClass} ${isDrawingMode ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border border-indigo-100'}`}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              {isDrawingMode ? 'Klaar' : 'Omcirkel gebied'}
                            </button>
                          </div>
                        )}
                        {(state.resultImage || state.moodboardResultImages.length > 0) && (
                          <>
                            <button onClick={() => setIsShareModalOpen(true)} className={`px-8 py-3 bg-white text-indigo-600 border border-indigo-100 rounded-2xl text-[10px] font-black uppercase shadow-sm flex items-center gap-3 ${buttonBaseClass}`}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>Delen</button>
                            <button onClick={generatePDF} className={`px-8 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-black shadow-lg flex items-center gap-3 ${buttonBaseClass}`}><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>Portfolio PDF</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex flex-col p-4">
                  {state.moodboardResultImages.length > 0 ? (
                    <>
                      <div className="flex-1 flex items-center justify-center mb-6 overflow-hidden"><img key={moodboardViewIndex} src={state.moodboardResultImages[moodboardViewIndex]} className="max-w-full max-h-full object-contain rounded-3xl shadow-xl animate-in slide-in-from-right fade-in duration-500" /></div>
                      <div className="p-4 bg-slate-50 rounded-3xl flex items-center justify-between border border-white">
                        <div className="flex gap-4">
                          <button onClick={() => setMoodboardViewIndex(0)} className={`px-8 py-3 rounded-xl text-xs font-black uppercase ${buttonBaseClass} ${moodboardViewIndex === 0 ? 'bg-pink-600 text-white shadow-lg' : 'bg-white text-slate-400 hover:text-slate-600'}`}>Materialen (Concept 1)</button>
                          <button onClick={() => setMoodboardViewIndex(1)} className={`px-8 py-3 rounded-xl text-xs font-black uppercase ${buttonBaseClass} ${moodboardViewIndex === 1 ? 'bg-pink-600 text-white shadow-lg' : 'bg-white text-slate-400 hover:text-slate-600'}`}>Basic Naturel (Concept 2)</button>
                        </div>
                      </div>
                    </>
                  ) : <div className="m-auto text-center space-y-4"><p className="font-black text-slate-200 text-3xl uppercase tracking-[0.2em]">Ontwerp de Sfeer</p><p className="text-slate-400 text-sm max-w-xs mx-auto font-black uppercase tracking-widest leading-loose">Upload inspiratiebeelden en genereer moodboards als basis voor je visualisatie.</p></div>}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {isFurnitureModalOpen && state.detectedFurniture.length > 0 && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" onClick={() => setIsFurnitureModalOpen(false)}></div>
          <div className="relative bg-white rounded-[3rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in fade-in duration-300 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-black mb-1">Meubelkeuze</h2>
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Item {currentFurnitureIndex + 1} van {state.detectedFurniture.length}</p>
              </div>
              <div className="flex gap-2">
                <div className="h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${((currentFurnitureIndex + 1) / state.detectedFurniture.length) * 100}%` }}></div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
              <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 text-center">
                <span className="inline-block px-4 py-2 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-full mb-4 shadow-lg shadow-indigo-100">{state.detectedFurniture[currentFurnitureIndex].type}</span>
                <p className="text-slate-500 text-sm font-medium">Wat voor product en kleur wil je voor deze {state.detectedFurniture[currentFurnitureIndex].type}?</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">Product / Model</label>
                    <input type="text" placeholder="bijv. Hoekbank 'Luxe'" value={state.detectedFurniture[currentFurnitureIndex].product || ''} onChange={(e) => updateFurnitureChoice(currentFurnitureIndex, { product: e.target.value })} className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">Kleur (HEX, RAL, Naam)</label>
                    <input type="text" placeholder="bijv. #4A90E2 of RAL 7016" value={state.detectedFurniture[currentFurnitureIndex].color || ''} onChange={(e) => updateFurnitureChoice(currentFurnitureIndex, { color: e.target.value })} className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">Referentie-afbeelding</label>
                  <div className="relative group aspect-square">
                    <input type="file" accept="image/*" onChange={(e) => handleFurnitureRefUpload(e, currentFurnitureIndex)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                    <div className={`h-full border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-4 transition-all ${state.detectedFurniture[currentFurnitureIndex].referenceImage ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100 bg-slate-50'}`}>
                      {state.detectedFurniture[currentFurnitureIndex].referenceImage ? (
                        <img src={state.detectedFurniture[currentFurnitureIndex].referenceImage!} className="w-full h-full object-cover rounded-2xl" />
                      ) : (
                        <>
                          <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          <p className="text-[10px] font-black text-slate-400 uppercase">Upload</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl">
                <input type="checkbox" id="skip-item" checked={state.detectedFurniture[currentFurnitureIndex].skip} onChange={(e) => updateFurnitureChoice(currentFurnitureIndex, { skip: e.target.checked })} className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <label htmlFor="skip-item" className="text-xs font-black uppercase text-slate-600 cursor-pointer">Dit meubel overslaan (niet aanpassen)</label>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-between gap-4">
              <button onClick={() => setCurrentFurnitureIndex(prev => Math.max(0, prev - 1))} disabled={currentFurnitureIndex === 0} className={`px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 border-slate-100 text-slate-400 disabled:opacity-30 ${buttonBaseClass}`}>Vorige</button>
              {currentFurnitureIndex < state.detectedFurniture.length - 1 ? (
                <button onClick={() => setCurrentFurnitureIndex(prev => prev + 1)} className={`px-12 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl ${buttonBaseClass}`}>Volgende</button>
              ) : (
                <button onClick={() => setIsFurnitureModalOpen(false)} className={`px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-100 ${buttonBaseClass}`}>Bevestigen</button>
              )}
            </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" onClick={() => setIsShareModalOpen(false)}></div>
          <div className="relative bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in fade-in duration-300">
            <button onClick={() => setIsShareModalOpen(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-500 transition-colors"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-600"><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></div>
              <h2 className="text-2xl font-black mb-2">Deel Ontwerp</h2><p className="text-slate-400 text-sm font-medium">Stuur je portfolio direct naar een e-mailadres of kopieer de link.</p>
            </div>
            <div className="space-y-6">
              <div><label className="text-[10px] font-black text-slate-500 uppercase block mb-2 px-1">E-mailadres Ontvanger</label><input type="email" placeholder="bijv. klant@example.com" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className="w-full px-6 py-4 rounded-2xl border border-slate-100 bg-slate-50 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" /></div>
              <div className="grid grid-cols-2 gap-4"><button onClick={handleDirectShare} className={`flex items-center justify-center gap-2 py-4 px-2 rounded-2xl border-2 border-indigo-50 font-black text-[10px] uppercase transition-all ${copied ? 'bg-green-50 text-green-600 border-green-100' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>{copied ? 'Gekopieerd!' : (navigator.share ? 'Direct Delen' : 'Kopieer Link')}</button><button onClick={handleShareEmail} className={`flex items-center justify-center gap-2 py-4 px-2 bg-indigo-600 rounded-2xl font-black text-[10px] uppercase text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all`}>E-mail Verzenden</button></div>
            </div>
            <p className="mt-8 text-center text-[9px] text-slate-300 font-bold uppercase tracking-widest italic">"Hier is uw ontwerp!"</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
