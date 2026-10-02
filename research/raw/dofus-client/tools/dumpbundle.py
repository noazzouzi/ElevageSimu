import UnityPy, sys, json, os, warnings
warnings.filterwarnings('ignore')
UnityPy.config.FALLBACK_UNITY_VERSION="2022.3.42f1"
outdir=sys.argv[1]
for p in sys.argv[2:]:
    env=UnityPy.load(p)
    for obj in env.objects:
        if obj.type.name=='MonoBehaviour':
            tree=obj.read_typetree()
            name=tree.get('m_Name','x')
            json.dump(tree,open(os.path.join(outdir,name+'.json'),'w'),default=str,ensure_ascii=False)
            print(p, name, list(tree.keys()))
