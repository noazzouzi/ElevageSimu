"""Monte Carlo 'pyramid' simulator for ElevageSimu strategy research (2026-10-01).

Goal: estimate, for one target mount, how many G1 captures, matings, clonings, fecundity raises,
paddock cycles and genetons a demand-driven breeding policy needs, under different parent levels,
Optimakina use and cloning policies. Uses the offspring model reconstructed in
research/raw/mechanics-evidence/breeding_model_reference.py (validated on 4 in-game screenshots).

Simplifications (documented in research/strategy.md):
- a 'cycle' = one half-day session (~12 h). A mount needs 1 paddock-cycle to become fecund (tier 2-3
  paddock, 10 mounts grouped by serenity) + extra cycles for XP above level 40 (XP up to ~40 is
  obtained 'for free' as second gauge during the single-stat phases).
- every mount used in a mating has level L (babies are raised to L, captures too).
- Cloning (if enabled) pairs steriles of the same generation, same colour first; result = one of the two
  at random (50/50), keeps colour/sex/genealogy, gauges reset (needs re-raising), level kept (assumption).
- Babies sex 50/50. Captured G1 sex 50/50.
- Demand-driven: each cycle the policy recomputes the expected number of mounts needed per colour
  (need/p) top-down from the target and only mates recipes whose child is still in deficit.
"""
import sys, json, math, random, itertools
from collections import defaultdict, Counter
sys.path.insert(0, '/home/user/ElevageSimu/research/raw/mechanics-evidence')
import breeding_model_reference as M

RIDES = M.rides
NAMES = {}
for f in ['tree-muldo.json', 'tree-dragodinde.json', 'tree-volkorne.json']:
    for x in json.load(open('/home/user/ElevageSimu/research/data/' + f))['mounts']:
        if x.get('dofusdbId') is not None:
            NAMES[x['dofusdbId']] = x['name']
NAME2ID = {v: k for k, v in NAMES.items()}


def gen(i):
    return RIDES[i]['generation']


def build_recipes(species):
    """child -> list of (p1,p2) ; choose cheapest recipe (min G1 captures, p=1) for each child."""
    rec = {}
    for r in RIDES.values():
        if r['speciesId'] != species or r['generation'] < 2:
            continue
        rec[r['id']] = [(p['parent1'], p['parent2']) for p in r['parents']]
    cost = {}

    def c(i):
        if i in cost:
            return cost[i]
        if gen(i) == 1:
            cost[i] = 1
            return 1
        cost[i] = min(c(a) + c(b) for a, b in rec[i])
        return cost[i]
    best = {}
    for i in rec:
        c(i)
        best[i] = min(rec[i], key=lambda ab: (c(ab[0]) + c(ab[1]), max(gen(ab[0]), gen(ab[1]))))
    return best, cost


def closure(target, best):
    need = set()

    def walk(i):
        if i in need:
            return
        need.add(i)
        if gen(i) > 1:
            a, b = best[i]
            walk(a)
            walk(b)
    walk(target)
    return need


_dist_cache = {}


def dist(a, b, opti, opti_val):
    key = (a['id'], tuple(sorted(a['parents'])), a['level'], b['id'], tuple(sorted(b['parents'])), b['level'], opti, opti_val)
    if key not in _dist_cache:
        A = {'id': a['id'], 'level': a['level'], 'parents': list(a['parents'])}
        B = {'id': b['id'], 'level': b['level'], 'parents': list(b['parents'])}
        tg, P = M.distribution(A, B, use_opti=opti, opti=opti_val)
        items = sorted(P.items(), key=lambda kv: -kv[1])
        _dist_cache[key] = (tg, items)
    return _dist_cache[key]


def xp_extra_cycles(level):
    # XP needed above the 'free' ~20k obtained as 2nd gauge during raising; 3 XP/s average (tier 3) -> 10 800 XP/h; cycle = 12 h
    table = {1: 0, 20: 0, 40: 0, 60: 52544, 80: 102685, 100: 172668, 150: 443944, 200: 867582}
    xp = table.get(level)
    if xp is None:
        xp = 0
    extra = max(0, xp - 20437)
    return extra / 10800 / 12


