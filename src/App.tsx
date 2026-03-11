import React, { useState, useEffect, useRef } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  isAfter,
  isBefore,
  eachDayOfInterval,
  parseISO
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, FlaskConical, Beaker, ClipboardList, BrainCircuit, Settings, Info, ArrowRight, FolderKanban, BookOpen, Trash2, Edit3, CheckCircle2, XCircle, Menu, X, LogIn, LogOut, User, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { cn } from './lib/utils';
import { seedCommonTemplates } from './services/templateSeeder';
import { Experiment, Template, ExperimentStep, Record as ExpRecord, Project, ProjectArgument } from './types';
import Markdown from 'react-markdown';
import { db, auth, signInWithGoogle } from './firebase';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, where, Timestamp, getDocs, limit } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import * as gemini from './services/geminiService';

// --- Components ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-50 p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-red-600 mb-6">
            <XCircle size={32} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Something went wrong</h1>
          <p className="text-zinc-500 max-w-md mb-8">
            The application encountered an unexpected error. This might be due to missing configuration or a temporary connection issue.
          </p>
          <div className="bg-zinc-100 p-4 rounded-xl text-left overflow-auto max-w-xl w-full mb-8">
            <p className="text-xs font-mono text-zinc-600 whitespace-pre-wrap">
              {this.state.error?.toString()}
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-all shadow-lg"
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }: { isOpen: boolean, title: string, message: string, onConfirm: () => void, onCancel: () => void }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8"
      >
        <h3 className="text-xl font-bold mb-2">{title}</h3>
        <p className="text-zinc-500 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all">Cancel</button>
          <button 
            onClick={() => {
              onConfirm();
              onCancel();
            }} 
            className="flex-1 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-all shadow-lg"
          >
            Delete
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
      active 
        ? "bg-zinc-900 text-white shadow-lg" 
        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    )}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'templates' | 'projects' | 'records' | 'ai'>('calendar');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [preSelectedTemplateId, setPreSelectedTemplateId] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authTimeout, setAuthTimeout] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });

    const timer = setTimeout(() => {
      if (!isAuthReady) setAuthTimeout(true);
    }, 8000);

    return () => {
      unsubscribeAuth();
      clearTimeout(timer);
    };
  }, [isAuthReady]);

  useEffect(() => {
    if (!user) return;

    // Real-time listeners
    const qExperiments = query(collection(db, 'experiments'), orderBy('start_date', 'desc'));
    const unsubscribeExperiments = onSnapshot(qExperiments, (snapshot) => {
      setExperiments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });

    const qTemplates = query(collection(db, 'templates'), orderBy('name', 'asc'));
    const unsubscribeTemplates = onSnapshot(qTemplates, (snapshot) => {
      setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });

    const qProjects = query(collection(db, 'projects'), orderBy('created_at', 'desc'));
    const unsubscribeProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });

    return () => {
      unsubscribeExperiments();
      unsubscribeTemplates();
      unsubscribeProjects();
    };
  }, [user]);

  if (!isAuthReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-50 gap-4 p-6 text-center">
        <motion.div
          animate={{ 
            rotate: [0, 10, -10, 10, 0],
            scale: [1, 1.1, 1]
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-16 h-16 bg-zinc-900 rounded-3xl flex items-center justify-center text-white shadow-2xl"
        >
          <FlaskConical size={32} />
        </motion.div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-zinc-900 font-bold tracking-tight">Lab Planner</p>
          <p className="text-zinc-400 text-xs font-medium animate-pulse">Initializing research environment...</p>
        </div>
        {authTimeout && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 max-w-xs"
          >
            <p className="text-xs text-zinc-400 leading-relaxed">
              This is taking longer than usual. Please check your internet connection or verify that your Firebase configuration is correct.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 text-xs font-bold text-zinc-900 underline"
            >
              Try Reloading
            </button>
          </motion.div>
        )}
      </div>
    );
  }

  const handleUseTemplate = (id: string) => {
    setPreSelectedTemplateId(id);
    setIsAddModalOpen(true);
  };

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setIsTemplateModalOpen(true);
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">Lab Planner</h1>
        <p className="text-zinc-500 mt-1">Manage your research workflow efficiently.</p>
      </div>
      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-3 py-1.5 bg-zinc-100 border border-zinc-200 rounded-full shadow-sm">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full border border-white shadow-sm" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">
                  {user.displayName?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
              <span className="text-sm font-semibold text-zinc-700">{user.displayName}</span>
              <button 
                onClick={() => signOut(auth)} 
                className="ml-1 p-1 text-zinc-400 hover:text-zinc-900 transition-colors"
                title="Sign Out"
              >
                <LogOut size={14} />
              </button>
            </div>
            {activeTab === 'templates' ? (
              <button 
                onClick={() => {
                  setEditingTemplate(null);
                  setIsTemplateModalOpen(true);
                }}
                className="flex items-center gap-2 bg-zinc-900 text-white px-5 py-2.5 rounded-xl hover:bg-zinc-800 transition-all shadow-md active:scale-95"
              >
                <Plus size={18} />
                <span className="font-medium">New Template</span>
              </button>
            ) : (
              <button 
                onClick={() => {
                  setPreSelectedTemplateId(null);
                  setIsAddModalOpen(true);
                }}
                className="flex items-center gap-2 bg-zinc-900 text-white px-5 py-2.5 rounded-xl hover:bg-zinc-800 transition-all shadow-md active:scale-95"
              >
                <Plus size={18} />
                <span className="font-medium">New Experiment</span>
              </button>
            )}
          </div>
        ) : (
          <button 
            onClick={signInWithGoogle}
            className="flex items-center gap-2 bg-zinc-900 text-white px-5 py-2.5 rounded-xl hover:bg-zinc-800 transition-all shadow-md active:scale-95"
          >
            <LogIn size={18} />
            <span className="font-medium">Sign In with Google</span>
          </button>
        )}
      </div>
    </div>
  );

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    const experimentId = e.dataTransfer.getData('experimentId');
    if (!experimentId) return;

    const newDate = format(date, 'yyyy-MM-dd');
    await updateDoc(doc(db, 'experiments', experimentId), { start_date: newDate });
  };

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return (
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-bottom border-zinc-100">
          <h2 className="text-xl font-semibold text-zinc-900">{format(currentDate, 'MMMM yyyy')}</h2>
          <div className="flex gap-2">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors">
              <ChevronLeft size={20} />
            </button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-t border-zinc-100">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-3 text-center text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{day[0]}</span>
            </div>
          ))}
          {days.map((day, i) => {
            const dayExperiments = experiments.filter(exp => {
              const start = parseISO(exp.start_date);
              const end = addDays(start, exp.max_day_offset || 0);
              return isSameDay(day, start) || (isAfter(day, start) && isBefore(day, addDays(end, 1)));
            });
            return (
              <div 
                key={i} 
                onClick={() => setSelectedDay(day)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, day)}
                className={cn(
                  "lg:min-h-[140px] min-h-[80px] p-2 border-r border-b border-zinc-100 transition-all cursor-pointer hover:bg-zinc-50/50",
                  !isSameMonth(day, monthStart) && "bg-zinc-50/30 text-zinc-300"
                )}
              >
                <div className={cn(
                  "text-sm font-medium mb-2 w-7 h-7 flex items-center justify-center rounded-full",
                  isSameDay(day, new Date()) ? "bg-zinc-900 text-white" : "text-zinc-600"
                )}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {dayExperiments.map(exp => (
                    <div 
                      key={exp.id}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('experimentId', exp.id.toString())}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedExperimentId(exp.id);
                      }}
                      className="px-2 py-1 rounded-md text-[10px] font-bold truncate border shadow-sm cursor-move"
                      style={{ 
                        backgroundColor: `${exp.color}15`, 
                        borderColor: exp.color,
                        color: exp.color 
                      }}
                    >
                      {exp.name}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-zinc-50 font-sans overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-72 bg-white border-r border-zinc-200 p-6 flex flex-col z-50 transition-transform duration-300 lg:relative lg:translate-x-0",
        !isSidebarOpen && "-translate-x-full"
      )}>
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <FlaskConical size={22} />
            </div>
            <span className="text-xl font-bold tracking-tight text-zinc-900">Lab Planner</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 hover:bg-zinc-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <nav className="space-y-2 flex-1">
          <SidebarItem 
            icon={FlaskConical} 
            label="Calendar" 
            active={activeTab === 'calendar'} 
            onClick={() => { setActiveTab('calendar'); setIsSidebarOpen(false); }} 
          />
          <SidebarItem 
            icon={FolderKanban} 
            label="Projects" 
            active={activeTab === 'projects'} 
            onClick={() => { setActiveTab('projects'); setIsSidebarOpen(false); }} 
          />
          <SidebarItem 
            icon={Beaker} 
            label="Templates" 
            active={activeTab === 'templates'} 
            onClick={() => { setActiveTab('templates'); setIsSidebarOpen(false); }} 
          />
          <SidebarItem 
            icon={BookOpen} 
            label="Records" 
            active={activeTab === 'records'} 
            onClick={() => { setActiveTab('records'); setIsSidebarOpen(false); }} 
          />
          <SidebarItem 
            icon={BrainCircuit} 
            label="AI Assistant" 
            active={activeTab === 'ai'} 
            onClick={() => { setActiveTab('ai'); setIsSidebarOpen(false); }} 
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-zinc-100">
          <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 mb-6">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Quick Stats</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-bold">{experiments.length}</p>
                <p className="text-[10px] text-zinc-500">Total Exp</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{experiments.filter(e => e.status === 'completed').length}</p>
                <p className="text-[10px] text-zinc-500">Completed</p>
              </div>
            </div>
          </div>
          <SidebarItem icon={Settings} label="Settings" active={false} onClick={() => {}} />
          <SidebarItem icon={Info} label="Help Center" active={false} onClick={() => {}} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-zinc-50/50">
        <div className="p-4 lg:p-12 max-w-7xl mx-auto">
          <div className="lg:hidden flex items-center justify-between mb-6">
            <button 
              onClick={() => setIsSidebarOpen(true)} 
              className="p-2 hover:bg-zinc-200 rounded-xl bg-white border border-zinc-200 shadow-sm transition-all active:scale-95"
            >
              <Menu size={24} />
            </button>
            <button 
              onClick={() => setActiveTab('ai')}
              className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white shadow-md hover:bg-zinc-800 transition-all active:scale-95"
              title="Open AI Assistant"
            >
              <FlaskConical size={20} />
            </button>
          </div>
          
          {renderHeader()}
        
        <AnimatePresence mode="wait">
          {activeTab === 'calendar' && (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {renderCalendar()}
            </motion.div>
          )}

          {activeTab === 'templates' && (
            <motion.div
              key="templates"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {templates.length === 0 && (
                <div className="bg-white p-12 rounded-3xl border border-zinc-200 text-center">
                  <Beaker size={48} className="mx-auto mb-4 text-zinc-300" />
                  <h3 className="text-xl font-bold mb-2">No Templates Yet</h3>
                  <p className="text-zinc-500 mb-8 max-w-md mx-auto">Create your own experiment templates or start with our pre-configured common lab protocols.</p>
                  <button 
                    disabled={isSeeding}
                    onClick={async () => {
                      setIsSeeding(true);
                      await seedCommonTemplates();
                      setIsSeeding(false);
                    }}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2 mx-auto disabled:opacity-50"
                  >
                    {isSeeding ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                    {isSeeding ? 'Importing...' : 'Import Common Templates'}
                  </button>
                </div>
              )}
              
              {templates.length > 0 && (
                <div className="flex justify-end">
                  <button 
                    disabled={isSeeding}
                    onClick={async () => {
                      setIsSeeding(true);
                      await seedCommonTemplates();
                      setIsSeeding(false);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 bg-indigo-50 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                  >
                    {isSeeding ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {isSeeding ? 'Importing...' : 'Import Common Templates'}
                  </button>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map(template => (
                  <div key={template.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative">
                  <button 
                    onClick={() => handleEditTemplate(template)}
                    className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Settings size={16} />
                  </button>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white" style={{ backgroundColor: template.color }}>
                      <Beaker size={24} />
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-100 text-zinc-500 uppercase tracking-wider">
                      {template.type}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2">{template.name}</h3>
                  <p className="text-zinc-500 text-sm mb-6 line-clamp-2">{template.description}</p>
                  <button 
                    onClick={() => handleUseTemplate(template.id)}
                    className="w-full py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all"
                  >
                    Use Template
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

          {activeTab === 'projects' && (
            <motion.div
              key="projects"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {selectedProjectId ? (
                <ProjectDetailView 
                  projectId={selectedProjectId} 
                  onBack={() => setSelectedProjectId(null)} 
                  onExperimentClick={(id) => setSelectedExperimentId(id)}
                />
              ) : (
                <ProjectsView onSelectProject={setSelectedProjectId} />
              )}
            </motion.div>
          )}

          {activeTab === 'records' && (
            <motion.div
              key="records"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <RecordsView />
            </motion.div>
          )}

          {activeTab === 'ai' && (
            <motion.div
              key="ai"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AIView />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </main>

      {/* Modals */}
      {isAddModalOpen && (
        <AddExperimentModal 
          templates={templates} 
          initialTemplateId={preSelectedTemplateId}
          onClose={() => {
            setIsAddModalOpen(false);
            setPreSelectedTemplateId(null);
          }} 
          onSuccess={() => {
            setIsAddModalOpen(false);
            setPreSelectedTemplateId(null);
          }}
        />
      )}

      {isTemplateModalOpen && (
        <TemplateModal 
          template={editingTemplate}
          onClose={() => {
            setIsTemplateModalOpen(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            setIsTemplateModalOpen(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {selectedExperimentId && (
        <ExperimentDetailModal 
          id={selectedExperimentId} 
          onClose={() => setSelectedExperimentId(null)} 
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function SampleTable({ title, initialData, onSave, onRemove }: { title: string, initialData?: string, onSave: (data: string) => void, onRemove?: () => void }) {
  const [tableTitle, setTableTitle] = useState(title);
  const [rows, setRows] = useState<string[][]>(() => {
    if (initialData) {
      try {
        return JSON.parse(initialData);
      } catch (e) {
        return [['', ''], ['', '']];
      }
    }
    return [['Sample ID', 'Concentration', 'Volume'], ['', '', '']];
  });

  const addRow = () => setRows([...rows, Array(rows[0].length).fill('')]);
  const addCol = () => setRows(rows.map(row => [...row, '']));
  
  const removeRow = (idx: number) => {
    if (rows.length > 1) setRows(rows.filter((_, i) => i !== idx));
  };
  
  const removeCol = (idx: number) => {
    if (rows[0].length > 1) setRows(rows.map(row => row.filter((_, i) => i !== idx)));
  };

  const updateCell = (r: number, c: number, val: string) => {
    const newRows = [...rows];
    newRows[r][c] = val;
    setRows(newRows);
  };

  const handleSave = () => {
    onSave(JSON.stringify({ title: tableTitle, data: rows }));
  };

  return (
    <div className="space-y-4 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm mb-8">
      <div className="flex justify-between items-center">
        <input 
          value={tableTitle}
          onChange={e => setTableTitle(e.target.value)}
          className="text-sm font-bold text-zinc-900 bg-transparent outline-none border-b border-transparent focus:border-zinc-200"
        />
        <div className="flex gap-2">
          <button onClick={addCol} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 transition-all">+ Add Column</button>
          <button onClick={addRow} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 transition-all">+ Add Row</button>
          <button onClick={handleSave} className="text-[10px] font-bold text-white bg-zinc-900 px-3 py-1 rounded-lg hover:bg-zinc-800 transition-all shadow-sm">Save Table</button>
          {onRemove && (
            <button onClick={onRemove} className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg hover:bg-red-100 transition-all">Remove</button>
          )}
        </div>
      </div>
      
      <div className="overflow-x-auto rounded-2xl border border-zinc-100">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-50">
              {rows[0].map((_, c) => (
                <th key={c} className="border-b border-r border-zinc-200 p-0 group relative">
                  <div className="flex items-center">
                    <input 
                      className="w-full p-3 bg-transparent font-bold text-zinc-600 outline-none text-center"
                      value={rows[0][c]}
                      onChange={e => updateCell(0, c, e.target.value)}
                    />
                    <button 
                      onClick={() => removeCol(c)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center shadow-md z-10"
                    >
                      <Plus size={12} className="rotate-45" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, rIdx) => (
              <tr key={rIdx} className="group">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="border-b border-r border-zinc-100 p-0 relative">
                    <input 
                      className="w-full p-3 outline-none focus:bg-indigo-50/30 transition-all"
                      value={cell}
                      onChange={e => updateCell(rIdx + 1, cIdx, e.target.value)}
                    />
                    {cIdx === row.length - 1 && (
                      <button 
                        onClick={() => removeRow(rIdx + 1)}
                        className="absolute top-1/2 -right-2 -translate-y-1/2 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center shadow-md z-10"
                      >
                        <Plus size={12} className="rotate-45" />
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectDetailView({ projectId, onBack, onExperimentClick }: { projectId: string, onBack: () => void, onExperimentClick: (id: string) => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [arguments_, setArguments] = useState<(ProjectArgument & { experiments: Experiment[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingArgId, setEditingArgId] = useState<string | null>(null);
  const [newPlannedExp, setNewPlannedExp] = useState('');
  const [isAddArgModalOpen, setIsAddArgModalOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    
    const unsubscribeProject = onSnapshot(doc(db, 'projects', projectId), (docSnap) => {
      if (docSnap.exists()) {
        setProject({ id: docSnap.id, ...docSnap.data() } as any);
      }
    });

    const qArgs = query(collection(db, 'project_arguments'), where('project_id', '==', projectId));
    const unsubscribeArgs = onSnapshot(qArgs, (snapshot) => {
      const argsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      // We'll filter experiments locally for now or set up another listener
      // For simplicity in this large refactor, I'll use a listener for all experiments and filter
      const qExps = query(collection(db, 'experiments'), where('project_id', '==', projectId));
      onSnapshot(qExps, (expSnapshot) => {
        const exps = expSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        const argsWithExps = argsData.map(arg => ({
          ...arg,
          experiments: exps.filter(e => e.argument_id === arg.id)
        }));
        setArguments(argsWithExps);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeProject();
      unsubscribeArgs();
    };
  }, [projectId]);

  const handleAddPlannedExp = async (argId: string, currentPlanned: string | undefined) => {
    if (!newPlannedExp) return;
    const planned = currentPlanned ? JSON.parse(currentPlanned) : [];
    const updated = JSON.stringify([...planned, { name: newPlannedExp, completed: false }]);
    
    await updateDoc(doc(db, 'project_arguments', argId), { planned_experiments: updated });
    setNewPlannedExp('');
    setEditingArgId(null);
  };

  const togglePlannedExp = async (argId: string, currentPlanned: string | undefined, expIdx: number) => {
    const planned = JSON.parse(currentPlanned || '[]');
    planned[expIdx].completed = !planned[expIdx].completed;
    
    await updateDoc(doc(db, 'project_arguments', argId), { planned_experiments: JSON.stringify(planned) });
  };

  const removePlannedExp = async (argId: string, currentPlanned: string | undefined, expIdx: number) => {
    const planned = JSON.parse(currentPlanned || '[]');
    const updated = planned.filter((_: any, i: number) => i !== expIdx);
    
    await updateDoc(doc(db, 'project_arguments', argId), { planned_experiments: JSON.stringify(updated) });
  };

  const handleDeleteArg = async (argId: string) => {
    if (window.confirm('Are you sure you want to delete this research point?')) {
      await deleteDoc(doc(db, 'project_arguments', argId));
    }
  };

  if (loading || !project) return <div className="p-12 text-center text-zinc-400">Loading project details...</div>;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-zinc-100 rounded-xl transition-all">
          <ChevronLeft size={24} />
        </button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{project.name}</h2>
          <p className="text-zinc-500 mt-1">{project.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <BrainCircuit className="text-indigo-600" size={24} />
              Logic Chain & Research Points (逻辑链与论证观点)
            </h3>
            <button 
              onClick={() => setIsAddArgModalOpen(true)}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-bold text-sm"
            >
              <Plus size={18} />
              Add Research Point
            </button>
          </div>
          
          <div className="space-y-6">
            {arguments_.map((arg, idx) => (
              <div key={arg.id} className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden group/main">
                <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-lg font-medium text-zinc-800 leading-relaxed">{arg.content}</p>
                  </div>
                  <button 
                    onClick={() => handleDeleteArg(arg.id)}
                    className="p-2 text-zinc-300 hover:text-red-500 opacity-0 group-hover/main:opacity-100 transition-all"
                    title="Delete Research Point"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Planned Experiments (待完成实验)</h4>
                      <button 
                        onClick={() => setEditingArgId(arg.id)}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {JSON.parse(arg.planned_experiments || '[]').map((exp: any, eIdx: number) => (
                        <div key={eIdx} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100 group">
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => togglePlannedExp(arg.id, arg.planned_experiments, eIdx)}
                              className={cn(
                                "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                exp.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-zinc-300"
                              )}
                            >
                              {exp.completed && <CheckCircle2 size={12} />}
                            </button>
                            <span className={cn("text-sm font-medium", exp.completed && "text-zinc-400 line-through")}>{exp.name}</span>
                          </div>
                          <button 
                            onClick={() => removePlannedExp(arg.id, arg.planned_experiments, eIdx)}
                            className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Plus size={14} className="rotate-45" />
                          </button>
                        </div>
                      ))}
                      {editingArgId === arg.id && (
                        <div className="space-y-2 pt-2">
                          <input 
                            autoFocus
                            value={newPlannedExp}
                            onChange={e => setNewPlannedExp(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddPlannedExp(arg.id, arg.planned_experiments)}
                            placeholder="Experiment name..."
                            className="w-full text-sm p-3 rounded-xl border border-zinc-200 outline-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingArgId(null)} className="text-xs font-bold text-zinc-400">Cancel</button>
                            <button onClick={() => handleAddPlannedExp(arg.id, arg.planned_experiments)} className="text-xs font-bold text-indigo-600">Add</button>
                          </div>
                        </div>
                      )}
                      {(!arg.planned_experiments || JSON.parse(arg.planned_experiments).length === 0) && !editingArgId && (
                        <p className="text-xs text-zinc-400 italic">No planned experiments yet.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Active Experiments (已关联实验)</h4>
                    </div>
                    <div className="space-y-3">
                      {arg.experiments.map(exp => (
                        <div 
                          key={exp.id} 
                          onClick={() => onExperimentClick(exp.id)}
                          className="p-4 rounded-2xl border border-zinc-100 hover:border-zinc-300 transition-all cursor-pointer group"
                          style={{ borderLeftWidth: '4px', borderLeftColor: exp.color }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h5 className="font-bold text-sm group-hover:text-indigo-600 transition-colors">{exp.name}</h5>
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                              exp.status === 'completed' ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"
                            )}>
                              {exp.status}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-400">{format(parseISO(exp.start_date), 'PPP')}</p>
                        </div>
                      ))}
                      {arg.experiments.length === 0 && (
                        <p className="text-xs text-zinc-400 italic">No active experiments linked.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {arguments_.length === 0 && (
              <div className="p-12 bg-white rounded-3xl border border-dashed border-zinc-200 text-center text-zinc-400">
                No research points defined yet. Click "Add Research Point" above to start.
              </div>
            )}
          </div>
        </div>
      </div>

      {isAddArgModalOpen && (
        <AddResearchPointModal 
          projectId={projectId} 
          onClose={() => setIsAddArgModalOpen(false)} 
        />
      )}
    </div>
  );
}

function AddResearchPointModal({ projectId, onClose }: { projectId: string, onClose: () => void }) {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content) return;
    setIsSaving(true);
    try {
      await addDoc(collection(db, 'project_arguments'), {
        project_id: projectId,
        content,
        planned_experiments: '[]',
        created_at: new Date().toISOString()
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold">Add Research Point</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Description (分论点/逻辑点)</label>
            <textarea 
              autoFocus
              required
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full h-32 px-4 py-3 rounded-xl border border-zinc-200 outline-none resize-none focus:ring-2 focus:ring-zinc-900 transition-all"
              placeholder="Enter the research point or logic step..."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all">Cancel</button>
            <button 
              type="submit" 
              disabled={isSaving || !content}
              className="flex-1 py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-lg disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Point'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ProjectsView({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');

  // Research Point Modal State
  const [isArgModalOpen, setIsArgModalOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProject) {
      await updateDoc(doc(db, 'projects', editingProject.id), { name, description, color });
    } else {
      await addDoc(collection(db, 'projects'), {
        name,
        description,
        color,
        created_at: new Date().toISOString()
      });
    }
    setIsModalOpen(false);
    setEditingProject(null);
    setName('');
    setDescription('');
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'projects', id));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Research Projects</h2>
        <button 
          onClick={() => {
            setEditingProject(null);
            setName('');
            setDescription('');
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl hover:bg-zinc-800 transition-all shadow-md"
        >
          <Plus size={18} />
          <span>New Project</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map(project => (
          <div 
            key={project.id} 
            onClick={() => onSelectProject(project.id)}
            className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative cursor-pointer"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: project.color || '#3b82f6' }}>
                <FolderKanban size={20} />
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProject(project);
                    setName(project.name);
                    setDescription(project.description || '');
                    setColor(project.color || '#3b82f6');
                    setIsModalOpen(true);
                  }}
                  className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg"
                >
                  <Edit3 size={16} />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(project.id);
                  }}
                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold mb-2">{project.name}</h3>
            <p className="text-zinc-500 text-sm mb-4 line-clamp-2">{project.description}</p>
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setTargetProjectId(project.id);
                setIsArgModalOpen(true);
              }}
              className="w-full py-2 mb-4 rounded-xl border border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={14} />
              Add Research Point
            </button>

            <ProjectArgumentsList projectId={project.id} />
          </div>
        ))}
      </div>

      {isArgModalOpen && targetProjectId && (
        <AddResearchPointModal 
          projectId={targetProjectId} 
          onClose={() => setIsArgModalOpen(false)} 
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8">
            <h3 className="text-2xl font-bold mb-6">{editingProject ? 'Edit Project' : 'New Project'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Project Name</label>
                <input required value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full h-24 px-4 py-3 rounded-xl border border-zinc-200 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Color</label>
                <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-full h-12 rounded-xl border-none cursor-pointer" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium">Cancel</button>
                <button type="submit" className="flex-1 py-3 rounded-xl bg-zinc-900 text-white font-medium">Save</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <ConfirmModal 
        isOpen={!!deleteConfirmId}
        title="Delete Project"
        message="Are you sure you want to delete this project? This action cannot be undone."
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}

function ProjectArgumentsList({ projectId }: { projectId: string }) {
  const [arguments_, setArguments] = useState<ProjectArgument[]>([]);
  const [newArg, setNewArg] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'project_arguments'), where('project_id', '==', projectId), orderBy('created_at', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setArguments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    return () => unsubscribe();
  }, [projectId]);

  const handleAdd = async () => {
    if (!newArg) return;
    await addDoc(collection(db, 'project_arguments'), {
      project_id: projectId,
      content: newArg,
      planned_experiments: '[]',
      created_at: new Date().toISOString()
    });
    setNewArg('');
    setIsAdding(false);
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'project_arguments', id));
  };

  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-zinc-100">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Research Points</h4>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsAdding(true);
          }} 
          className="text-zinc-400 hover:text-zinc-900"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="space-y-2">
        {arguments_.map(arg => (
          <div key={arg.id} className="flex justify-between items-start gap-2 bg-zinc-50 p-2 rounded-lg group/arg">
            <p className="text-xs text-zinc-600 leading-relaxed">{arg.content}</p>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(arg.id);
              }} 
              className="text-zinc-300 hover:text-red-500 opacity-0 group-hover/arg:opacity-100"
            >
              <Plus size={12} className="rotate-45" />
            </button>
          </div>
        ))}
        {isAdding && (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <textarea 
              autoFocus
              value={newArg}
              onChange={e => setNewArg(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-zinc-200 outline-none"
              placeholder="Enter research point..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsAdding(false)} className="text-[10px] font-bold text-zinc-400">Cancel</button>
              <button onClick={handleAdd} className="text-[10px] font-bold text-indigo-600">Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordsView() {
  const [records, setRecords] = useState<(ExpRecord & { experiment_name: string, start_date: string, color: string })[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'records'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const recordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      // Fetch experiment details for each record
      // In a real app, we might denormalize this or use a more efficient way
      const enrichedRecords = await Promise.all(recordsData.map(async (record) => {
        const expDoc = await getDoc(doc(db, 'experiments', record.experiment_id));
        const expData = expDoc.data();
        return {
          ...record,
          experiment_name: expData?.name || 'Unknown Experiment',
          start_date: expData?.start_date || new Date().toISOString(),
          color: expData?.color || '#3b82f6'
        };
      }));
      
      setRecords(enrichedRecords.sort((a, b) => b.start_date.localeCompare(a.start_date)));
    });
    return () => unsubscribe();
  }, []);

  const handleDeleteRecord = async (recordId: string) => {
    await deleteDoc(doc(db, 'records', recordId));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Experiment Records</h2>
      </div>

      <div className="space-y-6">
        {records.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-zinc-200 text-center opacity-50">
            <BookOpen size={48} className="mx-auto mb-4" />
            <p>No records found. Complete experiments to see them here.</p>
          </div>
        ) : (
          records.map(record => (
            <div key={record.id} className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: record.color }} />
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold">{record.experiment_name}</h3>
                  <p className="text-zinc-400 text-sm">{format(parseISO(record.start_date), 'PPP')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1 rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    Record #{record.id}
                  </div>
                  <button 
                    onClick={() => setDeleteConfirmId(record.id)}
                    className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Delete Record"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Purpose & Observations</h4>
                  <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 text-sm text-zinc-700 whitespace-pre-wrap">
                    {record.results || 'No observations recorded.'}
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">AI Summary & Suggestions</h4>
                  <div className="bg-indigo-50/30 p-4 rounded-2xl border border-indigo-100 text-sm text-zinc-700 prose prose-sm max-w-none">
                    <Markdown>{record.summary || 'No AI summary generated.'}</Markdown>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal 
        isOpen={!!deleteConfirmId}
        title="Delete Record"
        message="Are you sure you want to delete this record? The experiment itself will remain."
        onConfirm={() => deleteConfirmId && handleDeleteRecord(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}

function AddExperimentModal({ templates, initialTemplateId, onClose, onSuccess }: { templates: Template[], initialTemplateId?: string | null, onClose: () => void, onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<string | ''>(initialTemplateId || '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [color, setColor] = useState('#3b82f6');
  const [projectId, setProjectId] = useState<string | ''>('');
  const [argumentId, setArgumentId] = useState<string | ''>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [arguments_, setArguments] = useState<ProjectArgument[]>([]);
  const [steps, setSteps] = useState<{ day_offset: number, description: string, notes: string | null }[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (projectId) {
      const q = query(collection(db, 'project_arguments'), where('project_id', '==', projectId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setArguments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      });
      return () => unsubscribe();
    } else {
      setArguments([]);
      setArgumentId('');
    }
  }, [projectId]);

  useEffect(() => {
    if (initialTemplateId) {
      setTemplateId(initialTemplateId);
      const t = templates.find(t => t.id === initialTemplateId);
      if (t) {
        setColor(t.color);
        const q = query(collection(db, 'template_steps'), where('template_id', '==', t.id), orderBy('step_order', 'asc'));
        getDocs(q).then(snapshot => {
          setSteps(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        });
      }
    }
  }, [initialTemplateId, templates]);

  const handleTemplateChange = async (id: string | '') => {
    setTemplateId(id);
    if (id) {
      const t = templates.find(t => t.id === id);
      if (t) {
        setColor(t.color);
        const q = query(collection(db, 'template_steps'), where('template_id', '==', id), orderBy('step_order', 'asc'));
        const snapshot = await getDocs(q);
        setSteps(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }
    } else {
      setSteps([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const expRef = await addDoc(collection(db, 'experiments'), {
      name,
      template_id: templateId || null,
      start_date: date,
      color,
      project_id: projectId || null,
      argument_id: argumentId || null,
      status: 'planned',
      samples_json: '[]'
    });

    // Add steps
    for (let i = 0; i < steps.length; i++) {
      await addDoc(collection(db, 'experiment_steps'), {
        experiment_id: expRef.id,
        ...steps[i],
        step_order: i,
        is_completed: false
      });
    }

    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-2xl font-bold">New Experiment</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-8 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Experiment Name</label>
              <input 
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                placeholder="e.g. KRAS Protein WB"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Start Date</label>
              <input 
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Project (课题)</label>
              <select 
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none"
              >
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Research Point (论证观点)</label>
              <select 
                value={argumentId}
                onChange={e => setArgumentId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none"
                disabled={!projectId}
              >
                <option value="">None</option>
                {arguments_.map(a => <option key={a.id} value={a.id}>{a.content}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Protocol Template</label>
              <select 
                value={templateId}
                onChange={e => handleTemplateChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none transition-all"
              >
                <option value="">Manual Entry</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Color</label>
              <div className="flex gap-2">
                <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-12 h-12 rounded-xl border-none cursor-pointer" />
                <input value={color} onChange={e => setColor(e.target.value)} className="flex-1 px-3 py-3 rounded-xl border border-zinc-200 outline-none font-mono text-xs" />
              </div>
            </div>
          </div>

          {steps.length > 0 && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">Adjust Protocol Steps</label>
                <button type="button" onClick={() => setSteps([...steps, { day_offset: 0, description: '', notes: null }])} className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                  <Plus size={14} /> Add Step
                </button>
              </div>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input 
                      type="number" 
                      value={step.day_offset} 
                      onChange={e => {
                        const newSteps = [...steps];
                        newSteps[i].day_offset = Number(e.target.value);
                        setSteps(newSteps);
                      }}
                      className="w-16 px-2 py-2 rounded-lg border border-zinc-200 text-sm text-center"
                    />
                    <input 
                      value={step.description} 
                      onChange={e => {
                        const newSteps = [...steps];
                        newSteps[i].description = e.target.value;
                        setSteps(newSteps);
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm"
                    />
                    <button type="button" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="text-zinc-300 hover:text-red-500">
                      <Plus size={16} className="rotate-45" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
        <div className="p-8 border-t border-zinc-100 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-lg">Create</button>
        </div>
      </motion.div>
    </div>
  );
}

function TemplateModal({ template, onClose, onSuccess }: { template: Template | null, onClose: () => void, onSuccess: () => void }) {
  const [name, setName] = useState(template?.name || '');
  const [type, setType] = useState(template?.type || 'Molecular');
  const [color, setColor] = useState(template?.color || '#3b82f6');
  const [description, setDescription] = useState(template?.description || '');
  const [projectId, setProjectId] = useState<string | ''>(template?.project_id || '');
  const [steps, setSteps] = useState<{ day_offset: number, description: string, notes: string | null, duration_minutes: number | null }[]>([]);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const colorPresets = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

  useEffect(() => {
    if (template) {
      const q = query(collection(db, 'template_steps'), where('template_id', '==', template.id), orderBy('step_order', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setSteps(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      });
      return () => unsubscribe();
    }
  }, [template]);

  const addStep = () => setSteps([...steps, { day_offset: 0, description: '', notes: null, duration_minutes: null }]);
  const removeStep = (index: number) => setSteps(steps.filter((_, i) => i !== index));
  const updateStep = (index: number, field: string, value: any) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let templateId: string | undefined = template?.id;
    
    if (templateId) {
      await updateDoc(doc(db, 'templates', templateId), { name, type, color, description, project_id: projectId || null });
      // Delete old steps and add new ones
      const q = query(collection(db, 'template_steps'), where('template_id', '==', templateId));
      const snapshot = await getDocs(q);
      for (const d of snapshot.docs) {
        await deleteDoc(d.ref);
      }
    } else {
      const templateRef = await addDoc(collection(db, 'templates'), {
        name,
        type,
        color,
        description,
        project_id: projectId || null,
        created_at: new Date().toISOString()
      });
      templateId = templateRef.id;
    }

    for (let i = 0; i < steps.length; i++) {
      await addDoc(collection(db, 'template_steps'), {
        template_id: templateId,
        ...steps[i],
        step_order: i
      });
    }

    onSuccess();
  };

  const handleDelete = async () => {
    if (!template) return;
    await deleteDoc(doc(db, 'templates', template.id));
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-2xl font-bold">{template ? 'Edit Template' : 'New Template'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-8 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Template Name</label>
              <input required value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Project (课题)</label>
              <select 
                value={projectId} 
                onChange={e => setProjectId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none"
              >
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Theme Color</label>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-12 h-12 rounded-xl border-none cursor-pointer" />
                  <input value={color} onChange={e => setColor(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 outline-none font-mono text-sm" />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {colorPresets.map(c => (
                    <button 
                      key={c} 
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn("w-6 h-6 rounded-full border border-black/5 transition-transform hover:scale-110", color === c && "ring-2 ring-zinc-900 ring-offset-2")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">Protocol Steps</label>
              <button type="button" onClick={addStep} className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline">
                <Plus size={14} /> Add Step
              </button>
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <div className="w-24 shrink-0 flex items-center gap-1 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-100">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">Day</span>
                    <input 
                      type="number" 
                      placeholder="0"
                      value={step.day_offset} 
                      onChange={e => updateStep(i, 'day_offset', Number(e.target.value))}
                      className="w-full bg-transparent outline-none text-sm text-center font-medium"
                    />
                  </div>
                  <div className="flex-1">
                    <input 
                      required
                      placeholder="Step description"
                      value={step.description} 
                      onChange={e => updateStep(i, 'description', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm"
                    />
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setEditingStepIndex(i)}
                    className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                    title="View Details"
                  >
                    <ArrowRight size={18} />
                  </button>
                  <button type="button" onClick={() => removeStep(i)} className="p-2 text-zinc-400 hover:text-red-500">
                    <Plus className="rotate-45" size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </form>
        <div className="p-8 border-t border-zinc-100 flex gap-3">
          {template && (
            <button type="button" onClick={() => setShowDeleteConfirm(true)} className="px-6 py-3 rounded-xl border border-red-100 text-red-600 font-medium hover:bg-red-50 transition-all">Delete</button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-6 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all">Cancel</button>
          <button onClick={handleSubmit} className="px-8 py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-lg">
            {template ? 'Save Changes' : 'Create Template'}
          </button>
        </div>

        <ConfirmModal 
          isOpen={showDeleteConfirm}
          title="Delete Template"
          message="Are you sure you want to delete this template? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />

        {editingStepIndex !== null && (
          <StepDetailModal 
            step={steps[editingStepIndex]} 
            onSave={(updatedStep) => {
              updateStep(editingStepIndex, 'notes', updatedStep.notes);
              updateStep(editingStepIndex, 'duration_minutes', updatedStep.duration_minutes);
              setEditingStepIndex(null);
            }}
            onClose={() => setEditingStepIndex(null)}
          />
        )}
      </motion.div>
    </div>
  );
}

function StepDetailModal({ step, onSave, onClose }: { step: any, onSave: (step: any) => void, onClose: () => void }) {
  const [notes, setNotes] = useState(step.notes || '');
  const [duration, setDuration] = useState(step.duration_minutes || '');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-xl font-bold">Step Details</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <Plus className="rotate-45" size={20} />
          </button>
        </div>
        <div className="p-8 space-y-6">
          <p className="text-sm font-medium text-zinc-900 bg-zinc-50 p-4 rounded-xl border border-zinc-100">
            {step.description}
          </p>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Duration (minutes)</label>
            <input 
              type="number" 
              value={duration} 
              onChange={e => setDuration(e.target.value)} 
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none"
              placeholder="e.g. 60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Detailed Process / Notes</label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              className="w-full h-40 px-4 py-3 rounded-xl border border-zinc-200 outline-none resize-none"
              placeholder="Enter detailed steps, reagents, or precautions..."
            />
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all">Cancel</button>
            <button 
              onClick={() => onSave({ ...step, notes, duration_minutes: duration ? Number(duration) : null })} 
              className="flex-1 py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-lg"
            >
              Save Details
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ExperimentDetailModal({ id, onClose }: { id: string, onClose: () => void }) {
  const [data, setData] = useState<{ experiment: Experiment, steps: ExperimentStep[], record: ExpRecord | null } | null>(null);
  const [activeTab, setActiveTab] = useState<'steps' | 'samples' | 'record'>('steps');
  const [problem, setProblem] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newStepText, setNewStepText] = useState('');
  const [newStepDay, setNewStepDay] = useState(0);
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  
  // Editing states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editProjectId, setEditProjectId] = useState<string | ''>('');
  const [editArgumentId, setEditArgumentId] = useState<string | ''>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [arguments_, setArguments] = useState<ProjectArgument[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'experiment' | 'step' | 'record', id?: string, message: string } | null>(null);

  useEffect(() => {
    const unsubExp = onSnapshot(doc(db, 'experiments', id), async (snapshot) => {
      if (snapshot.exists()) {
        const exp = { id: snapshot.id, ...snapshot.data() } as any as Experiment;
        
        // Fetch steps
        const qSteps = query(collection(db, 'experiment_steps'), where('experiment_id', '==', id), orderBy('step_order', 'asc'));
        const stepsSnapshot = await getDocs(qSteps);
        const steps = stepsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
        
        // Fetch record
        const qRecord = query(collection(db, 'records'), where('experiment_id', '==', id), limit(1));
        const recordSnapshot = await getDocs(qRecord);
        const record = recordSnapshot.docs.length > 0 ? { id: recordSnapshot.docs[0].id, ...recordSnapshot.docs[0].data() } as any : null;
        
        setData({ experiment: exp, steps, record });
        setEditName(exp.name);
        setEditColor(exp.color);
        setEditDate(exp.start_date);
        setEditProjectId(exp.project_id || '');
        setEditArgumentId(exp.argument_id || '');
        if (record) {
          setProblem(record.results || '');
        }
      }
    });

    const qProjects = query(collection(db, 'projects'), orderBy('name', 'asc'));
    const unsubProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    return () => {
      unsubExp();
      unsubProjects();
    };
  }, [id]);

  useEffect(() => {
    if (editProjectId) {
      const q = query(collection(db, 'project_arguments'), where('project_id', '==', editProjectId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setArguments(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      });
      return () => unsubscribe();
    } else {
      setArguments([]);
      setEditArgumentId('');
    }
  }, [editProjectId]);

  const handleUpdateExperiment = async () => {
    await updateDoc(doc(db, 'experiments', id), { 
      name: editName, 
      color: editColor, 
      start_date: editDate,
      project_id: editProjectId || null,
      argument_id: editArgumentId || null
    });
    setIsEditing(false);
  };

  const handleSaveSamples = async (tableIdx: number, tableData: string) => {
    const currentSamples = data?.experiment.samples_json ? JSON.parse(data.experiment.samples_json) : [];
    const updatedTable = JSON.parse(tableData);
    
    let newSamples;
    if (Array.isArray(currentSamples)) {
      newSamples = [...currentSamples];
      newSamples[tableIdx] = updatedTable;
    } else {
      newSamples = [updatedTable];
    }

    await updateDoc(doc(db, 'experiments', id), { samples_json: JSON.stringify(newSamples) });
  };

  const handleAddTable = async () => {
    const currentSamples = data?.experiment.samples_json ? JSON.parse(data.experiment.samples_json) : [];
    const newTable = { title: 'New Sample Table', data: [['Sample ID', 'Concentration', 'Volume'], ['', '', '']] };
    
    let newSamples;
    if (Array.isArray(currentSamples)) {
      newSamples = [...currentSamples, newTable];
    } else {
      newSamples = [newTable];
    }

    await updateDoc(doc(db, 'experiments', id), { samples_json: JSON.stringify(newSamples) });
  };

  const handleRemoveTable = async (tableIdx: number) => {
    const currentSamples = data?.experiment.samples_json ? JSON.parse(data.experiment.samples_json) : [];
    if (Array.isArray(currentSamples)) {
      const newSamples = currentSamples.filter((_, i) => i !== tableIdx);
      await updateDoc(doc(db, 'experiments', id), { samples_json: JSON.stringify(newSamples) });
    }
  };

  const handleDeleteExperiment = async () => {
    await deleteDoc(doc(db, 'experiments', id));
    onClose();
  };

  const toggleStep = async (stepId: string, currentStatus: boolean) => {
    await updateDoc(doc(db, 'experiment_steps', stepId), { is_completed: !currentStatus });
  };

  const handleAddStep = async () => {
    if (!newStepText) return;
    await addDoc(collection(db, 'experiment_steps'), { 
      experiment_id: id, 
      day_offset: newStepDay, 
      description: newStepText,
      step_order: data?.steps.length || 0,
      is_completed: false
    });
    setNewStepText('');
    setIsAddingStep(false);
  };

  const handleDeleteStep = async (stepId: string) => {
    await deleteDoc(doc(db, 'experiment_steps', stepId));
  };

  const handleSaveStepDetails = async (updatedStep: any) => {
    await updateDoc(doc(db, 'experiment_steps', updatedStep.id), { 
      notes: updatedStep.notes,
      duration_minutes: updatedStep.duration_minutes
    });
    setSelectedStepIndex(null);
  };

  const handleSaveRecord = async () => {
    if (data?.record) {
      await updateDoc(doc(db, 'records', data.record.id), { results: problem });
    } else {
      await addDoc(collection(db, 'records'), { 
        experiment_id: id, 
        results: problem,
        created_at: new Date().toISOString()
      });
    }
  };

  const handleAnalyze = async () => {
    if (!problem) return;
    setIsAnalyzing(true);
    try {
      const analysis = await gemini.analyzeExperimentProblem(problem, data?.experiment.name || "");
      setAiAnalysis(analysis || "No analysis generated.");
    } catch (error) {
      console.error(error);
      setAiAnalysis("Failed to analyze experiment problem.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDeleteRecordFromModal = async () => {
    if (!data?.record) return;
    try {
      await deleteDoc(doc(db, 'records', data.record.id));
      setProblem('');
      setAiAnalysis('');
    } catch (error) {
      console.error("Error deleting record:", error);
    }
  };

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-white relative z-10">
          <div className="flex-1">
            {isEditing ? (
              <div className="grid grid-cols-2 gap-4 max-w-2xl">
                <input 
                  value={editName} 
                  onChange={e => setEditName(e.target.value)}
                  className="text-2xl font-bold bg-zinc-50 px-3 py-1 rounded-lg border border-zinc-200 outline-none"
                />
                <input 
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="px-3 py-1 rounded-lg border border-zinc-200 outline-none"
                />
                <div className="flex gap-2">
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="w-10 h-10 rounded-lg border-none cursor-pointer" />
                  <select 
                    value={editProjectId}
                    onChange={e => setEditProjectId(e.target.value)}
                    className="flex-1 px-3 py-1 rounded-lg border border-zinc-200 outline-none text-sm"
                  >
                    <option value="">No Project</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <select 
                    value={editArgumentId}
                    onChange={e => setEditArgumentId(e.target.value)}
                    className="flex-1 px-3 py-1 rounded-lg border border-zinc-200 outline-none text-sm"
                    disabled={!editProjectId}
                  >
                    <option value="">No Research Point</option>
                    {arguments_.map(a => <option key={a.id} value={a.id}>{a.content}</option>)}
                  </select>
                  <button onClick={handleUpdateExperiment} className="bg-zinc-900 text-white px-4 py-1 rounded-lg font-bold text-sm">Save</button>
                  <button onClick={() => setIsEditing(false)} className="text-zinc-500 px-2 py-1 text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-4 h-12 rounded-full" style={{ backgroundColor: data.experiment.color }} />
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-bold">{data.experiment.name}</h3>
                    <button onClick={() => setIsEditing(true)} className="text-zinc-400 hover:text-zinc-900"><Edit3 size={18} /></button>
                  </div>
                  <p className="text-zinc-500 text-sm">Started on {format(parseISO(data.experiment.start_date), 'PPP')}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setDeleteConfirm({ 
                type: 'experiment', 
                message: 'Are you sure you want to delete this experiment? All progress will be lost.' 
              })}
              className="p-2 hover:bg-red-50 rounded-full transition-colors text-red-400"
              title="Delete Experiment"
            >
              <Trash2 size={24} />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
              <Plus className="rotate-45" size={24} />
            </button>
          </div>
        </div>

        <div className="flex border-b border-zinc-100 px-8 bg-zinc-50/50">
          <button 
            onClick={() => setActiveTab('steps')}
            className={cn(
              "py-4 px-6 font-bold text-xs tracking-widest uppercase border-b-2 transition-all", 
              activeTab === 'steps' ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-600"
            )}
          >
            Workflow
          </button>
          <button 
            onClick={() => setActiveTab('samples')}
            className={cn(
              "py-4 px-6 font-bold text-xs tracking-widest uppercase border-b-2 transition-all", 
              activeTab === 'samples' ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-600"
            )}
          >
            Samples
          </button>
          <button 
            onClick={() => setActiveTab('record')}
            className={cn(
              "py-4 px-6 font-bold text-xs tracking-widest uppercase border-b-2 transition-all", 
              activeTab === 'record' ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-600"
            )}
          >
            Experiment Record
          </button>
        </div>

        <div className="flex-1 overflow-auto p-8">
          {activeTab === 'steps' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Protocol Workflow</h4>
                <button 
                  onClick={() => setIsAddingStep(true)}
                  className="flex items-center gap-2 text-indigo-600 font-bold text-sm hover:underline"
                >
                  <Plus size={18} /> Add Custom Step
                </button>
              </div>
              {isAddingStep && (
                <div className="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/30 space-y-3">
                  <div className="flex gap-3">
                    <input 
                      type="number" 
                      placeholder="Day" 
                      value={newStepDay} 
                      onChange={e => setNewStepDay(Number(e.target.value))}
                      className="w-20 px-3 py-2 rounded-lg border border-zinc-200"
                    />
                    <input 
                      autoFocus
                      placeholder="New step description..." 
                      value={newStepText} 
                      onChange={e => setNewStepText(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-zinc-200"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setIsAddingStep(false)} className="px-4 py-2 text-sm font-medium text-zinc-500">Cancel</button>
                    <button onClick={handleAddStep} className="px-4 py-2 text-sm font-medium bg-zinc-900 text-white rounded-lg">Add Step</button>
                  </div>
                </div>
              )}
              {data.steps.map((step, i) => (
                <div 
                  key={step.id} 
                  className={cn(
                    "group flex items-center gap-4 p-4 rounded-2xl border transition-all",
                    step.is_completed ? "bg-emerald-50 border-emerald-100" : "bg-white border-zinc-100 hover:border-zinc-300"
                  )}
                >
                  <div 
                    onClick={() => toggleStep(step.id, step.is_completed)}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer",
                      step.is_completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-zinc-200"
                    )}
                  >
                    {step.is_completed && <CheckCircle2 size={14} />}
                  </div>
                  <div className="flex-1">
                    <p className={cn("font-medium", step.is_completed && "text-emerald-900 line-through opacity-60")}>
                      {step.description}
                    </p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Day {step.day_offset + 1}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => setSelectedStepIndex(i)}
                      className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                      title="View Details"
                    >
                      <ArrowRight size={18} />
                    </button>
                    <button 
                      onClick={() => setDeleteConfirm({ 
                        type: 'step', 
                        id: step.id, 
                        message: 'Delete this step?' 
                      })}
                      className="p-2 text-zinc-300 hover:text-red-500"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'samples' && (
            <div className="max-w-4xl space-y-6">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Sample Information Tables</h4>
                <button 
                  onClick={handleAddTable}
                  className="flex items-center gap-2 text-indigo-600 font-bold text-sm hover:underline"
                >
                  <Plus size={18} /> Add Table
                </button>
              </div>
              
              {(() => {
                const samples = data.experiment.samples_json ? JSON.parse(data.experiment.samples_json) : [];
                if (Array.isArray(samples)) {
                  return samples.map((table: any, idx: number) => (
                    <SampleTable 
                      key={idx}
                      title={table.title || `Table ${idx + 1}`}
                      initialData={JSON.stringify(table.data)}
                      onSave={(tableData) => handleSaveSamples(idx, tableData)}
                      onRemove={() => handleRemoveTable(idx)}
                    />
                  ));
                } else {
                  // Migration for old format
                  return (
                    <SampleTable 
                      title="Sample Information Table"
                      initialData={data.experiment.samples_json}
                      onSave={(tableData) => handleSaveSamples(0, tableData)}
                    />
                  );
                }
              })()}
              
              {(!data.experiment.samples_json || JSON.parse(data.experiment.samples_json).length === 0) && (
                <div className="p-12 border-2 border-dashed border-zinc-100 rounded-3xl text-center text-zinc-400">
                  <p className="mb-4">No sample tables added yet.</p>
                  <button 
                    onClick={handleAddTable}
                    className="bg-zinc-900 text-white px-6 py-2 rounded-xl font-bold text-sm"
                  >
                    Create First Table
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'record' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">Observations & Problems</label>
                  <textarea 
                    value={problem}
                    onChange={e => setProblem(e.target.value)}
                    className="w-full h-64 px-4 py-3 rounded-2xl border border-zinc-100 focus:ring-2 focus:ring-zinc-900 outline-none transition-all resize-none bg-zinc-50/50"
                    placeholder="Describe any issues encountered..."
                  />
                  <div className="flex gap-3 mt-4">
                    <button 
                      onClick={handleSaveRecord}
                      className="flex-1 py-3 rounded-xl border border-zinc-200 font-medium hover:bg-zinc-50 transition-all flex items-center justify-center gap-2"
                    >
                      <BookOpen size={18} /> Save Record
                    </button>
                    <button 
                      onClick={handleAnalyze}
                      disabled={isAnalyzing || !problem}
                      className="flex-1 py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isAnalyzing ? "Analyzing..." : <><BrainCircuit size={18} /> AI Analysis</>}
                    </button>
                    {data.record && (
                      <button 
                        onClick={() => setDeleteConfirm({ 
                          type: 'record', 
                          message: 'Are you sure you want to delete this record? The experiment progress will be kept.' 
                        })}
                        className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-all"
                        title="Delete Record"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="bg-zinc-50 rounded-3xl p-6 border border-zinc-100">
                <h4 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
                  <BrainCircuit size={16} className="text-indigo-600" />
                  AI Assistant Feedback
                </h4>
                {aiAnalysis ? (
                  <div className="prose prose-sm max-w-none text-zinc-600 bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
                    <Markdown>{aiAnalysis}</Markdown>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                    <BrainCircuit size={48} className="mb-4" />
                    <p className="text-sm">Enter a problem and click analyze to get expert suggestions from your AI lab assistant.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {selectedStepIndex !== null && (
          <StepDetailModal 
            step={data.steps[selectedStepIndex]} 
            onSave={handleSaveStepDetails}
            onClose={() => setSelectedStepIndex(null)}
          />
        )}

        <ConfirmModal 
          isOpen={!!deleteConfirm}
          title="Confirm Deletion"
          message={deleteConfirm?.message || ''}
          onConfirm={() => {
            if (!deleteConfirm) return;
            if (deleteConfirm.type === 'experiment') handleDeleteExperiment();
            if (deleteConfirm.type === 'step' && deleteConfirm.id) handleDeleteStep(deleteConfirm.id);
            if (deleteConfirm.type === 'record') handleDeleteRecordFromModal();
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      </motion.div>
    </div>
  );
}

function AIView() {
  const [messages, setMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsProcessing(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const response = await gemini.chatWithAssistant(userMessage, history);
      
      if (response) {
        setMessages(prev => [...prev, { role: 'model', content: response }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', content: "I'm sorry, I encountered an error processing your request." }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', content: "Failed to connect to the AI assistant." }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const quickActions = [
    { 
      title: 'Troubleshoot Experiment', 
      desc: 'Analyze failed results and get suggestions.', 
      prompt: 'I need help troubleshooting an experiment. Here are the details: ',
      icon: XCircle,
      color: 'text-red-500'
    },
    { 
      title: 'Optimize Protocol', 
      desc: 'Improve your current lab procedures.', 
      prompt: 'Can you help me optimize this protocol? ',
      icon: Settings,
      color: 'text-indigo-500'
    },
    { 
      title: 'Design Experiment', 
      desc: 'Get help planning a new study.', 
      prompt: 'I want to design a new experiment for: ',
      icon: Beaker,
      color: 'text-emerald-500'
    }
  ];

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-180px)] flex flex-col gap-6">
      <div className="bg-zinc-900 rounded-3xl p-8 text-white relative overflow-hidden shrink-0">
        <div className="relative z-10">
          <h2 className="text-3xl font-bold mb-2">AI Lab Assistant</h2>
          <p className="text-zinc-400 max-w-xl text-sm">
            Ask questions about protocols, troubleshoot results, or get help with project planning.
          </p>
        </div>
        <BrainCircuit size={120} className="absolute -right-4 -bottom-4 text-white/5 rotate-12" />
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Chat Section */}
        <div className="flex-1 bg-white rounded-3xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                <BrainCircuit size={64} className="mb-4 text-zinc-300" />
                <h3 className="text-lg font-bold text-zinc-900 mb-2">How can I help you today?</h3>
                <p className="text-sm max-w-xs">Ask me anything about your research, protocols, or experimental data.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[80%] p-4 rounded-2xl text-sm",
                  msg.role === 'user' 
                    ? "bg-zinc-900 text-white rounded-tr-none" 
                    : "bg-zinc-50 border border-zinc-100 text-zinc-800 rounded-tl-none prose prose-sm max-w-none"
                )}>
                  {msg.role === 'model' ? <Markdown>{msg.content}</Markdown> : msg.content}
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-zinc-50 border border-zinc-100 p-4 rounded-2xl rounded-tl-none flex gap-1">
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-6 border-t border-zinc-100 bg-zinc-50/30">
            <form onSubmit={handleSendMessage} className="flex gap-3">
              <input 
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Type your question here..."
                className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all bg-white"
              />
              <button 
                type="submit"
                disabled={isProcessing || !input.trim()}
                className="bg-zinc-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        </div>

        {/* Sidebar Actions */}
        <div className="w-80 space-y-4 hidden lg:block">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest px-2">Quick Actions</h3>
          {quickActions.map((action, i) => (
            <button 
              key={i}
              onClick={() => setInput(action.prompt)}
              className="w-full text-left p-4 bg-white rounded-2xl border border-zinc-200 hover:border-zinc-900 hover:shadow-md transition-all group"
            >
              <div className={cn("mb-3", action.color)}>
                <action.icon size={24} />
              </div>
              <h4 className="font-bold text-sm mb-1 group-hover:text-zinc-900">{action.title}</h4>
              <p className="text-xs text-zinc-500 leading-relaxed">{action.desc}</p>
            </button>
          ))}
          
          <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
            <h4 className="text-xs font-bold text-indigo-900 mb-2 flex items-center gap-2">
              <Info size={14} />
              Pro Tip
            </h4>
            <p className="text-[10px] text-indigo-700 leading-relaxed">
              You can ask the AI to summarize your entire project or suggest the next logical experiment based on your research points.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
