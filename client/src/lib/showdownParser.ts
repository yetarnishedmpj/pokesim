import type { TeamDefinition, TeamMemberDefinition } from '@pokemon-platform/shared';

export function parseShowdownTeam(text: string, catalogSpecies: { name: string, id: string }[]): TeamDefinition {
  const members: TeamMemberDefinition[] = [];
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n').map(l => l.trim());
    
    // First line: Name @ Item or Name (Nickname) @ Item
    const firstLine = lines[0];
    let speciesNameRaw = firstLine.split('@')[0].trim();
    const item = firstLine.includes('@') ? firstLine.split('@')[1].trim() : undefined;
    
    // Check for Nickname (Species)
    if (speciesNameRaw.includes('(') && speciesNameRaw.includes(')')) {
      const match = speciesNameRaw.match(/\(([^)]+)\)/);
      if (match) {
        speciesNameRaw = match[1].trim();
      }
    }
    
    // Find speciesId
    const speciesInfo = catalogSpecies.find(s => s.name.toLowerCase() === speciesNameRaw.toLowerCase());
    if (!speciesInfo) continue; // Skip invalid Pokemon
    
    const member: TeamMemberDefinition = {
      speciesId: speciesInfo.id,
      item,
      moves: [],
      evs: {},
      ivs: {}
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('Ability:')) {
        member.ability = line.replace('Ability:', '').trim();
      } else if (line.startsWith('Level:')) {
        member.level = parseInt(line.replace('Level:', '').trim(), 10);
      } else if (line.startsWith('Shiny:')) {
        member.shiny = line.replace('Shiny:', '').trim() === 'Yes';
      } else if (line.includes('Nature')) {
        member.nature = line.replace('Nature', '').trim();
      } else if (line.startsWith('- ')) {
        member.moves!.push(line.replace('- ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
      } else if (line.startsWith('EVs:')) {
        const parts = line.replace('EVs:', '').split('/');
        for (const p of parts) {
          const [val, stat] = p.trim().split(' ');
          const n = parseInt(val, 10);
          if (stat === 'HP') member.evs!.hp = n;
          if (stat === 'Atk') member.evs!.attack = n;
          if (stat === 'Def') member.evs!.defense = n;
          if (stat === 'SpA') member.evs!.specialAttack = n;
          if (stat === 'SpD') member.evs!.specialDefense = n;
          if (stat === 'Spe') member.evs!.speed = n;
        }
      } else if (line.startsWith('IVs:')) {
        const parts = line.replace('IVs:', '').split('/');
        for (const p of parts) {
          const [val, stat] = p.trim().split(' ');
          const n = parseInt(val, 10);
          if (stat === 'HP') member.ivs!.hp = n;
          if (stat === 'Atk') member.ivs!.attack = n;
          if (stat === 'Def') member.ivs!.defense = n;
          if (stat === 'SpA') member.ivs!.specialAttack = n;
          if (stat === 'SpD') member.ivs!.specialDefense = n;
          if (stat === 'Spe') member.ivs!.speed = n;
        }
      }
    }
    
    // Ensure array doesn't break schema
    if (member.moves?.length === 0) delete member.moves;
    if (Object.keys(member.evs || {}).length === 0) delete member.evs;
    if (Object.keys(member.ivs || {}).length === 0) delete member.ivs;

    members.push(member);
  }

  return { pokemon: members };
}
