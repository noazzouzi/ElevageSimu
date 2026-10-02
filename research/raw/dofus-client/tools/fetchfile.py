import json, sys, urllib.request, os, hashlib
idx=json.load(open(sys.argv[1]))
outdir=sys.argv[2]; os.makedirs(outdir,exist_ok=True)
game='dofus'
def get_range(bh,off,size):
    url=f'https://cytrus.cdn.ankama.com/{game}/bundles/{bh[:2]}/{bh}'
    req=urllib.request.Request(url,headers={'Range':f'bytes={off}-{off+size-1}'})
    return urllib.request.urlopen(req).read()
for name in sys.argv[3:]:
    full=[n for n in idx['files'] if n.endswith('/'+name)][0]
    f=idx['files'][full]
    data=b''
    if f['chunks']:
        for ch,size,off in sorted(f['chunks'],key=lambda c:c[2]):
            bh,csize,coff=idx['chunks'][ch]
            data+=get_range(bh,coff,csize)
    else:
        bh,csize,coff=idx['chunks'][f['hash']]
        data=get_range(bh,coff,csize)
    print(name, len(data), f['size'], hashlib.sha1(data).hexdigest()==f['hash'])
    open(os.path.join(outdir,name),'wb').write(data)
