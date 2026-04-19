import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import {
  createCpuBattleSchema,
  hostLanBattleSchema,
  joinLanBattleSchema,
  socketEvents,
  startTournamentRequestSchema,
  submitChoiceSchema,
} from '@pokemon-platform/shared';
import { getLearnsetForSpecies } from '@pokemon-platform/data';
import { BattleRuntime } from './runtime.js';

// ─────────────────────────────────────────
// Env / config
// ─────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isDev = NODE_ENV === 'development';

/**
 * Allowed CORS origins.
 * In production, set CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
 * In dev, the Vite dev server on 5173 is always allowed.
 */
const allowedOrigins: string[] = isDev
  ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177', 'http://localhost:5178', 'http://localhost:5179', 'http://localhost:5180', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175']
  : (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

// ─────────────────────────────────────────
// Express + HTTP server
// ─────────────────────────────────────────
const app = express();
const server = createServer(app);

// ── Security headers (Helmet) ──
app.use(
  helmet({
    // Allow Pokémon Showdown sprite CDN and Google Fonts in CSP
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Vite injects inline scripts in dev
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: [
          "'self'",
          'data:',
          'https://play.pokemonshowdown.com',
          'https://raw.githubusercontent.com',
        ],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // needed for Pokémon sprites from external CDN
  }),
);

// ── CORS ──
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server (no origin) and any allowed origin
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" is not allowed`));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    optionsSuccessStatus: 204,
  }),
);

// ── Body parsing — tight limits ──
app.use(express.json({ limit: '64kb' }));

// ─────────────────────────────────────────
// Rate limiters
// ─────────────────────────────────────────
/** General API limiter: 120 req / 1 min per IP */
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

/** Battle creation: 10 battles / 1 min per IP (prevents abuse) */
const battleCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many battles created. Please wait a moment.' },
});

/** Move/catalog lookups: 200 req / 1 min — these are read-only */
const readLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

app.use('/api/', generalLimiter);

// ─────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
  },
  // Limit incoming event payload size
  maxHttpBufferSize: 16_384, // 16 KB
});

const runtime = new BattleRuntime();
runtime.attachIO(io);

// ─────────────────────────────────────────
// Routes
// ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'PokéSim', env: NODE_ENV });
});

app.get('/api/catalog', readLimiter, async (_req, res, next) => {
  try {
    res.json(await runtime.getCatalog());
  } catch (err) {
    next(err);
  }
});

app.get('/api/pokemon/:speciesId/moves', readLimiter, async (req, res, next) => {
  try {
    // Sanitise — only allow lowercase alphanumeric + hyphens (valid Pokémon ids)
    const raw = String(req.params.speciesId ?? '');
    const speciesId = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!speciesId) {
      res.status(400).json({ message: 'Invalid species ID.' });
      return;
    }
    const moves = await getLearnsetForSpecies(speciesId);
    res.json({ moves });
  } catch (err) {
    next(err);
  }
});

app.post('/api/battles/cpu', battleCreateLimiter, async (req, res, next) => {
  try {
    const payload = createCpuBattleSchema.parse(req.body);
    res.status(201).json(await runtime.createCpuBattle(payload));
  } catch (err) {
    next(err);
  }
});

app.post('/api/tournament/start', battleCreateLimiter, async (req, res, next) => {
  try {
    const payload = startTournamentRequestSchema.parse(req.body);
    res.status(201).json(await runtime.startTournament(payload.playerName, payload.team));
  } catch (err) {
    next(err);
  }
});

app.post('/api/tournament/:id/next', battleCreateLimiter, async (req, res, next) => {
  try {
    res.status(200).json(await runtime.nextTournamentStage(req.params.id));
  } catch (err) {
    next(err);
  }
});

app.post('/api/lan/host', battleCreateLimiter, (req, res, next) => {
  try {
    const payload = hostLanBattleSchema.parse(req.body);
    res.status(201).json(runtime.hostLanBattle(payload));
  } catch (err) {
    next(err);
  }
});

