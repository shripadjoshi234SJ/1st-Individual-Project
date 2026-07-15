import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Clock, 
  User, 
  Share2, 
  Users, 
  Check, 
  Activity, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Calendar, 
  CheckSquare, 
  Square,
  AlertCircle,
  Copy,
  Settings,
  HelpCircle
} from 'lucide-react';

// --- Types ---
interface Task {
  id: string;
  title: string;
  description: string;
  column: 'todo' | 'inprogress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  dueDate: string;
  checklist: { id: string; text: string; completed: boolean }[];
  createdAt: string;
}

interface UserPresence {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number } | null;
  lastActive: number;
}

interface ActivityLog {
  id: string;
  userName: string;
  action: string;
  timestamp: string;
}

const AVATAR_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f43f5e', // Rose
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#ec4899', // Pink
];

export default function App() {
  // --- State ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeUsers, setActiveUsers] = useState<{ [userId: string]: UserPresence }>({});
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [roomId, setRoomId] = useState<string>('');
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [errorState, setErrorState] = useState<string | null>(null);

  // User Profile State
  const [userId] = useState<string>(() => {
    const saved = localStorage.getItem('collab_user_id');
    if (saved) return saved;
    const newId = 'user-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('collab_user_id', newId);
    return newId;
  });

  const [userName, setUserName] = useState<string>(() => {
    const saved = localStorage.getItem('collab_username');
    if (saved) return saved;
    const names = ['Creative Badger', 'Clever Capybara', 'Swift Swallow', 'Bright Beaver', 'Wise Owl', 'Noble Owl', 'Sleek Panther'];
    const randomName = names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 100);
    localStorage.setItem('collab_username', randomName);
    return randomName;
  });

  const [userColor, setUserColor] = useState<string>(() => {
    const saved = localStorage.getItem('collab_user_color');
    if (saved) return saved;
    const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    localStorage.setItem('collab_user_color', randomColor);
    return randomColor;
  });

  // UI Control States
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isShareSuccess, setIsShareSuccess] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');

  // Task form details
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskCol, setTaskCol] = useState<'todo' | 'inprogress' | 'review' | 'done'>('todo');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskChecklist, setTaskChecklist] = useState<{ id: string; text: string; completed: boolean }[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');

  // --- Refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const lastCursorEmit = useRef<number>(0);

  // --- Initialize Room from URL Hash ---
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && hash.length > 2) {
      setRoomId(hash);
    } else {
      const generatedRoom = 'room-' + Math.random().toString(36).substr(2, 6);
      setRoomId(generatedRoom);
      window.location.hash = generatedRoom;
    }
  }, []);

  // Listen to hash changes in case users click internal links or browser back/forward
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && hash !== roomId) {
        setRoomId(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [roomId]);

  // --- WebSocket Connection & Real-Time Sync ---
  useEffect(() => {
    if (!roomId) return;

    let socket: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setSocketConnected(true);
        setErrorState(null);

        // Join room immediately upon connecting
        socket.send(JSON.stringify({
          type: 'join',
          roomId,
          payload: {
            id: userId,
            name: userName,
            color: userColor
          }
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, payload } = data;

          switch (type) {
            case 'sync': {
              setTasks(payload.tasks);
              setActiveUsers(payload.users);
              setActivities(payload.activities);
              break;
            }
            case 'user_joined': {
              setActiveUsers(prev => ({
                ...prev,
                [payload.id]: payload
              }));
              break;
            }
            case 'user_left': {
              setActiveUsers(prev => {
                const next = { ...prev };
                delete next[payload.id];
                return next;
              });
              break;
            }
            case 'user_updated': {
              setActiveUsers(prev => ({
                ...prev,
                [payload.id]: payload
              }));
              break;
            }
            case 'cursor_update': {
              setActiveUsers(prev => {
                if (!prev[payload.userId]) return prev;
                return {
                  ...prev,
                  [payload.userId]: {
                    ...prev[payload.userId],
                    cursor: payload.cursor
                  }
                };
              });
              break;
            }
            case 'task_created': {
              setTasks(prev => {
                // Prevent duplicate insertions
                if (prev.some(t => t.id === payload.id)) return prev;
                return [...prev, payload];
              });
              break;
            }
            case 'task_updated': {
              setTasks(prev => prev.map(t => t.id === payload.id ? payload : t));
              break;
            }
            case 'task_deleted': {
              setTasks(prev => prev.filter(t => t.id !== payload.id));
              break;
            }
            case 'activity': {
              setActivities(prev => [payload, ...prev].slice(0, 30));
              break;
            }
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      socket.onclose = () => {
        setSocketConnected(false);
        // Attempt reconnection after 3 seconds
        reconnectTimeout = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      socket.onerror = () => {
        setErrorState('Could not establish collaborative connection. Retrying...');
      };
    };

    connectWebSocket();

    return () => {
      if (socket) {
        socket.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [roomId, userId]);

  // Sync user profile updates with WebSocket server
  const handleProfileUpdate = (newName: string, newColor: string) => {
    setUserName(newName);
    setUserColor(newColor);
    localStorage.setItem('collab_username', newName);
    localStorage.setItem('collab_user_color', newColor);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'user_update',
        roomId,
        payload: {
          name: newName,
          color: newColor
        }
      }));
    }
    setIsProfileModalOpen(false);
  };

  // --- Real-time Cursor Broadcast ---
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!boardRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastCursorEmit.current < 40) return; // limit to ~25fps to save bandwidth
    lastCursorEmit.current = now;

    const rect = boardRef.current.getBoundingClientRect();
    // Normalize coordinates as percentage to keep positions accurate across monitors
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    wsRef.current.send(JSON.stringify({
      type: 'cursor_move',
      roomId,
      payload: {
        cursor: { x, y }
      }
    }));
  };

  const handleMouseLeave = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'cursor_move',
        roomId,
        payload: { cursor: null }
      }));
    }
  };

  // --- Task Operations ---
  const openCreateTaskModal = (column: 'todo' | 'inprogress' | 'review' | 'done' = 'todo') => {
    setEditingTask(null);
    setTaskTitle('');
    setTaskDesc('');
    setTaskCol(column);
    setTaskPriority('medium');
    setTaskAssignee('');
    setTaskDueDate(new Date().toISOString().split('T')[0]);
    setTaskChecklist([]);
    setNewChecklistItem('');
    setIsTaskModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDesc(task.description);
    setTaskCol(task.column);
    setTaskPriority(task.priority);
    setTaskAssignee(task.assignee || '');
    setTaskDueDate(task.dueDate || '');
    setTaskChecklist(task.checklist || []);
    setNewChecklistItem('');
    setIsTaskModalOpen(true);
  };

  const saveTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    if (editingTask) {
      const updatedTask: Task = {
        ...editingTask,
        title: taskTitle.trim(),
        description: taskDesc.trim(),
        column: taskCol,
        priority: taskPriority,
        assignee: taskAssignee.trim() || 'Unassigned',
        dueDate: taskDueDate,
        checklist: taskChecklist
      };

      // Update locally immediately (optimistic)
      setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));

      // Broadcast update
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'task_update',
          roomId,
          payload: updatedTask
        }));
      }
    } else {
      const newTask: Task = {
        id: 'task-' + Math.random().toString(36).substr(2, 9),
        title: taskTitle.trim(),
        description: taskDesc.trim(),
        column: taskCol,
        priority: taskPriority,
        assignee: taskAssignee.trim() || 'Unassigned',
        dueDate: taskDueDate,
        checklist: taskChecklist,
        createdAt: new Date().toISOString()
      };

      // Add locally immediately (optimistic)
      setTasks(prev => [...prev, newTask]);

      // Broadcast creation
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'task_create',
          roomId,
          payload: newTask
        }));
      }
    }

    setIsTaskModalOpen(false);
  };

  const deleteTask = (taskId: string) => {
    const taskToDelete = tasks.find(t => t.id === taskId);
    if (!taskToDelete) return;

    if (confirm(`Are you sure you want to delete the task "${taskToDelete.title}"?`)) {
      // Delete locally
      setTasks(prev => prev.filter(t => t.id !== taskId));

      // Broadcast delete
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'task_delete',
          roomId,
          payload: { id: taskId }
        }));
      }
    }
  };

  const moveTaskToColumn = (taskId: string, targetCol: 'todo' | 'inprogress' | 'review' | 'done') => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.column === targetCol) return;

    const updatedTask: Task = {
      ...task,
      column: targetCol
    };

    // Update locally
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

    // Broadcast
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'task_update',
        roomId,
        payload: updatedTask
      }));
    }
  };

  // Drag and drop handlers (built-in HTML5)
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetCol: 'todo' | 'inprogress' | 'review' | 'done') => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      moveTaskToColumn(taskId, targetCol);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // --- Checklist Helpers ---
  const toggleChecklistItem = (itemId: string) => {
    const updated = taskChecklist.map(item => 
      item.id === itemId ? { ...item, completed: !item.completed } : item
    );
    setTaskChecklist(updated);
  };

  const addChecklistItem = () => {
    if (!newChecklistItem.trim()) return;
    const newItem = {
      id: 'chk-' + Math.random().toString(36).substr(2, 5),
      text: newChecklistItem.trim(),
      completed: false
    };
    setTaskChecklist([...taskChecklist, newItem]);
    setNewChecklistItem('');
  };

  const removeChecklistItem = (itemId: string) => {
    setTaskChecklist(taskChecklist.filter(item => item.id !== itemId));
  };

  // --- Room Link Share ---
  const copyShareLink = () => {
    const link = `${window.location.origin}${window.location.pathname}#${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setIsShareSuccess(true);
      setTimeout(() => setIsShareSuccess(false), 2500);
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  };

  // --- Filter and Search Logic ---
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch = 
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        task.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
        task.assignee.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesPriority = filterPriority === 'all' || task.priority === filterPriority;
      const matchesAssignee = filterAssignee === 'all' || 
        (filterAssignee === 'unassigned' && (!task.assignee || task.assignee === 'Unassigned')) || 
        task.assignee.toLowerCase().includes(filterAssignee.toLowerCase());

      return matchesSearch && matchesPriority && matchesAssignee;
    });
  }, [tasks, searchQuery, filterPriority, filterAssignee]);

  // Unique assignees for filter dropdown
  const uniqueAssignees = useMemo(() => {
    const names = new Set<string>();
    tasks.forEach(t => {
      if (t.assignee && t.assignee !== 'Unassigned') {
        names.add(t.assignee);
      }
    });
    return Array.from(names);
  }, [tasks]);

  // Cursors list (exclude current user)
  const remoteCursors = useMemo(() => {
    return (Object.values(activeUsers) as UserPresence[]).filter(u => u.id !== userId && u.cursor);
  }, [activeUsers, userId]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] flex flex-col font-sans select-none antialiased">
      
      {/* Real-time sync alert banner */}
      {errorState && (
        <div className="bg-amber-50 border-b border-amber-200 py-2 px-4 text-center text-amber-800 text-xs flex items-center justify-center gap-2 animate-pulse" id="alert-banner">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <span>{errorState}</span>
        </div>
      )}

      {/* Header Panel */}
      <header className="bg-white border-b border-slate-200/80 shadow-sm sticky top-0 z-40 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4" id="header">
        {/* Brand Logo & Connection State */}
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-indigo-500 to-indigo-600 p-2.5 rounded-xl text-white shadow-sm shadow-indigo-100">
            <CheckSquare className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-slate-900 flex items-center gap-2.5">
              CollabTask
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none ${
                socketConnected 
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                  : 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${socketConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                {socketConnected ? 'Live Connection' : 'Offline'}
              </span>
            </h1>
            <p className="text-slate-400 text-xs font-medium">Real-time Multi-user Board</p>
          </div>
        </div>

        {/* Board Room & Invites */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <div className="bg-slate-100 border border-slate-200/60 rounded-xl px-4 py-2 flex items-center gap-2 max-w-xs overflow-hidden">
            <span className="text-slate-400 text-xs font-semibold select-none">ROOM</span>
            <span className="font-bold text-sm text-slate-700 truncate select-all">#{roomId}</span>
          </div>

          <button 
            onClick={copyShareLink}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border cursor-pointer ${
              isShareSuccess 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-sm active:scale-95'
            }`}
            title="Copy board invite link for co-workers"
          >
            {isShareSuccess ? (
              <>
                <Check className="w-4 h-4 stroke-[2.5] text-emerald-600" />
                <span>Copied Link!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 text-slate-500" />
                <span>Invite Co-worker</span>
              </>
            )}
          </button>
        </div>

        {/* Active Presence avatars & User settings */}
        <div className="flex items-center gap-4">
          {/* Presence avatars stack */}
          <div className="flex items-center gap-1.5 border-r border-slate-200 pr-4">
            <div className="flex -space-x-2.5 overflow-hidden">
              {(Object.values(activeUsers) as UserPresence[]).map((user) => (
                <div 
                  key={user.id}
                  className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold transition-all hover:scale-110 shadow-sm relative group"
                  style={{ backgroundColor: user.color }}
                  title={`${user.name} ${user.id === userId ? '(You)' : ''}`}
                >
                  {user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                  <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
                  
                  {/* Floating Tooltip */}
                  <div className="absolute top-10 scale-0 group-hover:scale-100 transition-all duration-150 origin-top bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap z-50">
                    {user.name} {user.id === userId && ' (You)'}
                  </div>
                </div>
              ))}
            </div>
            <span className="text-slate-400 text-xs font-bold pl-1">
              {Object.keys(activeUsers).length} active
            </span>
          </div>

          {/* Current User Customization Trigger */}
          <button 
            onClick={() => setIsProfileModalOpen(true)}
            className="flex items-center gap-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl px-3 py-1.5 transition-all text-xs font-semibold text-slate-700 cursor-pointer active:scale-95"
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: userColor }}>
              {userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <span className="max-w-[100px] truncate">{userName}</span>
            <Settings className="w-3.5 h-3.5 text-slate-400 ml-1" />
          </button>
        </div>
      </header>

      {/* Main Board Layout container */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative" id="board-container">
        
        {/* Collaborative Canvas Workspace for Drag, Drop, Cursors */}
        <div 
          ref={boardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="flex-1 p-6 overflow-y-auto relative min-h-[calc(100vh-80px)]"
        >
          {/* Remote user cursor overlays */}
          {remoteCursors.map((user) => (
            <div
              key={user.id}
              className="absolute pointer-events-none transition-all duration-75 z-50 flex flex-col gap-1 items-start"
              style={{
                left: `${user.cursor?.x}%`,
                top: `${user.cursor?.y}%`,
              }}
            >
              {/* Sleek Vector Cursor Arrow */}
              <svg 
                className="w-4.5 h-4.5 drop-shadow-sm" 
                viewBox="0 0 24 24" 
                fill={user.color} 
                stroke="white" 
                strokeWidth="2"
              >
                <path d="M4.5 3V17L9 12.5L14.5 18L16.5 16L11 10.5L16 9L4.5 3Z" />
              </svg>
              {/* Hovering User Badge */}
              <div 
                className="px-2 py-0.5 rounded shadow-sm text-[10px] font-bold text-white whitespace-nowrap flex items-center"
                style={{ backgroundColor: user.color }}
              >
                {user.name}
              </div>
            </div>
          ))}

          {/* Controls & Filters Bar */}
          <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/70 shadow-sm" id="toolbar">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              
              {/* Search Bar */}
              <div className="relative flex-1 sm:w-60">
                <input 
                  type="text"
                  placeholder="Search tasks or assignees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all pl-10 placeholder-slate-400"
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Priority Filters */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-400 select-none uppercase tracking-wider">Priority:</label>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-600"
                >
                  <option value="all">All Priorities</option>
                  <option value="high">🔴 High</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="low">🟢 Low</option>
                </select>
              </div>

              {/* Assignee Filters */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-400 select-none uppercase tracking-wider">Assignee:</label>
                <select
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-600 max-w-[140px]"
                >
                  <option value="all">Everyone</option>
                  <option value="unassigned">Unassigned</option>
                  {uniqueAssignees.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Global Actions */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                onClick={() => openCreateTaskModal('todo')}
                className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm shadow-indigo-100 hover:shadow-indigo-200 active:scale-95"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Add New Task</span>
              </button>

              <button
                onClick={() => setIsActivityOpen(!isActivityOpen)}
                className={`p-2 rounded-xl border cursor-pointer transition-all ${
                  isActivityOpen 
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100' 
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
                title="Toggle Live Activity Log"
              >
                <Activity className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Kanban Board Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start" id="kanban-grid">
            
            {/* COLUMN: To Do */}
            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'todo')}
              className="bg-[#f1f5f9]/70 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-4 min-h-[500px] transition-all"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 mb-1">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                  <h3 className="font-bold text-sm text-slate-800 tracking-tight">To Do</h3>
                  <span className="bg-slate-200/70 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {filteredTasks.filter(t => t.column === 'todo').length}
                  </span>
                </div>
                <button 
                  onClick={() => openCreateTaskModal('todo')}
                  className="p-1 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {filteredTasks.filter(t => t.column === 'todo').map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onEdit={openEditTaskModal} 
                    onDelete={deleteTask}
                    onMove={moveTaskToColumn}
                    onDragStart={handleDragStart}
                  />
                ))}
                {filteredTasks.filter(t => t.column === 'todo').length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200/50">
                    No tasks here yet
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN: In Progress */}
            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'inprogress')}
              className="bg-[#f1f5f9]/70 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-4 min-h-[500px]"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 mb-1">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <h3 className="font-bold text-sm text-slate-800 tracking-tight">In Progress</h3>
                  <span className="bg-slate-200/70 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {filteredTasks.filter(t => t.column === 'inprogress').length}
                  </span>
                </div>
                <button 
                  onClick={() => openCreateTaskModal('inprogress')}
                  className="p-1 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {filteredTasks.filter(t => t.column === 'inprogress').map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onEdit={openEditTaskModal} 
                    onDelete={deleteTask}
                    onMove={moveTaskToColumn}
                    onDragStart={handleDragStart}
                  />
                ))}
                {filteredTasks.filter(t => t.column === 'inprogress').length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200/50">
                    No active tasks
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN: Review */}
            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'review')}
              className="bg-[#f1f5f9]/70 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-4 min-h-[500px]"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 mb-1">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <h3 className="font-bold text-sm text-slate-800 tracking-tight">Review</h3>
                  <span className="bg-slate-200/70 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {filteredTasks.filter(t => t.column === 'review').length}
                  </span>
                </div>
                <button 
                  onClick={() => openCreateTaskModal('review')}
                  className="p-1 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {filteredTasks.filter(t => t.column === 'review').map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onEdit={openEditTaskModal} 
                    onDelete={deleteTask}
                    onMove={moveTaskToColumn}
                    onDragStart={handleDragStart}
                  />
                ))}
                {filteredTasks.filter(t => t.column === 'review').length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200/50">
                    Review column is empty
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN: Done */}
            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'done')}
              className="bg-[#f1f5f9]/70 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-4 min-h-[500px]"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 mb-1">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h3 className="font-bold text-sm text-slate-800 tracking-tight">Done</h3>
                  <span className="bg-slate-200/70 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {filteredTasks.filter(t => t.column === 'done').length}
                  </span>
                </div>
                <button 
                  onClick={() => openCreateTaskModal('done')}
                  className="p-1 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {filteredTasks.filter(t => t.column === 'done').map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onEdit={openEditTaskModal} 
                    onDelete={deleteTask}
                    onMove={moveTaskToColumn}
                    onDragStart={handleDragStart}
                  />
                ))}
                {filteredTasks.filter(t => t.column === 'done').length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200/50">
                    No completed tasks
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Live Activity Logs Sidebar */}
        {isActivityOpen && (
          <aside className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-slate-200/80 p-6 flex flex-col h-[400px] md:h-auto z-30 shadow-sm" id="activity-sidebar">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Activity className="w-4.5 h-4.5 text-indigo-500" />
                <h3 className="font-bold text-sm text-slate-800 tracking-tight">Live Activity Log</h3>
              </div>
              <button 
                onClick={() => setActivities([])}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase cursor-pointer"
              >
                Clear
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pt-4 flex flex-col gap-4">
              {activities.map((act) => (
                <div key={act.id} className="text-xs text-slate-600 flex items-start gap-2.5 animate-fadeIn leading-relaxed">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-800">{act.userName}</span>{' '}
                    <span>{act.action}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5 font-medium">{act.timestamp}</span>
                  </div>
                </div>
              ))}
              {activities.length === 0 && (
                <div className="text-center py-16 text-xs text-slate-400 font-medium">
                  No activity yet. Invite a coworker or perform actions to see them logged here.
                </div>
              )}
            </div>

            {/* Instruction Tip */}
            <div className="mt-auto pt-4 border-t border-slate-100 bg-slate-50 p-3 rounded-xl">
              <h4 className="font-bold text-[11px] text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                How to test:
              </h4>
              <p className="text-[11px] text-slate-500 leading-normal">
                Copy this browser's link and open it in a separate private window to simulate multiple users interacting simultaneously!
              </p>
            </div>
          </aside>
        )}

      </main>

      {/* MODAL: Profile Setup */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200/50">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <h3 className="font-bold text-lg text-slate-800 tracking-tight">Customize Profile</h3>
              <button 
                onClick={() => setIsProfileModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ProfileForm 
              initialName={userName} 
              initialColor={userColor} 
              onSave={handleProfileUpdate} 
            />
          </div>
        </div>
      )}

      {/* MODAL: Create or Edit Task */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200/50 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <h3 className="font-bold text-lg text-slate-800 tracking-tight">
                {editingTask ? 'Edit Task Settings' : 'Create Collaborative Task'}
              </h3>
              <button 
                onClick={() => setIsTaskModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveTask} className="space-y-4 text-xs font-semibold text-slate-700">
              
              {/* Task Title */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Task Title</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Design database architecture"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Description</label>
                <textarea 
                  rows={3}
                  placeholder="Detail the task objectives and requirements..."
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Status and Priority Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Board Status</label>
                  <select
                    value={taskCol}
                    onChange={(e) => setTaskCol(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700"
                  >
                    <option value="todo">To Do</option>
                    <option value="inprogress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Priority Label</label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700"
                  >
                    <option value="low">🟢 Low</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="high">🔴 High</option>
                  </select>
                </div>
              </div>

              {/* Assignee & Due Date Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Assignee</label>
                  <input 
                    type="text"
                    placeholder="Unassigned"
                    value={taskAssignee}
                    onChange={(e) => setTaskAssignee(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Due Date</label>
                  <input 
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all text-slate-800"
                  />
                </div>
              </div>

              {/* Subtask checklist section */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Subtask Checklist</label>
                
                {/* List items */}
                {taskChecklist.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto mb-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    {taskChecklist.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-0.5 group">
                        <button
                          type="button"
                          onClick={() => toggleChecklistItem(item.id)}
                          className="flex items-center gap-2 text-left text-slate-700 text-xs font-medium flex-1 cursor-pointer"
                        >
                          {item.completed ? (
                            <CheckSquare className="w-4.5 h-4.5 text-indigo-500 flex-shrink-0" />
                          ) : (
                            <Square className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />
                          )}
                          <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-700'}>
                            {item.text}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeChecklistItem(item.id)}
                          className="text-slate-400 hover:text-rose-500 p-0.5 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Checklist input */}
                <div className="flex gap-2">
                  <input 
                    type="text"
                    placeholder="Add a task checklist item..."
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addChecklistItem();
                      }
                    }}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={addChecklistItem}
                    className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer active:scale-95 transition-all"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-5 border-t border-slate-100 mt-6">
                <button
                  type="button"
                  onClick={() => setIsTaskModalOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl px-4 py-2.5 text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2.5 text-xs font-bold transition-all shadow-sm shadow-indigo-100 cursor-pointer active:scale-95"
                >
                  Save Task
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// --- SUB-COMPONENT: Task Card ---
interface TaskCardProps {
  key?: string;
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, col: 'todo' | 'inprogress' | 'review' | 'done') => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
}

function TaskCard({ task, onEdit, onDelete, onMove, onDragStart }: TaskCardProps) {
  
  // Calculate checklist progress
  const progress = useMemo(() => {
    if (!task.checklist || task.checklist.length === 0) return { total: 0, completed: 0, percentage: 0 };
    const total = task.checklist.length;
    const completed = task.checklist.filter(item => item.completed).length;
    return {
      total,
      completed,
      percentage: Math.round((completed / total) * 100)
    };
  }, [task.checklist]);

  // Priority styling
  const priorityColors = {
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    high: 'bg-rose-50 text-rose-700 border-rose-200'
  };

  const getColOrder = (col: string) => {
    const orders = { todo: 0, inprogress: 1, review: 2, done: 3 };
    return (orders as any)[col] ?? 0;
  };

  const nextColMap: { [key: string]: 'todo' | 'inprogress' | 'review' | 'done' } = {
    todo: 'inprogress',
    inprogress: 'review',
    review: 'done'
  };

  const prevColMap: { [key: string]: 'todo' | 'inprogress' | 'review' | 'done' } = {
    inprogress: 'todo',
    review: 'inprogress',
    done: 'review'
  };

  return (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-grab active:cursor-grabbing group relative select-none"
    >
      {/* Top row: Priority & Edit/Delete actions */}
      <div className="flex items-center justify-between mb-2.5">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${priorityColors[task.priority]}`}>
          {task.priority.toUpperCase()}
        </span>

        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit(task)}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg cursor-pointer transition-all"
            title="Edit Task Details"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={() => onDelete(task.id)}
            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-all"
            title="Delete Task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Task Title */}
      <h4 className="font-bold text-sm text-slate-800 leading-snug tracking-tight mb-1.5">
        {task.title}
      </h4>

      {/* Task Description */}
      {task.description && (
        <p className="text-xs text-slate-400 font-medium leading-relaxed mb-3.5 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Checklist Progress Bar */}
      {progress.total > 0 && (
        <div className="mb-3.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1">
              <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
              Subtasks
            </span>
            <span>{progress.completed}/{progress.total} ({progress.percentage}%)</span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom Row: Assignee & Due Date */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-[10px] font-bold text-slate-400">
        
        {/* Assignee Circle */}
        <div className="flex items-center gap-1.5">
          <div className="w-5.5 h-5.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center text-[9px] font-bold">
            {task.assignee ? task.assignee.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U'}
          </div>
          <span className="text-slate-500 text-[11px] font-semibold truncate max-w-[80px]">
            {task.assignee || 'Unassigned'}
          </span>
        </div>

        {/* Due Date tag */}
        {task.dueDate && (
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 rounded-md px-1.5 py-0.5 font-semibold text-slate-500">
            <Calendar className="w-3 h-3 text-slate-400" />
            <span>{task.dueDate}</span>
          </div>
        )}
      </div>

      {/* Interactive Quick-move Column Arrows */}
      <div className="absolute right-3 top-3.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {getColOrder(task.column) > 0 && (
          <button 
            onClick={() => onMove(task.id, prevColMap[task.column])}
            className="p-1 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-700 shadow-xs cursor-pointer active:scale-90 transition-all"
            title="Move back"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {getColOrder(task.column) < 3 && (
          <button 
            onClick={() => onMove(task.id, nextColMap[task.column])}
            className="p-1 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-700 shadow-xs cursor-pointer active:scale-90 transition-all"
            title="Move forward"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

    </div>
  );
}

// --- SUB-COMPONENT: Profile Form ---
interface ProfileFormProps {
  initialName: string;
  initialColor: string;
  onSave: (name: string, color: string) => void;
}

function ProfileForm({ initialName, initialColor, onSave }: ProfileFormProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  return (
    <div className="space-y-4 text-xs font-semibold text-slate-700">
      
      {/* Name Input */}
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Your Nickname</label>
        <input 
          type="text"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all text-slate-800"
        />
      </div>

      {/* Avatar Color choices */}
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Choose Avatar Color</label>
        <div className="flex items-center gap-2.5">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-7 h-7 rounded-full transition-transform cursor-pointer relative"
              style={{ backgroundColor: c }}
            >
              {color === c && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-[10px]">
                  <Check className="w-4 h-4 stroke-[3]" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-3">
        <button
          onClick={() => onSave(name.trim() || 'Anonymous', color)}
          disabled={!name.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl py-2.5 font-bold transition-all shadow-sm shadow-indigo-100 cursor-pointer active:scale-95 text-center"
        >
          Confirm changes
        </button>
      </div>

    </div>
  );
}
