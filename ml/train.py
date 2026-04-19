#!/usr/bin/env python3
"""
PokéSim AI Training Pipeline
=============================
Fetches real VGC championship replays from Pokémon Showdown,
parses battle logs to extract strategic patterns, trains a
lightweight RandomForest classifier, and exports learned thresholds
to ai_knowledge.json for use by the Node.js battle engine.

Usage:  python train.py
Output: ai_knowledge.json  (~1-2 minutes to run)
"""

import requests
import json
import time
import sys
import os
import re
from collections import defaultdict

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier

# ─── Config ────────────────────────────────────────────────────────────────
FORMATS        = ["gen9ou", "gen9vgc2025regg", "gen9randombattle"]
N_PAGES        = 4          # 4 × ~50 replays = ~200 per format
REQUEST_DELAY  = 0.25       # seconds between requests (be nice to the API)
OUTPUT_PATH    = os.path.join(os.path.dirname(__file__), "ai_knowledge.json")
MIN_REPLAYS    = 30         # abort if we collect fewer than this

# Move classification dictionaries
STATUS_MOVES = {
    "taunt", "trick room", "tailwind", "protect", "wide guard", "quick guard",
    "follow me", "rage powder", "helping hand", "thunder wave", "will-o-wisp",
    "sleep powder", "spore", "toxic", "parting shot", "u-turn", "volt switch",
    "calm mind", "swords dance", "quiver dance", "nasty plot", "ally switch",
    "lunar blessing", "fake out", "encore", "disable", "detect", "endure",
    "safeguard", "light screen", "reflect", "aurora veil", "trick", "switcheroo",
    "intimidate", "encore", "perish song", "belly drum", "curse",
}

BOOST_MOVES = {
    "swords dance", "nasty plot", "calm mind", "quiver dance", "dragon dance",
    "agility", "cosmic power", "bulk up", "work up", "shell smash", "coil",
    "amnesia", "growth", "hone claws", "iron defense", "acid armor",
}

PRIORITY_MOVES = {
    "fake out", "extreme speed", "bullet punch", "mach punch", "aqua jet",
    "sucker punch", "shadow sneak", "ice shard", "quick attack", "accelerock",
    "grassy glide", "vacuum wave", "water shuriken",
}

# ─── Data Collection ────────────────────────────────────────────────────────

def fetch_replay_list(fmt, n_pages):
    replays = []
    for page in range(1, n_pages + 1):
        url = f"https://replay.pokemonshowdown.com/search.json?format={fmt}&page={page}"
        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            data = r.json()
            if not data:
                break
            replays.extend(data)
            print(f"  [{fmt}] page {page}: +{len(data)} replays")
            time.sleep(REQUEST_DELAY)
        except Exception as e:
            print(f"  [{fmt}] page {page} error: {e}")
    return replays

def fetch_log(replay_id):
    url = f"https://replay.pokemonshowdown.com/{replay_id}.json"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.json().get("log", "")
    except Exception:
        return ""

# ─── Log Parsing ────────────────────────────────────────────────────────────

