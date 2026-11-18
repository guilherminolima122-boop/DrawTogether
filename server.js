const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "DrawTogether" });
});

const rooms = new Map();
const MAX_PEOPLE = 5;

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function joinRoom(socket, code, name, callback) {
  code = String(code || "").toUpperCase().trim();

  if (!rooms.has(code)) {
    callback({ ok: false, error: "Sala não encontrada." });
    return;
  }

  const room = rooms.get(code);

  if (room.people.size >= MAX_PEOPLE) {
    callback({ ok: false, error: "Sala cheia (máximo 5 pessoas)." });
    return;
  }

  const nickname = String(name || "Artista").trim().slice(0, 18) || "Artista";

  socket.join(code);
  socket.data.room = code;

  room.people.set(socket.id, {
    id: socket.id,
    name: nickname
  });

  callback({
    ok: true,
    code,
    people: [...room.people.values()],
    strokes: room.strokes
  });

  io.to(code).emit("people", [...room.people.values()]);
}

io.on("connection", (socket) => {

  socket.on("create-room", (name, callback) => {
    let code;

    do {
      code = generateCode();
    } while (rooms.has(code));

    rooms.set(code, {
      people: new Map(),
      strokes: []
    });

    joinRoom(socket, code, name, callback);
  });

  socket.on("join-room", (data, callback) => {
    joinRoom(
      socket,
      data?.code,
      data?.name,
      callback
    );
  });

  socket.on("stroke-start", (data) => {
    const code = socket.data.room;
    if (!code || !data?.point) return;

    const room = rooms.get(code);
    if (!room) return;

    const stroke = {
      ...data,
      owner: socket.id,
      points: [data.point]
    };

    room.strokes.push(stroke);

    socket.to(code).emit("stroke-start", stroke);
  });

  socket.on("stroke-points", (data) => {
    const code = socket.data.room;
    if (!code || !data?.points) return;

    const room = rooms.get(code);
    if (!room) return;

    const stroke = room.strokes.find(
      s => s.id === data.id && s.owner === socket.id
    );

    if (!stroke) return;

    stroke.points.push(...data.points);

    socket.to(code).emit("stroke-points", data);
  });

  socket.on("stroke-end", (id) => {
    const code = socket.data.room;
    if (code) socket.to(code).emit("stroke-end", id);
  });

  socket.on("undo", () => {
    const code = socket.data.room;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const index = room.strokes
      .map(s => s.owner)
      .lastIndexOf(socket.id);

    if (index !== -1) {
      const [stroke] = room.strokes.splice(index, 1);
      io.to(code).emit("remove-stroke", stroke.id);
    }
  });

  socket.on("clear-canvas", () => {
    const code = socket.data.room;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.strokes = [];
    io.to(code).emit("clear-canvas");
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.people.delete(socket.id);

    io.to(code).emit("people", [...room.people.values()]);

    if (room.people.size === 0) {
      rooms.delete(code);
    }
  });

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("DrawTogether funcionando na porta " + PORT);
});
