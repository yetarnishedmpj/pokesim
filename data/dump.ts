import { Dex } from '@pkmn/dex';
import { Generations } from '@pkmn/data';
import * as fs from 'fs';

const gens = new Generations(Dex);
const gen = gens.get(9);

async function dump() {
  console.log("Starting dump...");
  const result: Record<string, string[]> = {};
  for (const species of gen.species) {
    if (species.isNonstandard || species.isCosmeticForme) continue;
    const learnable = await gen.learnsets.learnable(species.id);
    if (learnable) {
      result[species.name] = Object.keys(learnable)
        .map(id => gen.moves.get(id)?.name || id)
        .sort();
    }
  }
  
  const outputPath = 'C:/Users/mahar/.gemini/antigravity/brain/24d3f496-5bb5-4f79-9369-e1e3b8f8ee91/pokemon_moves.json';
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Successfully dumped ${Object.keys(result).length} Pokemon to ${outputPath}`);
}

dump().catch(console.error);
