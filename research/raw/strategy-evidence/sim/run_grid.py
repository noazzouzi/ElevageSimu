import json, sys, time
sys.argv=['x']
exec(open('/home/user/ElevageSimu/research/raw/strategy-evidence/sim/pyramid_sim.py').read().split("if __name__ == '__main__':")[0])
targets={
 'Dragodinde':['Dragodinde Ébène','Dragodinde Pourpre','Dragodinde Turquoise','Dragodinde Émeraude','Dragodinde Amande et Émeraude'],
 'Muldo':['Muldo Roux','Muldo Ivoire','Muldo Prune','Muldo Corail','Muldo Corail et Doré'],
 'Volkorne':['Volkorne Roux','Volkorne Prune','Volkorne Doré','Volkorne Jade','Volkorne Jade et Pourpre'],
}
scen=[
 ('L1_noopti_clone',dict(level=1,opti=False,cloning=True)),
 ('L1_noopti_noclone',dict(level=1,opti=False,cloning=False)),
 ('L40_noopti_clone',dict(level=40,opti=False,cloning=True)),
 ('L40_opti_clone',dict(level=40,opti=True,cloning=True)),
 ('L60_noopti_clone',dict(level=60,opti=False,cloning=True)),
 ('L40_noopti_clone_20slots',dict(level=40,opti=False,cloning=True,slots=20)),
 ('L100_noopti_clone',dict(level=100,opti=False,cloning=True)),
 ('L100_opti_clone',dict(level=100,opti=True,cloning=True)),
 ('L200_opti_clone',dict(level=200,opti=True,cloning=True)),
 ('L40_opti20_clone_v37',dict(level=40,opti=True,opti_val=0.20,cloning=True)),
]
res={'meta':{'generated':'2026-10-01','runs':int(sys.argv[1]) if len(sys.argv)>1 else 40,'slots':60,'model':'research/raw/mechanics-evidence/breeding_model_reference.py','sim':'research/raw/strategy-evidence/sim/pyramid_sim.py'},'results':{}}
R=40
t0=time.time()
for fam,ts in targets.items():
    for ti,t in enumerate(ts):
        for sn,kw in scen:
            runs=R
            if not kw.get('cloning',True):
                if ti>=3: continue      # no-clone G9/G10: explodes (>10^5 captures), skipped
                if ti==2: runs=5
            r=summarize(t,runs=runs,**kw)
            r['runs']=runs
            res['results'].setdefault(fam,{}).setdefault(t,{})[sn]=r
            print(fam,t,sn,'capt',r['captures']['mean'],'mat',r['matings']['mean'],'raises',r['raises']['mean'],'cyc',r['cycles']['mean'],'gen',r['genetons']['mean'],'fail',r['failed']['mean'],round(time.time()-t0),flush=True)
json.dump(res,open('/home/user/ElevageSimu/research/raw/strategy-evidence/sim/pyramid-results.json','w'),ensure_ascii=False,indent=1)
print('done')
