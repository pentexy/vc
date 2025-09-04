const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and users
const rooms = new Map();
const users = new Map();

// Generate a unique room ID
app.get('/api/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, {
    id: roomId,
    participants: new Map(),
    created: Date.now()
  });
  res.json({ roomId });
});

// Check if room exists
app.get('/api/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  if (rooms.has(roomId)) {
    res.json({ exists: true });
  } else {
    res.status(404).json({ exists: false });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', (data) => {
    const { roomId, userId, userName } = data;
    
    if (!rooms.has(roomId)) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }
    
    const room = rooms.get(roomId);
    
    // Check if room is full (max 4 participants)
    if (room.participants.size >= 4) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    
    // Add user to room
    room.participants.set(userId, {
      id: userId,
      name: userName,
      socketId: socket.id,
      muted: false
    });
    
    // Store user info
    users.set(socket.id, {
      id: userId,
      name: userName,
      roomId: roomId
    });
    
    // Join socket room
    socket.join(roomId);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId,
      userName
    });
    
    // Send current participants to the new user
    const participants = Array.from(room.participants.values()).map(p => ({
      id: p.id,
      name: p.name,
      muted: p.muted
    }));
    
    socket.emit('room-participants', {
      participants,
      roomId
    });
    
    console.log(`User ${userName} joined room ${roomId}`);
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: data.sender
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: data.sender
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: data.sender
    });
  });

  // Mute/unmute handling
  socket.on('toggle-mute', (data) => {
    const user = users.get(socket.id);
    if (user && rooms.has(user.roomId)) {
      const room = rooms.get(user.roomId);
      const participant = room.participants.get(user.id);
      
      if (participant) {
        participant.muted = data.muted;
        
        // Broadcast mute status to all room participants
        io.to(user.roomId).emit('user-mute-updated', {
          userId: user.id,
          muted: data.muted
        });
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const user = users.get(socket.id);
    if (user) {
      const roomId = user.roomId;
      
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.participants.delete(user.id);
        
        // Notify others
        socket.to(roomId).emit('user-left', {
          userId: user.id
        });
        
        // Clean up room if empty
        if (room.participants.size === 0) {
          // Optional: Remove room after a delay to allow reconnection
          setTimeout(() => {
            if (rooms.get(roomId)?.participants.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} deleted`);
            }
          }, 30000); // 30 seconds delay
        }
      }
      
      users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
