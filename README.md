# Pokémon Battle Platform

A local-first, full-stack Pokémon battle simulator workspace built on modern web technologies. This platform provides a deterministic battle engine, a comprehensive team builder, CPU battles with unique AI personas, and local LAN PvP capabilities.

## Features

- **Full National Dex:** Support for Generations 1-9 via `@pkmn/sim` and `@pkmn/data`.
- **Advanced Team Builder:** 
  - Search by Name, Type, or Region.
  - Interactive Move Picker with descriptions, power, accuracy, and PP.
  - One-click randomized teams.
  - Native support for importing Pokémon Showdown format teams.
- **Persona-Driven CPU AI:** Play against unique CPU trainers:
  - 🎲 **Random Trainer:** Fully randomized team from the entire National Dex.
  - 🐛 **Bug Catcher Timmy:** Weak bug-type bias, random moves.
  - 🪨 **Gym Leader Brock:** Strong mid-range Pokémon, greedy damage moves.
  - 🐉 **Champion Lance:** High-BST Dragons, intelligent predictive switching and strategic moves.
- **LAN PvP:** Host a local room and share your code to battle friends on the same network via Socket.io.
- **Dynamic UI:** Animated Showdown sprites, dynamic health bars, coloured type badges, and real-time battle logs.

## Workspace Architecture

This project is a monorepo utilizing npm workspaces:

- `client/`: React + Vite frontend for the lobby, team builder, and battle UI.
- `server/`: Express + Socket.io backend handling API routes and LAN rooms.
- `engine/`: The core deterministic battle logic, stat calculation (EVs/IVs/Natures), and AI decision trees.
- `data/`: In-memory data pipeline leveraging `@pkmn/dex` to serve species, moves, and learnsets.
- `shared/`: Zod schemas and TypeScript types shared across the entire stack.

## Local Development

1. **Install dependencies:**
```bash
npm install
```

2. **Start the development servers:**
```bash
npm run dev
```

This will concurrently start:
- Web Client: `http://localhost:5173`
- API Server: `http://localhost:4000`

*(Note: The server requires Node.js v22+)*

## Production Build

To build the entire workspace for production:
```bash
npm run build
```

The compiled client will be placed in `client/dist` and the server will automatically serve it. You can start the production server with:
```bash
npm run start --workspace @pokemon-platform/server
```

## Stat Mechanics

The engine accurately computes stats based on standard competitive rules:
- **Base Stats** derived directly from the official Pokédex.
- **IVs** default to 31.
- **EVs** default to 85 across the board unless specified via Showdown import.
- **Natures** apply a 10% modifier to the appropriate stats.
