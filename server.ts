import express from 'express';
import { createServer as createServerHttp } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServerHttp(app);
const wss = new WebSocketServer({ noServer: true });

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

interface Activity {
  id: string;
  userName: string;
  action: string;
  timestamp: string;
}

interface RoomState {
  tasks: Task[];
  users: { [userId: string]: UserPresence };
  activities: Activity[];
}

// In-memory session store
const rooms: { [roomId: string]: RoomState } = {};

// Helper to create initial/sample tasks for a new room
function createSampleTasks(): Task[] {
  return [
    {
      id: 'task-1',
      title: '🎯 Welcome to CollabTask!',
      description: 'This is a real-time collaborative task manager. Any changes you make here will sync instantly with all other users viewing this board.',
      column: 'todo',
      priority: 'high',
      assignee: 'Unassigned',
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
      checklist: [
        { id: 'c1', text: 'Open this app in a separate browser window or private tab', completed: false },
        { id: 'c2', text: 'Watch your cursor move and tasks update in real-time!', completed: false }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'task-2',
      title: '💻 Drag or move tasks',
      description: 'Click on a card to see task details, manage the subtask checklist, or change priorities. Use the directional buttons on the card to move columns.',
      column: 'inprogress',
      priority: 'medium',
      assignee: 'Product Team',
      dueDate: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
      checklist: [
        { id: 'c3', text: 'Move this task to "Review"', completed: false }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'task-3',
      title: '✨ Multi-user Cursor Presence',
      description: 'Move your mouse around the board. Other users will see your cursor gliding in real-time with your custom color and username!',
      column: 'review',
      priority: 'low',
      assignee: 'Design Team',
      dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      checklist: [],
      createdAt: new Date().toISOString()
    }
  ];
}

// Active connections mapping
interface ClientConnection {
  ws: WebSocket;
  userId: string;
  roomId: string;
}
const activeConnections = new Map<WebSocket, ClientConnection>();

// Handle upgraded WebSockets
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Let Vite handle its own upgrading if needed
  }
});

// Broadcast helper
function broadcastToRoom(roomId: string, message: any, excludeWs?: WebSocket) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (!excludeWs || client !== excludeWs)) {
      const conn = activeConnections.get(client);
      if (conn && conn.roomId === roomId) {
        client.send(JSON.stringify(message));
      }
    }
  });
}