app.post('/api/lan/join', battleCreateLimiter, async (req, res) => {
  try {
    const payload = joinLanBattleSchema.parse(req.body);
    res.status(201).json(await runtime.joinLanBattle(payload));
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: 'Invalid request payload.', issues: err.flatten().fieldErrors });
    } else {
      res.status(404).json({ message: err instanceof Error ? err.message : 'Unable to join room.' });
    }
  }
});

app.get('/api/battles/:battleId', (req, res) => {
  // Validate battleId is a UUID-like string
  const { battleId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(battleId)) {
    res.status(400).json({ message: 'Invalid battle ID.' });
    return;
  }
  const battle = runtime.getBattle(battleId);
  if (!battle) {
    res.status(404).json({ message: 'Battle not found.' });
    return;
  }
  res.json({ state: battle });
});

app.post('/api/battles/:battleId/choice', (req, res, next) => {
  try {
    const { battleId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(battleId)) {
      res.status(400).json({ message: 'Invalid battle ID.' });
      return;
    }
    const payload = submitChoiceSchema.parse({ battleId, ...req.body });
    const state = runtime.submitChoice(payload.battleId, payload.playerId, payload.choice);
    if (!state) {
      res.status(404).json({ message: 'Battle not found.' });
      return;
    }
    res.json({ state });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Invalid request payload.', issues: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof Error) {
    // Never leak stack traces in production
    res.status(400).json({ message: err.message });
    return;
  }
  res.status(500).json({ message: 'Internal Server Error' });
});

// ─────────────────────────────────────────
// Socket.IO event handling
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  // Throttle: max 60 events/min per socket before disconnecting
  let eventCount = 0;
  const throttleReset = setInterval(() => { eventCount = 0; }, 60_000);

  const guard = (fn: () => void) => {
    if (++eventCount > 60) {
      socket.emit('error', { message: 'Rate limit exceeded. Reconnect to continue.' });
      socket.disconnect(true);
      return;
    }
    try { fn(); } catch { /* swallow — never crash the server on bad socket payload */ }
  };

  socket.on('lan:watch-room', (data: unknown) => guard(() => {
    const { roomId } = data as { roomId: string };
    if (typeof roomId === 'string' && /^[A-Z0-9]{4,8}$/.test(roomId)) {
      runtime.watchRoom(socket, roomId);
    }
  }));

  socket.on('battle:watch', (data: unknown) => guard(() => {
    const { battleId, playerId } = data as { battleId: string; playerId?: string };
    if (typeof battleId === 'string' && /^[0-9a-f-]{36}$/i.test(battleId)) {
      runtime.watchBattle(socket, battleId, typeof playerId === 'string' ? playerId : undefined);
    }
  }));

  socket.on(socketEvents.battleChoice, (payload: unknown) => guard(() => {
    const parsed = submitChoiceSchema.parse(payload);
    runtime.submitChoice(parsed.battleId, parsed.playerId, parsed.choice);
  }));

  socket.on('disconnect', () => {
    clearInterval(throttleReset);
    runtime.handleDisconnect(socket.id);
  });
});

// ─────────────────────────────────────────
// Static client serving
// ─────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builtClientPath = path.resolve(__dirname, '../../client/dist');
if (existsSync(builtClientPath)) {
  app.use(express.static(builtClientPath));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(builtClientPath, 'index.html'));
  });
} else {
  console.log('[PokéSim] No client/dist found — running in API-only / dev mode.');
}

// ─────────────────────────────────────────
// Start
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// Start & Graceful Shutdown
// ─────────────────────────────────────────
const serverInstance = server.listen(PORT, () => {
  console.log(`[PokéSim] Server listening on http://localhost:${PORT} (${NODE_ENV})`);
  
  if (!isDev && allowedOrigins.length === 0) {
    console.warn('[PokéSim] WARNING: CORS_ORIGINS is not configured in production. Cross-origin requests may be blocked.');
  }
});

const shutdown = () => {
  console.log('[PokéSim] Shutting down gracefully...');
  serverInstance.close(() => {
    console.log('[PokéSim] Closed all connections.');
    process.exit(0);
  });

  // Force shutdown after 10s
  setTimeout(() => {
    console.error('[PokéSim] Could not close connections in time, forceful shutdown.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
