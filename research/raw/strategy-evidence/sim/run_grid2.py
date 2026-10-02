import json, sys, time
sys.argv=['x']
exec(open('/home/user/ElevageSimu/research/raw/strategy-evidence/sim/pyramid_sim.py').read().split("if __name__ == '__main__':")[0])
targets={
 'Dragodinde':['Dragodinde Pourpre','Dragodinde Émeraude','Dragodinde Amande et Émeraude'],
 'Muldo':['Muldo Ivoire','Muldo Corail','Muldo Corail et Doré'],
 'Volkorne':['Volkorne Prune','Volkorne Jade','Volkorne Jade et Pourpre'],
}
MIX={1:40,2:40,3:40,4:40,5:60,6:60,7:100,8:100,9:100}
scen=[
 ('L1_noopti',dict(level=1,opti=False)),
 ('L40_noopti',dict(level=40,opti=False)),
 ('L40_opti_from_G6',dict(level=40,opti=True,opti_min_gen=6)),
 ('L40_opti_all',dict(level=40,opti=True)),
 ('mixed_L40_60_100_opti_from_G8',dict(level=40,opti=True,opti_min_gen=8,level_by_gen=MIX)),
 ('v37_L40_opti20_from_G6',dict(level=40,opti=True,opti_val=0.20,opti_min_gen=6)),
]
res={'meta':{'generated':'2026-10-01','runs':40,'slots':60,'cycle_hours':12,
 'fuel_note':'stat_fuel_points = raises x (6000 + 300): 60 000 stat points shared by 10 mounts + ~3 000 serenity points per batch; xp_fuel_points = sum over mounts of max(0, XP(level) - 20 437)/10 (XP up to level ~40 is gained as 2nd gauge during raising)',
 'model':'research/raw/mechanics-evidence/breeding_model_reference.py','sim':'research/raw/strategy-evidence/sim/pyramid_sim.py'},'results':{}}
t0=time.time()
for fam,ts in targets.items():
    for t in ts:
        for sn,kw in scen:
            r=summarize(t,runs=40,**kw)
            res['results'].setdefault(fam,{}).setdefault(t,{})[sn]=r
            print(fam,t,sn,'capt',r['captures']['mean'],'mat',r['matings']['mean'],'opti',r['optimakinas']['mean'],'raises',r['raises']['mean'],'cyc',r['cycles']['mean'],'gen',r['genetons']['mean'],'fuelM',round((r['stat_fuel_points']['mean']+r['xp_fuel_points']['mean'])/1e6,2),round(time.time()-t0),flush=True)
json.dump(res,open('/home/user/ElevageSimu/research/raw/strategy-evidence/sim/pyramid-results-v2.json','w'),ensure_ascii=False,indent=1)
print('done')