def simulate(target_name, level=1, opti=False, opti_val=0.10, cloning=True, slots=60, seed=0,
             max_cycles=3000, clone_keeps_level=True, p_est=None, level_by_gen=None, opti_min_gen=0):
    """level_by_gen: optional dict {parent generation: level} overriding `level` (mixed policy);
    opti_min_gen: use the Optimakina only when the recipe child generation >= this value."""
    rng = random.Random(seed)
    target = NAME2ID[target_name]
    species = RIDES[target]['speciesId']
    best, cost = build_recipes(species)
    needed = closure(target, best)
    order = sorted([c for c in needed if gen(c) > 1], key=lambda c: -gen(c))
    def lvl_of(i):
        if level_by_gen:
            return level_by_gen.get(gen(i), level)
        return level
    def p_for(c):
        if p_est is not None:
            return p_est
        a, b = best[c]
        use = opti and gen(c) >= opti_min_gen
        return min(1.0, 0.30 + 0.0015 * (lvl_of(a) + lvl_of(b)) + (opti_val if use else 0))
    XPTAB = {1: 0, 20: 4067, 40: 20437, 60: 52544, 80: 102685, 100: 172668, 150: 443944, 200: 867582}
    raw = []        # mounts waiting to be raised: dict with 'remaining' cycles
    raising = []
    fecund = []
    sterile = []
    stats = Counter()
    got = False
    extra_need = Counter()   # persistent extra demand created by sex deadlocks

    def new_mount(i, sex, parents, lvl_ok=False):
        L = lvl_of(i)
        if not lvl_ok:
            stats['xp_fuel_points'] += max(0, XPTAB.get(L, 0) - 20437) / 10.0
        return {'id': i, 'sex': sex, 'parents': parents, 'level': L, 'remaining': 1 + (0 if lvl_ok else xp_extra_cycles(L))}

    for cyc in range(1, max_cycles + 1):
        # ---- demand computation (fertile = raw+raising+fecund)
        have = Counter(m['id'] for m in raw + raising + fecund)
        need = defaultdict(float)
        need[target] = 1.0
        for c, v in extra_need.items():
            need[c] += v
        attempts_wanted = {}
        for c in order:
            deficit = max(0.0, need[c] - have[c])
            pc = p_for(c)
            att = deficit / pc
            attempts_wanted[c] = math.ceil(deficit / pc - 1e-9) if deficit > 0 else 0
            a, b = best[c]
            # with systematic cloning, each attempt gives back ~1 fertile parent (2 steriles -> 1)
            f = 0.5 if (cloning and gen(a) == gen(b)) else (0.75 if cloning else 1.0)
            need[a] += att * f
            need[b] += att * f
        # ---- matings with fecund mounts
        mated = 0
        pool = defaultdict(list)
        for m in fecund:
            pool[m['id']].append(m)
        for c in order:
            k = attempts_wanted[c]
            a, b = best[c]
            while k > 0:
                # find opposite-sex pair, prefer 'clean' trees (no member gen >= gen(c))
                def clean(m):
                    return all(gen(p) < gen(c) for p in m['parents'])
                cand = None
                for sa in ('M', 'F'):
                    sb = 'F' if sa == 'M' else 'M'
                    xa = [m for m in pool[a] if m['sex'] == sa]
                    xb = [m for m in pool[b] if m['sex'] == sb]
                    if xa and xb:
                        xa.sort(key=lambda m: not clean(m))
                        xb.sort(key=lambda m: not clean(m))
                        cand = (xa[0], xb[0])
                        break
                if not cand:
                    break
                ma, mb = cand
                pool[a].remove(ma)
                pool[b].remove(mb)
                fecund.remove(ma)
                fecund.remove(mb)
                use_opti = opti and gen(c) >= opti_min_gen
                tg, items = dist(ma, mb, use_opti, opti_val)
                r = rng.random()
                acc = 0
                baby = items[-1][0]
                for i, pr in items:
                    acc += pr
                    if r <= acc:
                        baby = i
                        break
                stats['matings'] += 1
                stats['mating_gen_sum'] += gen(ma['id']) + gen(mb['id'])
                if use_opti:
                    stats['optimakinas'] += 1
                stats['genetons'] += M.tokens({'id': ma['id'], 'parents': ma['parents']}, {'id': mb['id'], 'parents': mb['parents']}, baby)
                if baby == c:
                    stats['successes'] += 1
                for pc in (a, b):
                    if extra_need[pc] > 0:
                        extra_need[pc] -= 1
                if baby == target:
                    got = True
                bm = new_mount(baby, rng.choice('MF'), [ma['id'], mb['id']])
                raw.append(bm)
                sterile.extend([ma, mb])
                mated += 1
                k -= 1
            if got:
                break
        if got:
            stats['cycles'] = cyc
            break
        # ---- cloning
        if cloning:
            bygen = defaultdict(list)
            for m in sterile:
                bygen[gen(m['id'])].append(m)
            sterile = []
            for g, lst in bygen.items():
                useful = [m for m in lst if m['id'] in needed]
                useless = [m for m in lst if m['id'] not in needed]
                # same-colour pairs first
                bycol = defaultdict(list)
                for m in useful:
                    bycol[m['id']].append(m)
                leftovers = []
                for col, ms in bycol.items():
                    while len(ms) >= 2:
                        x, y = ms.pop(), ms.pop()
                        keep = x if rng.random() < 0.5 else y
                        stats['clones'] += 1
                        raw.append(new_mount(keep['id'], keep['sex'], keep['parents'], lvl_ok=clone_keeps_level))
                    leftovers.extend(ms)
                while len(leftovers) >= 2:
                    x, y = leftovers.pop(), leftovers.pop()
                    keep = x if rng.random() < 0.5 else y
                    stats['clones'] += 1
                    raw.append(new_mount(keep['id'], keep['sex'], keep['parents'], lvl_ok=clone_keeps_level))
                if leftovers and useless:
                    x, y = leftovers.pop(), useless.pop()
                    keep = x if rng.random() < 0.5 else y
                    stats['clones'] += 1
                    raw.append(new_mount(keep['id'], keep['sex'], keep['parents'], lvl_ok=clone_keeps_level))
                sterile.extend(leftovers + useless)
        # ---- discard raw mounts of useless colours (sold/extracted) to free slots
        keep_raw = []
        for m in raw:
            if m['id'] in needed:
                keep_raw.append(m)
            else:
                stats['surplus_mounts'] += 1
        raw = keep_raw
        # ---- captures: keep paddock slots busy, capture G1 in deficit (at most the free slots)
        have = Counter(m['id'] for m in raw + raising + fecund)
        free = slots - len(raising) - len(raw)
        captured = 0
        if free > 0:
            deficits = {c: need[c] - have[c] for c in needed if gen(c) == 1 and need[c] - have[c] > 0}
            tot = sum(deficits.values())
            if tot > 0:
                budget = min(free, math.ceil(tot))
                # proportional allocation
                alloc = {c: int(budget * v / tot) for c, v in deficits.items()}
                rest = budget - sum(alloc.values())
                for c, v in sorted(deficits.items(), key=lambda kv: -kv[1]):
                    if rest <= 0:
                        break
                    alloc[c] += 1
                    rest -= 1
                for c, n in alloc.items():
                    for _ in range(n):
                        raw.append(new_mount(c, rng.choice('MF'), []))
                    captured += n
        stats['captures'] += captured
        if mated == 0 and not raising and captured == 0 and not raw:
            # sex deadlock: recipes wanted but no opposite-sex pair -> ask for one more of each parent
            stats['deadlocks'] += 1
            for c in order:
                if attempts_wanted.get(c, 0) > 0:
                    a, b = best[c]
                    extra_need[a] += 1
                    extra_need[b] += 1
                    break
        # ---- raising: fill free slots, highest generation first
        free = slots - len(raising)
        raw.sort(key=lambda m: -gen(m['id']))
        while free > 0 and raw:
            m = raw.pop(0)
            raising.append(m)
            free -= 1
            stats['raises'] += 1
            stats['stat_fuel_points'] += 6000 + 300   # 60 000 pts shared by 10 mounts + ~3 000 pts of serenity moves per batch
        still = []
        for m in raising:
            m['remaining'] -= 1
            if m['remaining'] <= 1e-9:
                fecund.append(m)
            else:
                still.append(m)
        raising = still
    else:
        stats['cycles'] = max_cycles
        stats['failed'] = 1
    stats['sterile_left'] = len(sterile)
    stats['extract_resources'] = sum(gen(m['id']) for m in sterile)
    return stats


def summarize(target_name, runs=60, **kw):
    agg = defaultdict(list)
    for s in range(runs):
        st = simulate(target_name, seed=s, **kw)
        for k in ['captures', 'matings', 'clones', 'raises', 'cycles', 'genetons', 'optimakinas', 'surplus_mounts', 'extract_resources', 'deadlocks', 'failed', 'stat_fuel_points', 'xp_fuel_points']:
            agg[k].append(st.get(k, 0))
    out = {}
    for k, v in agg.items():
        v = sorted(v)
        out[k] = {'mean': round(sum(v) / len(v), 1), 'p10': v[int(0.1 * (len(v) - 1))], 'p90': v[int(0.9 * (len(v) - 1))]}
    return out


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('target')
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--opti', action='store_true')
    ap.add_argument('--noclone', action='store_true')
    ap.add_argument('--runs', type=int, default=40)
    ap.add_argument('--slots', type=int, default=60)
    a = ap.parse_args()
    print(json.dumps(summarize(a.target, runs=a.runs, level=a.level, opti=a.opti, cloning=not a.noclone, slots=a.slots), ensure_ascii=False))
