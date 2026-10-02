"""Reference implementation of the Dofus 3.5+ offspring distribution model (ElevageSimu research, 2026-10-01).

Model reconstructed from 4 in-game mating screenshots (guide DPLN, see screenshots/) + client
RidesData.geneticWeight. Running this file reproduces every displayed percentage (to 0.01 %) and the
genetons of the 4 examples. Spec: research/mechanics.md section 1.2 ; constants: research/data/mechanics.json.
Tunable / unverified: KAPPA (crossing weight factor, validated only for GW-20 children),
TARGET_MODE ('exact' = P(T)=B, validated ; 'max' = max(B, natural share), unverified alternative)."""
import json, itertools
RIDES='/home/user/ElevageSimu/research/raw/dofus-client/rides-3.6.12.16.json'
rides={r['id']:r for r in json.load(open(RIDES))['data']}
cross={}
for r in rides.values():
    for p in r['parents']:
        cross[frozenset((p['parent1'],p['parent2']))]=r['id']

POS_SELF=10; POS_PARENT=6   # legacy Dofus Mag 5 weights 10/6(/3/1), truncated to 2 levels
KAPPA=1.0                   # crossing weight factor
TARGET_MODE='exact'

def tree_weights(mount):
    """mount = {'id':rideId, 'parents':[rideId,rideId] or []} -> {rideId: normalized weight}"""
    w={}
    def add(i,pos):
        w[i]=w.get(i,0)+pos*rides[i]['geneticWeight']
    add(mount['id'],POS_SELF)
    for p in mount.get('parents') or []:
        add(p,POS_PARENT)
    s=sum(w.values())
    return {k:v/s for k,v in w.items()}

def natural(a,b):
    pa,pb=tree_weights(a),tree_weights(b)
    W={}
    for k,v in pa.items(): W[k]=W.get(k,0)+v
    for k,v in pb.items(): W[k]=W.get(k,0)+v
    for (x,px),(y,py) in itertools.product(pa.items(),pb.items()):
        if x==y: continue
        c=cross.get(frozenset((x,y)))
        if c is not None: W[c]=W.get(c,0)+px*py*KAPPA
    tot=sum(W.values())
    return {k:v/tot for k,v in W.items()}

def target_bonus(l1,l2,opti=0.10,use_opti=False,takeza=False):
    return min(1.0, 0.30+0.0015*(l1+l2)+(opti if use_opti else 0)+(0.20 if takeza else 0))

def distribution(a,b,use_opti=False,takeza=False,opti=0.10):
    D=natural(a,b)
    tg=max(rides[k]['generation'] for k in D)
    T={k:v for k,v in D.items() if rides[k]['generation']==tg}
    O={k:v for k,v in D.items() if rides[k]['generation']!=tg}
    B=target_bonus(a['level'],b['level'],opti,use_opti,takeza)
    if not O: B=1.0
    if TARGET_MODE=='max': B=max(B,sum(T.values()))
    sT=sum(T.values()); sO=sum(O.values())
    P={k:B*v/sT for k,v in T.items()}
    P.update({k:(1-B)*v/sO for k,v in O.items()} if sO>0 else {})
    return tg,P

def tokens(a,b,baby):
    trees=[a['id'],b['id']]+(a.get('parents') or [])+(b.get('parents') or [])
    if rides[baby]['generation']>max(rides[t]['generation'] for t in trees):
        return rides[a['id']]['breedingTokenRewardQuantity']+rides[b['id']]['breedingTokenRewardQuantity']
    return 0

if __name__=='__main__':
    names={x['id']:x['name']['fr'] for x in json.load(open('/home/user/ElevageSimu/research/raw/mounts.json'))}
    for f in ['/home/user/ElevageSimu/research/data/tree-muldo.json','/home/user/ElevageSimu/research/data/tree-dragodinde.json']:
        for x in json.load(open(f))['mounts']:
            if x.get('dofusdbId') is not None: names.setdefault(x['dofusdbId'],x['name'])
    def show(title,a,b,obs,**kw):
        tg,P=distribution(a,b,**kw)
        print('==',title,'target gen',tg)
        for k,v in sorted(P.items(),key=lambda kv:-kv[1]):
            nm=str(names.get(k,k)); o=obs.get(nm)
            print(f'  {nm:38s} model {100*v:7.3f}%  observed {o if o is not None else "-":>6}  tokens {tokens(a,b,k)}')
    # Ex1: Pourpre (gen5, lvl200, no tree) x Emeraude (gen9, lvl1, parents I&T, I&P)
    A={'id':19,'level':200,'parents':[]}; Bm={'id':21,'level':1,'parents':[66,68]}
    obs={'Dragodinde Émeraude et Pourpre':60.15,'Dragodinde Émeraude':15.73,'Dragodinde Ivoire et Turquoise':2.1,'Dragodinde Ivoire et Pourpre':2.1,'Dragodinde Pourpre':19.92}
    show('EX1 sans Optimakina',A,Bm,obs)
    obs2={'Dragodinde Émeraude et Pourpre':70.15,'Dragodinde Émeraude':11.78,'Dragodinde Ivoire et Turquoise':1.57,'Dragodinde Ivoire et Pourpre':1.57,'Dragodinde Pourpre':14.92}
    show('EX1 avec Optimakina',A,Bm,obs2,use_opti=True)
    # Ex2: Muldo Doré et Indigo (gen2, lvl1, parents Doré, Indigo) x Muldo Pourpre (gen1, lvl1, parents Pourpre, Corail)
    A={'id':108,'level':1,'parents':[94,92]}; Bm={'id':93,'level':1,'parents':[93,298]}
    obs={'Muldo Corail et Doré':15.15,'Muldo Corail et Indigo':15.15,'Muldo Indigo et Pourpre':9.77,'Muldo Doré et Pourpre':9.77,'Muldo Corail':1.93,'Muldo Pourpre':23.15,'Muldo Indigo':10.58,'Muldo Doré':10.58}
    show('EX2 Muldo',A,Bm,obs)
    # Ex3: I&T (gen8, parents I&T + I&P inferred) x I&P (gen8, no tree); levels sum 144 inferred from 51.6%
    A={'id':66,'level':72,'parents':[66,68]}; Bm={'id':68,'level':72,'parents':[]}
    show('EX3 I&T x I&P',A,Bm,{'Dragodinde Émeraude':51.6,'Dragodinde Ivoire et Turquoise':17.6,'Dragodinde Ivoire et Pourpre':30.8})
    # Ex4: same I&T x Pourpre (gen5 no tree); levels sum 272 inferred from 70.8%
    A={'id':66,'level':136,'parents':[66,68]}; Bm={'id':19,'level':136,'parents':[]}
    show('EX4 I&T x Pourpre',A,Bm,{'Dragodinde Ivoire et Turquoise':51.49,'Dragodinde Ivoire et Pourpre':19.31,'Dragodinde Pourpre':29.2})