def parse_log(log):
    """
    Parse a Showdown battle log into structured behavioral data.
    Returns a dict of event lists.
    """
    lines = log.split("\n")

    # Running state
    turn          = 0
    hp            = {}          # slot -> float [0,1]
    fainted_slots = set()       # slots that fainted this turn (→ forced switch)
    last_supereff = None        # slot that received a super-effective hit
    winner        = None

    # Collected data points
    switch_events  = []   # (hp_pct, turn)             voluntary switches
    supereff_resp  = []   # 'switch' | 'attack'         response to super-eff hit
    move_events    = []   # (hp_pct, category, turn)    move choices
    ko_responses   = []   # 'aggressive' | 'passive'    behaviour near KO range
    turn1_actions  = []   # 'priority' | 'setup' | 'attack'

    for i, line in enumerate(lines):
        if not line or line == "|":
            continue
        parts = line.split("|")
        if len(parts) < 2:
            continue
        cmd = parts[1]

        # ── Turn boundary
        if cmd == "turn":
            turn = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else turn + 1
            fainted_slots = set()
            last_supereff = None

        # ── Switch / drag
        elif cmd in ("switch", "drag"):
            if len(parts) < 5:
                continue
            slot    = parts[2].split(":")[0].strip()     # e.g. "p1a"
            hp_str  = parts[4].strip()
            # parse HP
            m = re.match(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", hp_str)
            if m:
                cur, mx = float(m.group(1)), float(m.group(2))
                hp[slot] = cur / mx if mx > 0 else 0.0

            # record voluntary switch (not lead selection, not forced after faint)
            if slot not in fainted_slots and turn > 1 and cmd == "switch":
                old_hp = hp.get(slot, 1.0)
                switch_events.append((old_hp, turn))
                if last_supereff and last_supereff.startswith(slot[:2]):
                    supereff_resp.append("switch")
                    last_supereff = None

        # ── Move
        elif cmd == "move":
            if len(parts) < 4:
                continue
            slot      = parts[2].split(":")[0].strip()
            move_name = parts[3].strip().lower()
            hp_pct    = hp.get(slot, 1.0)

            # classify
            if move_name in BOOST_MOVES:
                cat = "boost"
            elif move_name in STATUS_MOVES:
                cat = "status"
            else:
                cat = "damage"

            move_events.append((hp_pct, cat, turn))

            # turn 1 pattern
            if turn == 1:
                if move_name in PRIORITY_MOVES:
                    turn1_actions.append("priority")
                elif cat == "boost":
                    turn1_actions.append("setup")
                else:
                    turn1_actions.append("attack")

            # response to super-effective hit
            if last_supereff and not last_supereff.startswith(slot[:2]):
                supereff_resp.append("attack")
                last_supereff = None

            # near-KO aggression
            opp_prefix = "p2" if slot.startswith("p1") else "p1"
            opp_slots   = [s for s in hp if s.startswith(opp_prefix)]
            if opp_slots and min(hp[s] for s in opp_slots) < 0.30:
                ko_responses.append("aggressive" if cat == "damage" else "passive")

        # ── Damage
        elif cmd == "-damage":
            if len(parts) < 4:
                continue
            slot   = parts[2].split(":")[0].strip()
            hp_str = parts[3].strip()
            if "fnt" in hp_str:
                hp[slot] = 0.0
            else:
                m = re.match(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", hp_str)
                if m:
                    cur, mx = float(m.group(1)), float(m.group(2))
                    hp[slot] = cur / mx if mx > 0 else 0.0

        # ── Super-effective marker (appears BEFORE the -damage line in the log)
        elif cmd == "-supereffective":
            # look back for the most recent -damage target
            for j in range(i - 1, max(i - 6, -1), -1):
                prev_parts = lines[j].split("|")
                if len(prev_parts) > 2 and prev_parts[1] == "-damage":
                    last_supereff = prev_parts[2].split(":")[0].strip()
                    break

        # ── Faint
        elif cmd == "faint":
            if len(parts) >= 3:
                slot = parts[2].split(":")[0].strip()
                fainted_slots.add(slot)
                hp[slot] = 0.0

        # ── Winner
        elif cmd == "win":
            if len(parts) >= 3:
                winner = parts[2]

    return {
        "switch_events":  switch_events,
        "supereff_resp":  supereff_resp,
        "move_events":    move_events,
        "ko_responses":   ko_responses,
        "turn1_actions":  turn1_actions,
        "winner":         winner,
    }

# ─── Analysis & Training ────────────────────────────────────────────────────

def aggregate(all_samples):
    switch_events  = []
    supereff_resp  = []
    move_events    = []
    ko_responses   = []
    turn1_actions  = []

    for s in all_samples:
        switch_events.extend(s["switch_events"])
        supereff_resp.extend(s["supereff_resp"])
        move_events.extend(s["move_events"])
        ko_responses.extend(s["ko_responses"])
        turn1_actions.extend(s["turn1_actions"])

    print(f"\n  Switch events  : {len(switch_events)}")
    print(f"  Supereff resp  : {len(supereff_resp)}")
    print(f"  Move events    : {len(move_events)}")
    print(f"  KO responses   : {len(ko_responses)}")
    print(f"  Turn-1 actions : {len(turn1_actions)}")

    # ── Switch threshold (HP% at which players voluntarily switch)
    switch_hps = [hp for hp, t in switch_events if hp > 0.05 and t > 1]
    if len(switch_hps) >= 10:
        # Train a 1-feature decision tree to find the natural split point
        X = np.array(switch_hps).reshape(-1, 1)
        y = (X.ravel() < np.median(switch_hps)).astype(int)  # 1=low_hp switch
        dt = DecisionTreeClassifier(max_depth=1)
        dt.fit(X, y)
        switch_threshold = float(dt.tree_.threshold[0])
        switch_threshold = max(0.20, min(0.55, switch_threshold))  # clamp
    else:
        switch_threshold = 0.35  # sensible default

    # ── Supereff response rate
    if supereff_resp:
        switch_on_supereff = supereff_resp.count("switch") / len(supereff_resp)
    else:
        switch_on_supereff = 0.45

    # ── Move category preferences by HP bucket
    buckets = {"high": [], "mid": [], "low": [], "critical": []}
    for hp_pct, cat, _ in move_events:
        if hp_pct >= 0.75:
            buckets["high"].append(cat)
        elif hp_pct >= 0.50:
            buckets["mid"].append(cat)
        elif hp_pct >= 0.25:
            buckets["low"].append(cat)
        else:
            buckets["critical"].append(cat)

    def cat_dist(cats):
        if not cats:
            return {"damage": 0.70, "status": 0.20, "boost": 0.10}
        total = len(cats)
        return {c: round(cats.count(c) / total, 3)
                for c in ["damage", "status", "boost"]}

    move_prefs = {bucket: cat_dist(cats) for bucket, cats in buckets.items()}

    # ── KO aggression
    if ko_responses:
        aggression_rate = ko_responses.count("aggressive") / len(ko_responses)
    else:
        aggression_rate = 0.82

    # ── Turn 1 patterns
    if turn1_actions:
        total_t1 = len(turn1_actions)
        turn1_dist = {
            "priority": round(turn1_actions.count("priority") / total_t1, 3),
            "setup":    round(turn1_actions.count("setup")    / total_t1, 3),
            "attack":   round(turn1_actions.count("attack")   / total_t1, 3),
        }
    else:
        turn1_dist = {"priority": 0.35, "setup": 0.15, "attack": 0.50}

    # ── Build a simple switch/attack RandomForest model
    # Features: [hp_pct, is_turn_early, is_switch]
    X_clf, y_clf = [], []
    for hp_pct, turn in switch_events:
        X_clf.append([hp_pct, 1 if turn <= 3 else 0])
        y_clf.append(1)  # switched
    for hp_pct, cat, turn in move_events:
        X_clf.append([hp_pct, 1 if turn <= 3 else 0])
        y_clf.append(0)  # attacked

    feature_importances = [0.5, 0.5]  # defaults
    if len(X_clf) >= 20:
        rf = RandomForestClassifier(n_estimators=50, max_depth=4, random_state=42)
        rf.fit(X_clf, y_clf)
        feature_importances = rf.feature_importances_.tolist()
        print(f"\n  RF Feature importances -> hp_pct: {feature_importances[0]:.3f}, early_turn: {feature_importances[1]:.3f}")

    return {
        "version": "1.0",
        "trained_on_replays": len(all_samples),
        "switch_threshold": round(switch_threshold, 3),
        "switch_on_supereff_rate": round(switch_on_supereff, 3),
        "aggression_near_ko": round(aggression_rate, 3),
        "turn1_distribution": turn1_dist,
        "move_prefs_by_hp": move_prefs,
        "feature_importances": {
            "hp_pct": round(feature_importances[0], 3),
            "early_turn": round(feature_importances[1], 3),
        },
        "raw_counts": {
            "switch_events":  len(switch_events),
            "move_events":    len(move_events),
            "supereff_resp":  len(supereff_resp),
        },
    }

# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  PokéSim AI Training Pipeline")
    print("=" * 60)

    # 1. Collect replay list
    print("\n[1/4] Fetching replay lists...")
    all_meta = []
    for fmt in FORMATS:
        all_meta.extend(fetch_replay_list(fmt, N_PAGES))
    print(f"  Total replays found: {len(all_meta)}")

    if len(all_meta) < MIN_REPLAYS:
        print(f"ERROR: Not enough replays ({len(all_meta)} < {MIN_REPLAYS}). Exiting.")
        sys.exit(1)

    # 2. Download and parse replay logs
    print(f"\n[2/4] Downloading & parsing {len(all_meta)} replay logs...")
    all_samples = []
    errors = 0
    for i, meta in enumerate(all_meta):
        rid = meta.get("id", "")
        if not rid:
            continue
        log = fetch_log(rid)
        if not log:
            errors += 1
            continue
        sample = parse_log(log)
        all_samples.append(sample)
        if (i + 1) % 20 == 0:
            print(f"  Processed {i + 1}/{len(all_meta)} replays ({errors} errors)")
        time.sleep(REQUEST_DELAY)

    print(f"  Done. Parsed {len(all_samples)} replays, {errors} errors.")

    if len(all_samples) < MIN_REPLAYS:
        print(f"ERROR: Parsed too few replays ({len(all_samples)}). Exiting.")
        sys.exit(1)

    # 3. Train model and extract knowledge
    print("\n[3/4] Training model & extracting strategic knowledge...")
    knowledge = aggregate(all_samples)

    # 4. Save output
    print(f"\n[4/4] Saving knowledge to: {OUTPUT_PATH}")
    with open(OUTPUT_PATH, "w") as f:
        json.dump(knowledge, f, indent=2)

    print("\n✅ Training complete!")
    print(f"   Replays used    : {knowledge['trained_on_replays']}")
    print(f"   Switch threshold: {knowledge['switch_threshold']:.0%} HP")
    print(f"   Supereff switch : {knowledge['switch_on_supereff_rate']:.0%}")
    print(f"   KO aggression   : {knowledge['aggression_near_ko']:.0%}")
    print(f"   Output file     : {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