// Log an activity
function addActivity(roomId: string, userName: string, action: string) {
  const room = rooms[roomId];
  if (!room) return;
  const newActivity: Activity = {
    id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    userName,
    action,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  room.activities.unshift(newActivity);
  // Cap at 30 activities
  if (room.activities.length > 30) {
    room.activities.pop();
  }
  broadcastToRoom(roomId, {
    type: 'activity',
    payload: newActivity
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      const { type, roomId, payload } = data;

      if (type === 'join') {
        const { id: userId, name, color } = payload;
        
        // Setup room state if not exists
        if (!rooms[roomId]) {
          rooms[roomId] = {
            tasks: createSampleTasks(),
            users: {},
            activities: []
          };
        }

        const room = rooms[roomId];

        // Track connection
        activeConnections.set(ws, { ws, userId, roomId });

        // Add user presence
        room.users[userId] = {
          id: userId,
          name,
          color,
          cursor: null,
          lastActive: Date.now()
        };

        // Send full sync data to the joining user
        ws.send(JSON.stringify({
          type: 'sync',
          payload: {
            tasks: room.tasks,
            users: room.users,
            activities: room.activities
          }
        }));

        // Broadcast presence update to others
        broadcastToRoom(roomId, {
          type: 'user_joined',
          payload: room.users[userId]
        }, ws);

        addActivity(roomId, name, 'joined the board');
      }

      // Handle custom messages if connected
      const conn = activeConnections.get(ws);
      if (!conn) return;

      const currentRoomId = conn.roomId;
      const currentUserId = conn.userId;
      const room = rooms[currentRoomId];
      if (!room) return;

      const currentUserPresence = room.users[currentUserId];
      const currentUserName = currentUserPresence ? currentUserPresence.name : 'Someone';

      switch (type) {
        case 'cursor_move': {
          if (room.users[currentUserId]) {
            room.users[currentUserId].cursor = payload.cursor;
            room.users[currentUserId].lastActive = Date.now();
            broadcastToRoom(currentRoomId, {
              type: 'cursor_update',
              payload: {
                userId: currentUserId,
                cursor: payload.cursor
              }
            }, ws);
          }
          break;
        }

        case 'user_update': {
          if (room.users[currentUserId]) {
            const oldName = room.users[currentUserId].name;
            room.users[currentUserId].name = payload.name;
            room.users[currentUserId].color = payload.color;
            room.users[currentUserId].lastActive = Date.now();

            broadcastToRoom(currentRoomId, {
              type: 'user_updated',
              payload: room.users[currentUserId]
            });

            if (oldName !== payload.name) {
              addActivity(currentRoomId, oldName, `renamed to "${payload.name}"`);
            }
          }
          break;
        }

        case 'task_create': {
          const newTask: Task = {
            ...payload,
            createdAt: new Date().toISOString()
          };
          room.tasks.push(newTask);
          broadcastToRoom(currentRoomId, {
            type: 'task_created',
            payload: newTask
          }, ws);
          addActivity(currentRoomId, currentUserName, `created task "${newTask.title}"`);
          break;
        }

        case 'task_update': {
          const updatedTask: Task = payload;
          const index = room.tasks.findIndex(t => t.id === updatedTask.id);
          if (index !== -1) {
            const previousTask = room.tasks[index];
            room.tasks[index] = updatedTask;
            broadcastToRoom(currentRoomId, {
              type: 'task_updated',
              payload: updatedTask
            }, ws);

            // Log column move specifically if columns differ
            if (previousTask.column !== updatedTask.column) {
              const colLabels: { [key: string]: string } = {
                todo: 'To Do',
                inprogress: 'In Progress',
                review: 'Review',
                done: 'Done'
              };
              addActivity(
                currentRoomId,
                currentUserName,
                `moved "${updatedTask.title}" to ${colLabels[updatedTask.column] || updatedTask.column}`
              );
            } else if (previousTask.title !== updatedTask.title) {
              addActivity(currentRoomId, currentUserName, `renamed task to "${updatedTask.title}"`);
            } else {
              addActivity(currentRoomId, currentUserName, `updated task "${updatedTask.title}"`);
            }
          }
          break;
        }

        case 'task_delete': {
          const { id: taskId } = payload;
          const taskIndex = room.tasks.findIndex(t => t.id === taskId);
          if (taskIndex !== -1) {
            const deletedTaskName = room.tasks[taskIndex].title;
            room.tasks.splice(taskIndex, 1);
            broadcastToRoom(currentRoomId, {
              type: 'task_deleted',
              payload: { id: taskId }
            }, ws);
            addActivity(currentRoomId, currentUserName, `deleted task "${deletedTaskName}"`);
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message processing error:', err);
    }
  });

  ws.on('close', () => {
    const conn = activeConnections.get(ws);
    if (conn) {
      const { roomId, userId } = conn;
      const room = rooms[roomId];
      if (room && room.users[userId]) {
        const userName = room.users[userId].name;
        delete room.users[userId];
        activeConnections.delete(ws);

        // Notify others
        broadcastToRoom(roomId, {
          type: 'user_left',
          payload: { id: userId }
        });

        addActivity(roomId, userName, 'left the board');

        // Clean up empty room after 1 hour if inactive
        if (Object.keys(room.users).length === 0) {
          // Keep it for now, can clean up later if storage was persistent
        }
      }
    }
  });
});

// Configure Vite or Static Assets
if (process.env.NODE_ENV !== 'production') {
  console.log('Starting server in development mode with Vite middleware...');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);

  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;
    try {
      let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
} else {
  console.log('Starting server in production mode...');
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist/index.html'));
  });
}

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
